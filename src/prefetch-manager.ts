import { randomUUID } from "node:crypto";
import {
  type ContentStoreEntry,
  createStoreKey,
  hashKey,
  MemoryContentStore,
} from "./content-store.js";
import { stripLocalExecutionOptions } from "./execution-policy.js";
import { getEffectiveProviderConfig } from "./provider-resolution.js";
import { executeOperationPlan } from "./provider-runtime.js";
import { PROVIDER_MAP } from "./providers/index.js";
import type {
  JsonObject,
  JsonValue,
  ProviderContentsMetadataEntry,
  ProviderId,
  ProviderToolOutput,
  SearchPrefetchSettings,
  WebProvidersConfig,
} from "./types.js";

const CONTENT_ENTRY_KIND = "web-contents";
const CONTENT_BATCH_ENTRY_KIND = "web-contents-batch";
const PREFETCH_JOB_KIND = "web-prefetch-job";
const CONTENT_CACHE_VERSION = 2;
const DEFAULT_CONTENT_TTL_MS = 30 * 60 * 1000;
const DEFAULT_PREFETCH_MAX_URLS = 3;
const MAX_PREFETCH_URLS = 5;

export interface SearchContentsPrefetchOptions {
  provider?: ProviderId | null;
  maxUrls?: number;
  ttlMs?: number;
  contentsOptions?: JsonObject;
}

interface StoredContentItem {
  url?: string;
  title?: string;
  body: string;
  summary?: string;
  status?: "ready" | "failed";
}

interface StoredContentsValue {
  url: string;
  provider: ProviderId;
  item: StoredContentItem;
  fetchedAt: number;
}

interface PrefetchJobValue {
  prefetchId: string;
  provider: ProviderId;
  urls: string[];
  contentKeys: string[];
  createdAt: number;
}

interface StoredBatchContentsValue {
  urls: string[];
  provider: ProviderId;
  items: StoredContentItem[];
  summary?: string;
  itemCount?: number;
  fetchedAt: number;
}

interface StoredBatchContentsResult {
  value: StoredBatchContentsValue;
  fromCache: boolean;
}

interface StoredContentsMetadataEntry extends ProviderContentsMetadataEntry {}

export interface PrefetchStartResult {
  prefetchId: string;
  provider: ProviderId;
  urlCount: number;
  queuedUrls: string[];
}

export interface PrefetchStatus {
  prefetchId: string;
  provider: ProviderId;
  status: "pending" | "ready" | "failed";
  totalUrlCount: number;
  readyUrlCount: number;
  failedUrlCount: number;
  pendingUrlCount: number;
  urls: Array<{
    url: string;
    status: "pending" | "ready" | "failed";
    text?: string;
    error?: string;
    provider?: ProviderId;
  }>;
}

interface EnsureContentsArgs {
  url: string;
  providerId: ProviderId;
  config: WebProvidersConfig;
  cwd: string;
  options: JsonObject | undefined;
  ttlMs?: number;
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
  generation?: number;
}

/** Result of ensuring a URL's contents are stored, with cache-hit metadata. */
interface StoredContentsResult {
  value: StoredContentsValue;
  fromCache: boolean;
}

interface InFlightEntry<TValue> {
  generation: number;
  task: Promise<TValue>;
}

const contentStore = new MemoryContentStore();
const inFlightContents = new Map<string, InFlightEntry<StoredContentsResult>>();
const inFlightBatchContents = new Map<
  string,
  InFlightEntry<StoredBatchContentsResult>
>();
let contentStoreGeneration = 0;

/**
 * Remove expired entries from the content store.  Call this at session start
 * or periodically to prevent unbounded cache growth.
 */
export async function cleanupContentStore(): Promise<void> {
  try {
    await contentStore.cleanup();
  } catch {
    // Best-effort: don't let cleanup failures disrupt the session.
  }
}

async function putContentStoreEntry<TValue extends JsonValue = JsonValue>({
  entry,
  generation,
}: {
  entry: ContentStoreEntry<TValue>;
  generation: number;
}): Promise<boolean> {
  if (generation !== contentStoreGeneration) {
    return false;
  }

  await contentStore.put(entry);
  return true;
}

