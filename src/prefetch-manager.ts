import { createHash } from "node:crypto";
import type { ContentsAnswer, ContentsResponse } from "./contents.js";
import {
  getEffectiveProviderConfig,
  getProviderCapabilityStatus,
  isProviderCapabilityReady,
} from "./provider-resolution.js";
import { executeProviderRequest } from "./provider-runtime.js";
import { supportsTool } from "./provider-tools.js";
import { ADAPTERS_BY_ID, PROVIDER_IDS } from "./providers/index.js";
import type { ProviderId, SearchSettings, WebProviders } from "./types.js";

const CONTENT_CACHE_VERSION = 2;

export const DEFAULT_CONTENT_TTL_MS = 30 * 60 * 1000;
export const DEFAULT_PREFETCH_MAX_URLS = 3;
const MAX_PREFETCH_URLS = 5;

export interface SearchContentsPrefetchOptions {
  provider?: ProviderId | null;
  maxUrls?: number;
  ttlMs?: number;
}

export interface PrefetchStartResult {
  provider: ProviderId;
  urlCount: number;
}

interface CachedContent {
  provider: ProviderId;
  item: ContentsAnswer;
  expiresAt: number;
}

interface EnsureContentsArgs {
  url: string;
  providerId: ProviderId;
  config: WebProviders;
  cwd: string;
  options: Record<string, unknown> | undefined;
  ttlMs?: number;
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
  generation?: number;
}

const contentCache = new Map<string, CachedContent>();
const inFlightContents = new Map<
  string,
  { generation: number; task: Promise<CachedContent> }
>();
let contentStoreGeneration = 0;

export async function cleanupContentStore(): Promise<void> {
  cleanupExpiredEntries();
}

export async function startContentsPrefetch({
  config,
  cwd,
  urls,
  options,
  onProgress,
}: {
  config: WebProviders;
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

  const generation = contentStoreGeneration;
  const ttlMs = clampTtlMs(options.ttlMs);

  void Promise.allSettled(
    selectedUrls.map((url) =>
      ensureContentsStored({
        url,
        providerId: provider.id,
        config,
        cwd,
        options: undefined,
        ttlMs,
        onProgress,
        generation,
      }),
    ),
  );

  return {
    provider: provider.id,
    urlCount: selectedUrls.length,
  };
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
  config: WebProviders;
  cwd: string;
  options: Record<string, unknown> | undefined;
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
}): Promise<ContentsResponse> {
  cleanupExpiredEntries();

  if (
    urls.length <= 1 ||
    urls.some((url) => hasReusableContents(url, providerId, options))
  ) {
    return await resolvePerUrlContents({
      urls,
      providerId,
      config,
      cwd,
      options,
      signal,
      onProgress,
    });
  }

  return await fetchBatchContents({
    urls,
    providerId,
    config,
    cwd,
    options,
    signal,
    onProgress,
  });
}

export function mergeSearchContentsPrefetchOptions(
  defaults: SearchSettings | undefined,
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
  };
}

export function resetContentStore(): void {
  contentStoreGeneration += 1;
  contentCache.clear();
  inFlightContents.clear();
}

