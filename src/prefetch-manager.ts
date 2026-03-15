import { randomUUID } from "node:crypto";
import {
  type ContentStore,
  type ContentStoreEntry,
  createStoreKey,
  FileContentStore,
  hashKey,
} from "./content-store.js";
import { stripLocalExecutionOptions } from "./execution-policy.js";
import {
  getEffectiveProviderConfig,
  resolveProviderForCapability,
} from "./provider-resolution.js";
import { executeOperationPlan } from "./provider-runtime.js";
import { PROVIDER_MAP } from "./providers/index.js";
import type {
  JsonObject,
  JsonValue,
  ProviderId,
  ProviderToolOutput,
  WebProvidersConfig,
} from "./types.js";

const CONTENT_ENTRY_KIND = "web-contents";
const PREFETCH_JOB_KIND = "web-prefetch-job";
const CONTENT_CACHE_VERSION = 1;
const DEFAULT_CONTENT_TTL_MS = 30 * 60 * 1000;
const DEFAULT_PREFETCH_MAX_URLS = 3;
const MAX_PREFETCH_URLS = 5;

export interface SearchContentsPrefetchOptions {
  enabled?: boolean;
  maxUrls?: number;
  provider?: ProviderId;
  ttlMs?: number;
  contentsOptions?: JsonObject;
}

interface StoredContentsValue {
  url: string;
  provider: ProviderId;
  text: string;
  summary?: string;
  itemCount?: number;
  fetchedAt: number;
}

interface PrefetchJobValue {
  prefetchId: string;
  provider: ProviderId;
  urls: string[];
  contentKeys: string[];
  createdAt: number;
}

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
}

/** Result of ensuring a URL's contents are stored, with cache-hit metadata. */
interface StoredContentsResult {
  value: StoredContentsValue;
  fromCache: boolean;
}

const contentStore = new FileContentStore();
const inFlightContents = new Map<string, Promise<StoredContentsResult>>();

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