export async function startContentsPrefetch({
  config,
  cwd,
  urls,
  options,
  onProgress,
}: {
  config: WebProvidersConfig;
  cwd: string;
  urls: string[];
  options: SearchContentsPrefetchOptions;
  onProgress?: (message: string) => void;
}): Promise<PrefetchStartResult | undefined> {
  const selectedUrls = selectPrefetchUrls(urls, options.maxUrls);
  if (selectedUrls.length === 0) {
    return undefined;
  }

  const provider = resolveContentsProvider(config, cwd, options.provider);
  if (!provider) {
    return undefined;
  }

  const ttlMs = clampTtlMs(options.ttlMs);
  const contentOptions = options.contentsOptions;
  const contentKeys = selectedUrls.map((url) =>
    buildContentsStoreKey(url, provider.id, contentOptions),
  );
  const prefetchId = randomUUID();
  const createdAt = Date.now();
  const generation = contentStoreGeneration;

  await putContentStoreEntry<JsonValue>({
    generation,
    entry: {
      key: buildPrefetchJobStoreKey(prefetchId),
      kind: PREFETCH_JOB_KIND,
      status: "pending",
      createdAt,
      updatedAt: createdAt,
      expiresAt: createdAt + ttlMs,
      value: {
        prefetchId,
        provider: provider.id,
        urls: selectedUrls,
        contentKeys,
        createdAt,
      },
    },
  });

  const task = Promise.allSettled(
    selectedUrls.map((url) =>
      ensureContentsStored({
        url,
        providerId: provider.id,
        config,
        cwd,
        options: contentOptions,
        ttlMs,
        onProgress,
        generation,
      }),
    ),
  )
    .then(async (results) => {
      const failedResults = results.filter(
        (result) => result.status === "rejected",
      );
      const failedUrlCount = failedResults.length;
      const error =
        failedResults.length === 0
          ? undefined
          : failedResults.length === 1
            ? formatUnknownError(failedResults[0].reason)
            : `${failedResults.length} URL(s) failed during prefetch.`;

      await putContentStoreEntry<JsonValue>({
        generation,
        entry: {
          key: buildPrefetchJobStoreKey(prefetchId),
          kind: PREFETCH_JOB_KIND,
          status: failedUrlCount === selectedUrls.length ? "failed" : "ready",
          createdAt,
          updatedAt: Date.now(),
          expiresAt: createdAt + ttlMs,
          value: {
            prefetchId,
            provider: provider.id,
            urls: selectedUrls,
            contentKeys,
            createdAt,
          },
          ...(error ? { error } : {}),
          metadata: {
            totalUrlCount: selectedUrls.length,
            failedUrlCount,
          },
        },
      });
    })
    .catch(async (error) => {
      await putContentStoreEntry<JsonValue>({
        generation,
        entry: {
          key: buildPrefetchJobStoreKey(prefetchId),
          kind: PREFETCH_JOB_KIND,
          status: "failed",
          createdAt,
          updatedAt: Date.now(),
          expiresAt: createdAt + ttlMs,
          value: {
            prefetchId,
            provider: provider.id,
            urls: selectedUrls,
            contentKeys,
            createdAt,
          },
          error: formatUnknownError(error),
          metadata: {
            totalUrlCount: selectedUrls.length,
            failedUrlCount: selectedUrls.length,
          },
        },
      });
    });

  void task;

  return {
    prefetchId,
    provider: provider.id,
    urlCount: selectedUrls.length,
    queuedUrls: selectedUrls,
  };
}

export async function getPrefetchStatus(
  prefetchId: string,
): Promise<PrefetchStatus | undefined> {
  const job = await contentStore.get<JsonValue>(
    buildPrefetchJobStoreKey(prefetchId),
  );
  if (!job || !isPrefetchJobValue(job.value)) {
    return undefined;
  }

  const entries = await Promise.all(
    job.value.contentKeys.map((key) => contentStore.get<JsonValue>(key)),
  );
  const urlStates = job.value.urls.map((url, index) => {
    const entry = entries[index];
    if (!entry) {
      return {
        url,
        status: "pending" as const,
      };
    }

    if (entry.status === "ready") {
      if (isStoredContentsValue(entry.value)) {
        return {
          url,
          status: "ready" as const,
          text: renderStoredContentItem(entry.value.item),
          provider: entry.value.provider,
        };
      }

      if (isStoredBatchContentsValue(entry.value)) {
        return {
          url,
          status: "ready" as const,
          text: renderStoredContentItems(entry.value.items),
          provider: entry.value.provider,
        };
      }
    }

    if (entry.status === "failed") {
      return {
        url,
        status: "failed" as const,
        error: entry.error,
      };
    }

    return {
      url,
      status: "pending" as const,
    };
  });

  const readyUrlCount = urlStates.filter(
    (entry) => entry.status === "ready",
  ).length;
  const failedUrlCount = urlStates.filter(
    (entry) => entry.status === "failed",
  ).length;
  const pendingUrlCount = urlStates.length - readyUrlCount - failedUrlCount;
  const status =
    failedUrlCount === urlStates.length
      ? "failed"
      : pendingUrlCount > 0
        ? "pending"
        : "ready";

  return {
    prefetchId: job.value.prefetchId,
    provider: job.value.provider,
    status,
    totalUrlCount: urlStates.length,
    readyUrlCount,
    failedUrlCount,
    pendingUrlCount,
    urls: urlStates,
  };
}