async function resolvePerUrlContents({
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
  config: WebProviders;
  cwd: string;
  options: Record<string, unknown> | undefined;
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
}): Promise<ContentsResponse> {
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

  const answers: ContentsAnswer[] = [];
  const failures: Array<{ url: string; error: string }> = [];
  let resolvedProvider: ProviderId | undefined;

  for (const [index, result] of settled.entries()) {
    if (result.status === "fulfilled") {
      resolvedProvider ??= result.value.provider;
      answers.push(result.value.item);
    } else {
      failures.push({
        url: urls[index] ?? "",
        error: formatUnknownError(result.reason),
      });
    }
  }

  if (answers.length === 0 && failures.length > 0) {
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

  return {
    provider: resolvedProvider ?? providerId,
    answers: orderContentsForRequest(
      [
        ...answers,
        ...failures.map((failure) => ({
          url: failure.url,
          error: failure.error,
        })),
      ],
      urls,
    ),
  };
}

async function fetchBatchContents({
  urls,
  providerId,
  config,
  cwd,
  options,
  signal,
  onProgress,
  ttlMs = DEFAULT_CONTENT_TTL_MS,
  generation = contentStoreGeneration,
}: {
  urls: string[];
  providerId: ProviderId;
  config: WebProviders;
  cwd: string;
  options: Record<string, unknown> | undefined;
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
  ttlMs?: number;
  generation?: number;
}): Promise<ContentsResponse> {
  const normalizedUrls = normalizeBatchUrls(urls);
  if (normalizedUrls.length === 0) {
    throw new Error("At least one valid HTTP(S) URL is required.");
  }

  const response = await fetchContentsViaProvider({
    urls: normalizedUrls,
    providerId,
    config,
    cwd,
    options,
    signal,
    onProgress,
  });

  const expiresAt = Date.now() + ttlMs;
  for (const answer of response.answers) {
    const canonicalUrl = canonicalizeUrl(answer.url);
    if (
      answer.error !== undefined ||
      answer.content === undefined ||
      !/^https?:\/\//i.test(canonicalUrl)
    ) {
      continue;
    }

    setCachedContents(
      buildContentsCacheKey(canonicalUrl, response.provider, options),
      {
        provider: response.provider,
        item: toStoredContentItem(answer),
        expiresAt,
      },
      generation,
    );
  }

  return {
    provider: response.provider,
    answers: orderContentsForRequest(response.answers, urls),
  };
}

async function ensureContentsStored({
  url,
  providerId,
  config,
  cwd,
  options,
  signal,
  onProgress,
  ttlMs = DEFAULT_CONTENT_TTL_MS,
  generation = contentStoreGeneration,
}: EnsureContentsArgs): Promise<CachedContent> {
  const canonicalUrl = canonicalizeUrl(url);
  const key = buildContentsCacheKey(canonicalUrl, providerId, options);

  const cached = getCachedContents(key);
  if (cached) {
    return cached;
  }

  const inFlight = inFlightContents.get(key);
  if (inFlight) {
    return await inFlight.task;
  }

  let task!: Promise<CachedContent>;
  task = (async () => {
    try {
      const response = await fetchContentsViaProvider({
        urls: [canonicalUrl],
        providerId,
        config,
        cwd,
        options,
        signal,
        onProgress,
      });
      const answer = findAnswerForUrl(response.answers, canonicalUrl) ?? {
        url: canonicalUrl,
        error: "No content returned for this URL.",
      };
      const stored = {
        provider: response.provider,
        item: toStoredContentItem(answer),
        expiresAt: Date.now() + ttlMs,
      } satisfies CachedContent;
      setCachedContents(key, stored, generation);
      return stored;
    } finally {
      const current = inFlightContents.get(key);
      if (current?.generation === generation && current.task === task) {
        inFlightContents.delete(key);
      }
    }
  })();

  inFlightContents.set(key, { generation, task });
  return await task;
}

async function fetchContentsViaProvider({
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
  config: WebProviders;
  cwd: string;
  options: Record<string, unknown> | undefined;
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
}): Promise<ContentsResponse> {
  const provider = ADAPTERS_BY_ID[providerId];
  const providerConfig = getEffectiveProviderConfig(config, providerId);

  onProgress?.(
    `Fetching contents via ${provider.label} for ${urls.length} URL(s)`,
  );
  const result = await executeProviderRequest(
    provider,
    providerConfig,
    {
      capability: "contents",
      urls,
      options,
    },
    {
      cwd,
      signal,
      onProgress,
    },
  );
  if (!isContentsResponse(result)) {
    throw new Error(`${provider.label} contents returned an invalid result.`);
  }
  return result;
}

function cleanupExpiredEntries(now = Date.now()): void {
  for (const [key, entry] of contentCache) {
    if (entry.expiresAt <= now) {
      contentCache.delete(key);
    }
  }
}

function hasReusableContents(
  url: string,
  providerId: ProviderId,
  options: Record<string, unknown> | undefined,
): boolean {
  const key = buildContentsCacheKey(canonicalizeUrl(url), providerId, options);
  return getCachedContents(key) !== undefined || inFlightContents.has(key);
}

function getCachedContents(key: string): CachedContent | undefined {
  const cached = contentCache.get(key);
  if (!cached) {
    return undefined;
  }
  if (cached.expiresAt <= Date.now()) {
    contentCache.delete(key);
    return undefined;
  }
  return cached;
}

function setCachedContents(
  key: string,
  value: CachedContent,
  generation: number,
): void {
  if (generation === contentStoreGeneration) {
    contentCache.set(key, value);
  }
}

function findAnswerForUrl(
  answers: ContentsAnswer[],
  url: string,
): ContentsAnswer | undefined {
  return answers.find((answer) => canonicalizeUrl(answer.url) === url);
}

function toStoredContentItem(answer: ContentsAnswer): ContentsAnswer {
  return {
    url: answer.url,
    ...(answer.content !== undefined ? { content: answer.content } : {}),
    ...(answer.summary !== undefined ? { summary: answer.summary } : {}),
    ...(answer.metadata !== undefined ? { metadata: answer.metadata } : {}),
    ...(answer.error !== undefined ? { error: answer.error } : {}),
  };
}

function orderContentsForRequest(
  answers: ContentsAnswer[],
  urls: string[],
): ContentsAnswer[] {
  const byUrl = new Map<string, ContentsAnswer[]>();
  const extras: ContentsAnswer[] = [];

  for (const answer of answers) {
    if (!answer.url) {
      extras.push(answer);
      continue;
    }
    const key = canonicalizeUrl(answer.url);
    const bucket = byUrl.get(key);
    if (bucket) {
      bucket.push(answer);
    } else {
      byUrl.set(key, [answer]);
    }
  }

  const ordered: ContentsAnswer[] = [];
  for (const url of urls) {
    const bucket = byUrl.get(canonicalizeUrl(url));
    const next = bucket?.shift();
    if (next) {
      ordered.push(next);
    }
  }

  for (const bucket of byUrl.values()) {
    ordered.push(...bucket);
  }
  ordered.push(...extras);
  return ordered.length > 0 ? ordered : answers;
}

function buildContentsCacheKey(
  url: string,
  providerId: ProviderId,
  options: Record<string, unknown> | undefined,
): string {
  return [
    "web-contents",
    `v${CONTENT_CACHE_VERSION}`,
    providerId,
    hashString(url),
    hashOptions(options),
  ].join(":");
}

function hashOptions(options: Record<string, unknown> | undefined): string {
  return hashString(stableStringify(options ?? {}));
}

function hashString(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function resolveContentsProvider(
  config: WebProviders,
  cwd: string,
  explicitProvider: ProviderId | null | undefined,
) {
  if (!explicitProvider) {
    return undefined;
  }

  const provider = ADAPTERS_BY_ID[explicitProvider];
  if (!supportsTool(explicitProvider, "contents")) {
    return undefined;
  }

  const status = getProviderCapabilityStatus(
    config,
    cwd,
    explicitProvider,
    "contents",
  );
  return isProviderCapabilityReady(status) ? provider : undefined;
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

function normalizeBatchUrls(urls: string[]): string[] {
  return [...new Set(urls.map((url) => canonicalizeUrl(url)).filter(Boolean))]
    .filter((url) => /^https?:\/\//i.test(url))
    .sort();
}

function selectPrefetchUrls(
  urls: string[],
  maxUrls: number | undefined,
): string[] {
  const limit = clampPrefetchUrlCount(maxUrls);
  const seen = new Set<string>();
  const selected: string[] = [];

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

function stableStringify(value: unknown): string {
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
        `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`,
    )
    .join(",")}}`;
}

function formatUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isProviderId(value: unknown): value is ProviderId {
  return (
    typeof value === "string" && PROVIDER_IDS.includes(value as ProviderId)
  );
}

function isContentsResponse(value: unknown): value is ContentsResponse {
  return (
    isJsonObject(value) &&
    isProviderId(value.provider) &&
    Array.isArray(value.answers) &&
    value.answers.every((item) => isContentsAnswer(item))
  );
}

function isContentsAnswer(
  value: unknown,
): value is ContentsAnswer & Record<string, unknown> {
  return (
    isJsonObject(value) &&
    (value.url === undefined || typeof value.url === "string") &&
    (value.content === undefined || typeof value.content === "string") &&
    (value.error === undefined || typeof value.error === "string") &&
    (value.metadata === undefined || isJsonObject(value.metadata))
  );
}