export async function startContentsPrefetch({
  config,
  cwd,
  urls,
  searchProviderId,
  options,
  onProgress,
}: {
  config: WebProvidersConfig;
  cwd: string;
  urls: string[];
  searchProviderId?: ProviderId;
  options: SearchContentsPrefetchOptions;
  onProgress?: (message: string) => void;
}): Promise<PrefetchStartResult | undefined> {
  const selectedUrls = selectPrefetchUrls(urls, options.maxUrls);
  if (selectedUrls.length === 0) {
    return undefined;
  }

  const provider = resolveContentsProvider(
    config,
    cwd,
    options.provider,
    searchProviderId,
  );
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

  await contentStore.put<JsonValue>({
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
      }),
    ),
  )
    .then(async (results) => {
      const failedCount = results.filter(
        (result) => result.status === "rejected",
      ).length;
      const status = failedCount === results.length ? "failed" : "ready";
      await contentStore.put<JsonValue>({
        key: buildPrefetchJobStoreKey(prefetchId),
        kind: PREFETCH_JOB_KIND,
        status,
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
        metadata: {
          totalUrlCount: selectedUrls.length,
          failedUrlCount: failedCount,
        },
      });
    })
    .catch(() => undefined);

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

    if (entry.status === "ready" && isStoredContentsValue(entry.value)) {
      return {
        url,
        status: "ready" as const,
        text: entry.value.text,
        provider: entry.value.provider,
      };
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
 * Returns true when at least one of the given URLs has a valid (non-expired)
 * entry in the content store. This is used to decide whether it's worth
 * routing a `web_contents` call through the store rather than fetching
 * directly from the provider.
 */
export async function hasAnyCachedContents({
  urls,
  providerId,
  options,
}: {
  urls: string[];
  providerId: ProviderId;
  options: JsonObject | undefined;
}): Promise<boolean> {
  const now = Date.now();
  for (const url of urls) {
    const key = buildContentsStoreKey(url, providerId, options);

    // Fast path: if there's an in-flight fetch for this URL the store is
    // already handling it.
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
 * Try to serve *all* requested URLs from the cache without needing a live
 * provider.  Returns the assembled output when every URL is a cache hit, or
 * `undefined` when at least one URL is missing.  This lets `web_contents`
 * succeed even if the provider that originally fetched the pages is later
 * disabled or unavailable.
 *
 * When `explicitProvider` is given, only that provider's cache entries are
 * checked.  Otherwise all known providers are probed per URL.
 */
export async function tryServeContentsFromStore({
  urls,
  explicitProvider,
  config: _config,
  cwd: _cwd,
  options,
  signal: _signal,
}: {
  urls: string[];
  explicitProvider: ProviderId | undefined;
  config: WebProvidersConfig;
  cwd: string;
  options: JsonObject | undefined;
  signal?: AbortSignal;
}): Promise<ProviderToolOutput | undefined> {
  if (urls.length === 0) {
    return undefined;
  }

  const now = Date.now();
  const providerCandidates: readonly ProviderId[] = explicitProvider
    ? [explicitProvider]
    : PROVIDER_IDS;

  const hits: StoredContentsValue[] = [];

  for (const url of urls) {
    const hit = await findCachedEntry(url, providerCandidates, options, now);
    if (!hit) {
      // At least one URL is not cached — bail out.
      return undefined;
    }
    hits.push(hit);
  }

  const provider = hits[0]?.provider ?? (explicitProvider as ProviderId);
  const textBlocks = hits.map((h) => h.text.trim()).filter(Boolean);

  return {
    provider,
    text: textBlocks.join("\n\n").trim() || "No contents found.",
    summary: `${hits.length} of ${urls.length} URL(s) served from cache`,
    itemCount: hits.length,
  };
}

async function findCachedEntry(
  url: string,
  providerCandidates: readonly ProviderId[],
  options: JsonObject | undefined,
  now: number,
): Promise<StoredContentsValue | undefined> {
  for (const pid of providerCandidates) {
    const key = buildContentsStoreKey(url, pid, options);

    // Check in-flight promises first — if a prefetch is still running we
    // can't serve synchronously, so treat it as a miss.
    if (inFlightContents.has(key)) {
      return undefined;
    }

    const entry = await contentStore.get<JsonValue>(key);
    if (
      entry?.status === "ready" &&
      isStoredContentsValue(entry.value) &&
      !isExpired(entry, now)
    ) {
      return entry.value;
    }
  }
  return undefined;
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
  const textBlocks = results.map((r) => r.value.text.trim()).filter(Boolean);

  for (const failure of failures) {
    textBlocks.push(`Error: ${failure.url}\n   ${failure.error}`);
  }

  return {
    output: {
      provider,
      text: textBlocks.join("\n\n").trim() || "No contents found.",
      summary:
        cachedCount > 0
          ? `${results.length} of ${urls.length} URL(s) fetched via ${provider} (${cachedCount} cached)`
          : `${results.length} of ${urls.length} URL(s) fetched via ${provider}`,
      itemCount: results.length,
    },
    cachedCount,
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

  const enabled =
    raw.enabled === undefined
      ? true
      : parseOptionalBoolean(raw.enabled, "enabled");
  const maxUrls = parseOptionalPositiveInteger(raw.maxUrls, "maxUrls");
  const provider = parseOptionalProviderId(raw.provider);
  const ttlMs = parseOptionalPositiveInteger(raw.ttlMs, "ttlMs");
  const contentsOptions =
    raw.contentsOptions === undefined
      ? undefined
      : assertJsonObject(raw.contentsOptions, "prefetch.contentsOptions");

  return {
    enabled,
    maxUrls,
    provider,
    ttlMs,
    contentsOptions,
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

export const __prefetchTest__ = {
  buildContentsStoreKey,
  buildPrefetchJobStoreKey,
  selectPrefetchUrls,
  resolveContentsProvider,
};

async function ensureContentsStored({
  url,
  providerId,
  config,
  cwd,
  options,
  ttlMs = DEFAULT_CONTENT_TTL_MS,
  signal,
  onProgress,
}: EnsureContentsArgs): Promise<StoredContentsResult> {
  const key = buildContentsStoreKey(url, providerId, options);
  const existingInFlight = inFlightContents.get(key);
  if (existingInFlight) {
    return await existingInFlight;
  }

  const task = (async () => {
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
    await contentStore.put<JsonValue>({
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
      const stored: StoredContentsValue = {
        url: canonicalizeUrl(url),
        provider: result.provider,
        text: result.text,
        summary: result.summary,
        itemCount: result.itemCount,
        fetchedAt: now,
      };
      await contentStore.put<JsonValue>({
        key,
        kind: CONTENT_ENTRY_KIND,
        status: "ready",
        createdAt,
        updatedAt: now,
        expiresAt: now + ttlMs,
        value: stored as unknown as JsonValue,
        metadata: {
          url: canonicalizeUrl(url),
          provider: result.provider,
          optionsHash: hashOptions(options),
        },
      });
      return { value: stored, fromCache: false };
    } catch (error) {
      await contentStore.put<JsonValue>({
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
      });
      throw error;
    } finally {
      inFlightContents.delete(key);
    }
  })();

  inFlightContents.set(key, task);
  return await task;
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
  explicitProvider: ProviderId | undefined,
  searchProviderId: ProviderId | undefined,
) {
  if (explicitProvider) {
    try {
      return resolveProviderForCapability(
        config,
        explicitProvider,
        cwd,
        "contents",
      );
    } catch {
      // Explicit prefetch provider is unavailable — fall through so prefetch
      // is silently skipped rather than sinking a successful search.
      return undefined;
    }
  }

  if (searchProviderId) {
    try {
      return resolveProviderForCapability(
        config,
        searchProviderId,
        cwd,
        "contents",
      );
    } catch {
      // Fall back to the configured contents provider below.
    }
  }

  try {
    return resolveProviderForCapability(config, undefined, cwd, "contents");
  } catch {
    return undefined;
  }
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

function parseOptionalBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`prefetch.${field} must be a boolean.`);
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

function parseOptionalProviderId(value: unknown): ProviderId | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (isProviderId(value)) {
    return value;
  }
  throw new Error("prefetch.provider must be a valid provider id.");
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

function isStoredContentsValue(
  value: unknown,
): value is StoredContentsValue & JsonObject {
  if (!isJsonObject(value)) {
    return false;
  }
  return (
    typeof value.url === "string" &&
    isProviderId(value.provider) &&
    typeof value.text === "string" &&
    typeof value.fetchedAt === "number"
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