/**
 * Returns true when `web_contents` should route through the local store first.
 * We prefer store-backed resolution when either:
 *   1. an exact multi-URL batch entry already exists (or is currently in
 *      flight), or
 *   2. at least one requested URL already has an individual cached/in-flight
 *      entry that we can reuse while fetching only the missing URLs.
 *
 * When nothing is cached yet, callers can fall back to the provider's native
 * batched contents endpoint to avoid fanning out a cold multi-URL request into
 * one request per URL.
 */
export async function canResolveContentsFromStore({
  urls,
  providerId,
  options,
}: {
  urls: string[];
  providerId: ProviderId;
  options: JsonObject | undefined;
}): Promise<boolean> {
  if (urls.length === 0) {
    return false;
  }

  if (await hasStoredBatchContents({ urls, providerId, options })) {
    return true;
  }

  const now = Date.now();
  for (const url of urls) {
    const key = buildContentsStoreKey(url, providerId, options);

    if (inFlightContents.has(key)) {
      return true;
    }

    const entry = await contentStore.get(key);
    if (
      entry?.status === "ready" &&
      isStoredContentsValue(entry.value) &&
      !isExpired(entry, now)
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Returns true when an exact multi-URL batch entry already exists for the
 * resolved provider (or is currently in flight).
 */
async function hasStoredBatchContents({
  urls,
  providerId,
  options,
}: {
  urls: string[];
  providerId: ProviderId;
  options: JsonObject | undefined;
}): Promise<boolean> {
  const key = buildBatchContentsStoreKey(urls, providerId, options);
  if (inFlightBatchContents.has(key)) {
    return true;
  }

  const entry = await contentStore.get<JsonValue>(key);
  return (
    entry?.status === "ready" &&
    isStoredBatchContentsValue(entry.value) &&
    !isExpired(entry, Date.now())
  );
}

export async function resolveContentsFromStore({
  urls,
  providerId,
  config,
  cwd,
  options,
  signal,
  onProgress,
}: {
  urls: string[];
  providerId: ProviderId;
  config: WebProvidersConfig;
  cwd: string;
  options: JsonObject | undefined;
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
}): Promise<{ output: ProviderToolOutput; cachedCount: number }> {
  if (await canResolveContentsFromStore({ urls, providerId, options })) {
    if (await hasStoredBatchContents({ urls, providerId, options })) {
      const batch = await ensureBatchContentsStored({
        urls,
        providerId,
        config,
        cwd,
        options,
        signal,
        onProgress,
      });
      return {
        output: {
          provider: batch.value.provider,
          text: renderStoredContentItems(
            orderStoredContentItemsForRequest(batch.value.items, urls),
          ),
          summary:
            batch.value.summary ??
            `${batch.value.urls.length} URL(s) fetched via ${batch.value.provider}`,
          itemCount: batch.value.itemCount ?? batch.value.urls.length,
        },
        cachedCount: batch.fromCache ? batch.value.urls.length : 0,
      };
    }

    const settled = await Promise.allSettled(
      urls.map((url) =>
        ensureContentsStored({
          url,
          providerId,
          config,
          cwd,
          options,
          signal,
          onProgress,
        }),
      ),
    );

    const results = settled
      .filter(
        (result): result is PromiseFulfilledResult<StoredContentsResult> =>
          result.status === "fulfilled",
      )
      .map((result) => result.value);
    const failures = settled
      .map((result, index) =>
        result.status === "rejected"
          ? {
              url: urls[index] ?? "",
              error:
                result.reason instanceof Error
                  ? result.reason.message
                  : String(result.reason),
            }
          : undefined,
      )
      .filter((result): result is { url: string; error: string } =>
        Boolean(result),
      );

    if (results.length === 0 && failures.length > 0) {
      throw new Error(
        failures.length === 1
          ? (failures[0]?.error ?? "web_contents failed.")
          : `web_contents failed for all ${failures.length} URL(s): ${failures
              .map(
                (failure, index) =>
                  `${index + 1}. ${failure.url} — ${failure.error}`,
              )
              .join("; ")}`,
      );
    }

    const cachedCount = results.filter((r) => r.fromCache).length;
    const provider = results[0]?.value.provider ?? providerId;
    const renderedItems = results.map((result) => result.value.item);
    const textBlocks = [renderStoredContentItems(renderedItems)].filter(
      Boolean,
    );

    for (const failure of failures) {
      textBlocks.push(`Error: ${failure.url}\n   ${failure.error}`);
    }

    return {
      output: {
        provider,
        text: textBlocks.join("\n\n").trim() || "No contents found.",
        summary:
          cachedCount > 0
            ? `${results.length} of ${urls.length} URL(s) resolved via ${provider} (${cachedCount} cached)`
            : `${results.length} of ${urls.length} URL(s) fetched via ${provider}`,
        itemCount: results.length,
      },
      cachedCount,
    };
  }

  const batch = await ensureBatchContentsStored({
    urls,
    providerId,
    config,
    cwd,
    options,
    signal,
    onProgress,
  });
  return {
    output: {
      provider: batch.value.provider,
      text: renderStoredContentItems(
        orderStoredContentItemsForRequest(batch.value.items, urls),
      ),
      summary:
        batch.value.summary ??
        `${batch.value.urls.length} URL(s) fetched via ${batch.value.provider}`,
      itemCount: batch.value.itemCount ?? batch.value.urls.length,
    },
    cachedCount: batch.fromCache ? batch.value.urls.length : 0,
  };
}

export function parseSearchContentsPrefetchOptions(
  options: JsonObject | undefined,
): SearchContentsPrefetchOptions | undefined {
  const raw = options?.prefetch;
  if (raw === undefined) {
    return undefined;
  }
  if (!isJsonObject(raw)) {
    throw new Error("prefetch must be an object.");
  }

  const maxUrls = parseOptionalPositiveInteger(raw.maxUrls, "maxUrls");
  const provider = parseOptionalProviderId(raw.provider);
  const ttlMs = parseOptionalPositiveInteger(raw.ttlMs, "ttlMs");
  const contentsOptions =
    raw.contentsOptions === undefined
      ? undefined
      : assertJsonObject(raw.contentsOptions, "prefetch.contentsOptions");

  return {
    maxUrls,
    provider,
    ttlMs,
    contentsOptions,
  };
}

export function mergeSearchContentsPrefetchOptions(
  defaults: SearchPrefetchSettings | undefined,
  overrides: SearchContentsPrefetchOptions | undefined,
): SearchContentsPrefetchOptions | undefined {
  if (!defaults && !overrides) {
    return undefined;
  }

  return {
    provider:
      overrides?.provider !== undefined
        ? overrides.provider
        : defaults?.provider,
    maxUrls:
      overrides?.maxUrls !== undefined ? overrides.maxUrls : defaults?.maxUrls,
    ttlMs: overrides?.ttlMs !== undefined ? overrides.ttlMs : defaults?.ttlMs,
    contentsOptions:
      overrides?.contentsOptions !== undefined
        ? overrides.contentsOptions
        : undefined,
  };
}

export function stripSearchContentsPrefetchOptions(
  options: JsonObject | undefined,
): JsonObject | undefined {
  if (!options) {
    return undefined;
  }

  const { prefetch: _prefetch, ...rest } = options;
  return Object.keys(rest).length > 0 ? (rest as JsonObject) : undefined;
}

export function formatPrefetchStatusText(
  status: PrefetchStatus,
  includeContent = false,
): string {
  const lines = [
    `Prefetch ${status.prefetchId}`,
    `Provider: ${status.provider}`,
    `Status: ${status.status}`,
    `Ready: ${status.readyUrlCount}/${status.totalUrlCount}`,
  ];

  for (const [index, entry] of status.urls.entries()) {
    lines.push("");
    lines.push(`${index + 1}. ${entry.url}`);
    lines.push(`   ${entry.status}`);
    if (entry.error) {
      lines.push(`   ${entry.error}`);
    }
    if (includeContent && entry.text) {
      for (const line of entry.text.split("\n")) {
        lines.push(`   ${line}`);
      }
    }
  }

  return lines.join("\n");
}

/**
 * Reset all in-memory cache state. Intended for use in tests to isolate
 * test cases from each other.
 */
export function resetContentStore(): void {
  contentStoreGeneration += 1;
  contentStore.clear();
  inFlightContents.clear();
  inFlightBatchContents.clear();
}

export const __prefetchTest__ = {
  buildBatchContentsStoreKey,
  buildContentsStoreKey,
  buildPrefetchJobStoreKey,
  selectPrefetchUrls,
  resolveContentsProvider,
};

function deleteInFlightEntryIfCurrent<TValue>(
  map: Map<string, InFlightEntry<TValue>>,
  key: string,
  generation: number,
  task: Promise<TValue>,
): void {
  const current = map.get(key);
  if (current?.generation === generation && current.task === task) {
    map.delete(key);
  }
}

async function ensureBatchContentsStored({
  urls,
  providerId,
  config,
  cwd,
  options,
  ttlMs = DEFAULT_CONTENT_TTL_MS,
  signal,
  onProgress,
  generation = contentStoreGeneration,
}: {
  urls: string[];
  providerId: ProviderId;
  config: WebProvidersConfig;
  cwd: string;
  options: JsonObject | undefined;
  ttlMs?: number;
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
  generation?: number;
}): Promise<StoredBatchContentsResult> {
  const normalizedUrls = normalizeUrlSet(urls);
  if (normalizedUrls.length === 0) {
    throw new Error("At least one valid HTTP(S) URL is required.");
  }

  const key = buildBatchContentsStoreKey(normalizedUrls, providerId, options);
  const existingInFlight = inFlightBatchContents.get(key);
  if (existingInFlight) {
    return await existingInFlight.task;
  }

  let task!: Promise<StoredBatchContentsResult>;
  task = (async () => {
    const existing = await contentStore.get<JsonValue>(key);
    const now = Date.now();

    if (
      existing?.status === "ready" &&
      isStoredBatchContentsValue(existing.value) &&
      !isExpired(existing, now)
    ) {
      return { value: existing.value, fromCache: true };
    }

    const provider = PROVIDER_MAP[providerId];
    const providerConfig = getEffectiveProviderConfig(config, providerId);
    if (!providerConfig) {
      throw new Error(`Provider '${providerId}' is not configured.`);
    }

    const createdAt = now;
    await putContentStoreEntry<JsonValue>({
      generation,
      entry: {
        key,
        kind: CONTENT_BATCH_ENTRY_KIND,
        status: "pending",
        createdAt,
        updatedAt: createdAt,
        expiresAt: createdAt + ttlMs,
        metadata: {
          urls: normalizedUrls as unknown as JsonValue,
          provider: providerId,
          optionsHash: hashOptions(options),
        },
      },
    });

    try {
      const plan = provider.buildPlan(
        {
          capability: "contents",
          urls: normalizedUrls,
          options: stripLocalExecutionOptions(options),
        },
        providerConfig as never,
      );
      if (!plan) {
        throw new Error(
          `Provider '${providerId}' could not build a contents plan.`,
        );
      }
      const result = await executeOperationPlan(plan, options, {
        cwd,
        signal,
        onProgress,
      });
      if ("results" in result) {
        throw new Error(
          `${provider.label} contents returned an invalid result.`,
        );
      }

      const fetchedAt = Date.now();
      const structuredEntries = extractStoredContentsEntriesFromMetadata(
        result.metadata,
      );
      const stored: StoredBatchContentsValue = {
        urls: normalizedUrls,
        provider: result.provider,
        items:
          structuredEntries.length > 0
            ? structuredEntries.map((entry) => toStoredContentItem(entry))
            : [{ body: result.text }],
        summary: result.summary,
        itemCount: result.itemCount,
        fetchedAt,
      };
      await putContentStoreEntry<JsonValue>({
        generation,
        entry: {
          key,
          kind: CONTENT_BATCH_ENTRY_KIND,
          status: "ready",
          createdAt,
          updatedAt: fetchedAt,
          expiresAt: fetchedAt + ttlMs,
          value: stored as unknown as JsonValue,
          metadata: {
            urls: normalizedUrls as unknown as JsonValue,
            provider: result.provider,
            optionsHash: hashOptions(options),
          },
        },
      });
      await storePerUrlContentsEntries({
        entries: structuredEntries,
        provider: result.provider,
        options,
        createdAt,
        fetchedAt,
        ttlMs,
        generation,
      });
      return { value: stored, fromCache: false };
    } catch (error) {
      await putContentStoreEntry<JsonValue>({
        generation,
        entry: {
          key,
          kind: CONTENT_BATCH_ENTRY_KIND,
          status: "failed",
          createdAt,
          updatedAt: Date.now(),
          expiresAt: Date.now() + ttlMs,
          error: error instanceof Error ? error.message : String(error),
          metadata: {
            urls: normalizedUrls as unknown as JsonValue,
            provider: providerId,
            optionsHash: hashOptions(options),
          },
        },
      });
      throw error;
    } finally {
      deleteInFlightEntryIfCurrent(
        inFlightBatchContents,
        key,
        generation,
        task,
      );
    }
  })();

  inFlightBatchContents.set(key, { generation, task });
  return await task;
}

async function ensureContentsStored({
  url,
  providerId,
  config,
  cwd,
  options,
  ttlMs = DEFAULT_CONTENT_TTL_MS,
  signal,
  onProgress,
  generation = contentStoreGeneration,
}: EnsureContentsArgs): Promise<StoredContentsResult> {
  const key = buildContentsStoreKey(url, providerId, options);
  const existingInFlight = inFlightContents.get(key);
  if (existingInFlight) {
    return await existingInFlight.task;
  }

  let task!: Promise<StoredContentsResult>;
  task = (async () => {
    const existing = await contentStore.get<JsonValue>(key);
    const now = Date.now();

    if (
      existing?.status === "ready" &&
      isStoredContentsValue(existing.value) &&
      !isExpired(existing, now)
    ) {
      return { value: existing.value, fromCache: true };
    }

    const provider = PROVIDER_MAP[providerId];
    const providerConfig = getEffectiveProviderConfig(config, providerId);
    if (!providerConfig) {
      throw new Error(`Provider '${providerId}' is not configured.`);
    }

    const createdAt = now;
    await putContentStoreEntry<JsonValue>({
      generation,
      entry: {
        key,
        kind: CONTENT_ENTRY_KIND,
        status: "pending",
        createdAt,
        updatedAt: createdAt,
        expiresAt: createdAt + ttlMs,
        metadata: {
          url: canonicalizeUrl(url),
          provider: providerId,
          optionsHash: hashOptions(options),
        },
      },
    });

    try {
      const plan = provider.buildPlan(
        {
          capability: "contents",
          urls: [canonicalizeUrl(url)],
          options: stripLocalExecutionOptions(options),
        },
        providerConfig as never,
      );
      if (!plan) {
        throw new Error(
          `Provider '${providerId}' could not build a contents plan.`,
        );
      }
      const result = await executeOperationPlan(plan, options, {
        cwd,
        signal,
        onProgress,
      });
      if ("results" in result) {
        throw new Error(
          `${provider.label} contents returned an invalid result.`,
        );
      }

      const now = Date.now();
      const canonicalUrl = canonicalizeUrl(url);
      const structuredEntry = findStoredContentsEntry(
        extractStoredContentsEntriesFromMetadata(result.metadata),
        canonicalUrl,
      );
      const stored: StoredContentsValue = {
        url: canonicalUrl,
        provider: result.provider,
        item: structuredEntry
          ? toStoredContentItem(structuredEntry)
          : { body: result.text },
        fetchedAt: now,
      };
      await putContentStoreEntry<JsonValue>({
        generation,
        entry: {
          key,
          kind: CONTENT_ENTRY_KIND,
          status: "ready",
          createdAt,
          updatedAt: now,
          expiresAt: now + ttlMs,
          value: stored as unknown as JsonValue,
          metadata: {
            url: canonicalUrl,
            provider: result.provider,
            optionsHash: hashOptions(options),
          },
        },
      });
      return { value: stored, fromCache: false };
    } catch (error) {
      await putContentStoreEntry<JsonValue>({
        generation,
        entry: {
          key,
          kind: CONTENT_ENTRY_KIND,
          status: "failed",
          createdAt,
          updatedAt: Date.now(),
          expiresAt: Date.now() + ttlMs,
          error: error instanceof Error ? error.message : String(error),
          metadata: {
            url: canonicalizeUrl(url),
            provider: providerId,
            optionsHash: hashOptions(options),
          },
        },
      });
      throw error;
    } finally {
      deleteInFlightEntryIfCurrent(inFlightContents, key, generation, task);
    }
  })();

  inFlightContents.set(key, { generation, task });
  return await task;
}

async function storePerUrlContentsEntries({
  entries,
  provider,
  options,
  createdAt,
  fetchedAt,
  ttlMs,
  generation,
}: {
  entries: StoredContentsMetadataEntry[];
  provider: ProviderId;
  options: JsonObject | undefined;
  createdAt: number;
  fetchedAt: number;
  ttlMs: number;
  generation: number;
}): Promise<void> {
  await Promise.all(
    entries.map(async (entry) => {
      const canonicalUrl = canonicalizeUrl(entry.url);
      if (entry.status === "failed" || !/^https?:\/\//i.test(canonicalUrl)) {
        return;
      }

      await putContentStoreEntry<JsonValue>({
        generation,
        entry: {
          key: buildContentsStoreKey(canonicalUrl, provider, options),
          kind: CONTENT_ENTRY_KIND,
          status: "ready",
          createdAt,
          updatedAt: fetchedAt,
          expiresAt: fetchedAt + ttlMs,
          value: {
            url: canonicalUrl,
            provider,
            item: toStoredContentItem(entry),
            fetchedAt,
          } as unknown as JsonValue,
          metadata: {
            url: canonicalUrl,
            provider,
            optionsHash: hashOptions(options),
          },
        },
      });
    }),
  );
}

function extractStoredContentsEntriesFromMetadata(
  metadata: JsonObject | undefined,
): StoredContentsMetadataEntry[] {
  const rawEntries = metadata?.contentsEntries;
  if (!Array.isArray(rawEntries)) {
    return [];
  }

  return rawEntries.flatMap((entry) =>
    isStoredContentsMetadataEntry(entry) ? [entry] : [],
  );
}

function isStoredContentsMetadataEntry(
  value: unknown,
): value is StoredContentsMetadataEntry {
  return (
    isJsonObject(value) &&
    typeof value.url === "string" &&
    (value.title === undefined || typeof value.title === "string") &&
    typeof value.body === "string" &&
    (value.summary === undefined || typeof value.summary === "string") &&
    (value.status === undefined ||
      value.status === "ready" ||
      value.status === "failed")
  );
}

function toStoredContentItem(
  entry: StoredContentsMetadataEntry,
): StoredContentItem {
  return {
    url: entry.url,
    title: entry.title,
    body: entry.body,
    summary: entry.summary,
    status: entry.status,
  };
}

function findStoredContentsEntry(
  entries: StoredContentsMetadataEntry[],
  url: string,
): StoredContentsMetadataEntry | undefined {
  return entries.find(
    (entry) => entry.status !== "failed" && canonicalizeUrl(entry.url) === url,
  );
}

function buildBatchContentsStoreKey(
  urls: string[],
  providerId: ProviderId,
  options: JsonObject | undefined,
): string {
  return createStoreKey([
    CONTENT_BATCH_ENTRY_KIND,
    `v${CONTENT_CACHE_VERSION}`,
    providerId,
    hashKey(stableStringify(normalizeUrlSet(urls))),
    hashOptions(options),
  ]);
}

function buildContentsStoreKey(
  url: string,
  providerId: ProviderId,
  options: JsonObject | undefined,
): string {
  return createStoreKey([
    CONTENT_ENTRY_KIND,
    `v${CONTENT_CACHE_VERSION}`,
    providerId,
    hashKey(canonicalizeUrl(url)),
    hashOptions(options),
  ]);
}

function buildPrefetchJobStoreKey(prefetchId: string): string {
  return createStoreKey([PREFETCH_JOB_KIND, prefetchId]);
}

function resolveContentsProvider(
  config: WebProvidersConfig,
  cwd: string,
  explicitProvider: ProviderId | null | undefined,
) {
  if (!explicitProvider) {
    return undefined;
  }

  const provider = PROVIDER_MAP[explicitProvider];
  if (!provider.capabilities.includes("contents")) {
    return undefined;
  }

  const providerConfig = getEffectiveProviderConfig(config, explicitProvider);
  const status = provider.getStatus(providerConfig as never, cwd, "contents");
  if (status.available) {
    return provider;
  }
  // Explicit prefetch provider is unavailable, so skip prefetch instead of
  // turning a successful search into a tool failure.
  return undefined;
}

function canonicalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return url.trim();
  }
}

function normalizeUrlSet(urls: string[]): string[] {
  return [...new Set(urls.map((url) => canonicalizeUrl(url)).filter(Boolean))]
    .filter((url) => /^https?:\/\//i.test(url))
    .sort();
}

function selectPrefetchUrls(
  urls: string[],
  maxUrls: number | undefined,
): string[] {
  const selected: string[] = [];
  const seen = new Set<string>();
  const limit = clampPrefetchUrlCount(maxUrls);

  for (const url of urls) {
    const canonical = canonicalizeUrl(url);
    if (!/^https?:\/\//i.test(canonical) || seen.has(canonical)) {
      continue;
    }
    selected.push(canonical);
    seen.add(canonical);
    if (selected.length >= limit) {
      break;
    }
  }

  return selected;
}

function clampPrefetchUrlCount(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_PREFETCH_MAX_URLS;
  }
  return Math.min(Math.max(Math.trunc(value), 1), MAX_PREFETCH_URLS);
}

function clampTtlMs(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_CONTENT_TTL_MS;
  }
  return Math.max(1000, value);
}

function isExpired(entry: ContentStoreEntry, now: number): boolean {
  return entry.expiresAt !== undefined && entry.expiresAt <= now;
}

function formatUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function renderStoredContentItems(items: StoredContentItem[]): string {
  if (items.length === 0) {
    return "No contents found.";
  }

  const blocks = items.map((item, index) =>
    renderStoredContentItem(item, index),
  );
  return blocks.join("\n\n").trim() || "No contents found.";
}

function orderStoredContentItemsForRequest(
  items: StoredContentItem[],
  urls: string[],
): StoredContentItem[] {
  const itemsByUrl = new Map<string, StoredContentItem[]>();
  const extras: StoredContentItem[] = [];

  for (const item of items) {
    if (!item.url) {
      extras.push(item);
      continue;
    }

    const key = canonicalizeUrl(item.url);
    const bucket = itemsByUrl.get(key);
    if (bucket) {
      bucket.push(item);
    } else {
      itemsByUrl.set(key, [item]);
    }
  }

  if (itemsByUrl.size === 0) {
    return items;
  }

  const ordered: StoredContentItem[] = [];
  for (const url of urls) {
    const key = canonicalizeUrl(url);
    const bucket = itemsByUrl.get(key);
    const next = bucket?.shift();
    if (next) {
      ordered.push(next);
    }
    if (bucket && bucket.length === 0) {
      itemsByUrl.delete(key);
    }
  }

  for (const bucket of itemsByUrl.values()) {
    ordered.push(...bucket);
  }

  ordered.push(...extras);
  return ordered;
}

function renderStoredContentItem(
  item: StoredContentItem,
  index?: number,
): string {
  const hasStructuredHeader = Boolean(item.title || item.url);
  if (!hasStructuredHeader) {
    return item.body.trim();
  }

  const heading =
    item.status === "failed"
      ? `Error: ${item.url ?? item.title ?? "Untitled"}`
      : (item.title ?? item.url ?? "Untitled");
  const lines = [
    `${index === undefined ? "" : `${index + 1}. `}${heading}`.trim(),
  ];

  if (item.status !== "failed" && item.url && item.url !== heading) {
    lines.push(`   ${item.url}`);
  }
  if (item.body.trim()) {
    for (const line of item.body.trim().split("\n")) {
      lines.push(`   ${line}`);
    }
  }

  return lines.join("\n").trimEnd();
}

function hashOptions(options: JsonObject | undefined): string {
  return hashKey(stableStringify(stripLocalExecutionOptions(options) ?? {}));
}

function stableStringify(value: JsonValue): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  return `{${Object.keys(value)
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(key)}:${stableStringify(value[key] as JsonValue)}`,
    )
    .join(",")}}`;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertJsonObject(value: unknown, field: string): JsonObject {
  if (!isJsonObject(value)) {
    throw new Error(`${field} must be an object.`);
  }
  return value;
}

function parseOptionalPositiveInteger(
  value: unknown,
  field: string,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Number.isInteger(value) || Number(value) <= 0) {
    throw new Error(`prefetch.${field} must be a positive integer.`);
  }
  return Number(value);
}

function parseOptionalProviderId(
  value: unknown,
): ProviderId | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (isProviderId(value)) {
    return value;
  }
  throw new Error("prefetch.provider must be a valid provider id or null.");
}

function isProviderId(value: unknown): value is ProviderId {
  return (
    value === "claude" ||
    value === "codex" ||
    value === "exa" ||
    value === "gemini" ||
    value === "perplexity" ||
    value === "parallel" ||
    value === "valyu"
  );
}

function isStoredBatchContentsValue(
  value: unknown,
): value is StoredBatchContentsValue & JsonObject {
  if (!isJsonObject(value)) {
    return false;
  }
  return (
    Array.isArray(value.urls) &&
    value.urls.every((item) => typeof item === "string") &&
    isProviderId(value.provider) &&
    Array.isArray(value.items) &&
    value.items.every((item) => isStoredContentItem(item)) &&
    typeof value.fetchedAt === "number"
  );
}

function isStoredContentsValue(
  value: unknown,
): value is StoredContentsValue & JsonObject {
  if (!isJsonObject(value)) {
    return false;
  }
  return (
    typeof value.url === "string" &&
    isProviderId(value.provider) &&
    isStoredContentItem(value.item) &&
    typeof value.fetchedAt === "number"
  );
}

function isStoredContentItem(
  value: unknown,
): value is StoredContentItem & JsonObject {
  return (
    isJsonObject(value) &&
    (value.url === undefined || typeof value.url === "string") &&
    (value.title === undefined || typeof value.title === "string") &&
    typeof value.body === "string" &&
    (value.summary === undefined || typeof value.summary === "string") &&
    (value.status === undefined ||
      value.status === "ready" ||
      value.status === "failed")
  );
}

function isPrefetchJobValue(
  value: unknown,
): value is PrefetchJobValue & JsonObject {
  if (!isJsonObject(value)) {
    return false;
  }
  return (
    typeof value.prefetchId === "string" &&
    isProviderId(value.provider) &&
    Array.isArray(value.urls) &&
    value.urls.every((item) => typeof item === "string") &&
    Array.isArray(value.contentKeys) &&
    value.contentKeys.every((item) => typeof item === "string") &&
    typeof value.createdAt === "number"
  );
}
