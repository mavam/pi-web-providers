import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { JsonObject, JsonValue } from "./types.js";

export type ContentStoreEntryStatus = "pending" | "ready" | "failed";

export interface ContentStoreEntry<TValue extends JsonValue = JsonValue> {
  key: string;
  kind: string;
  status: ContentStoreEntryStatus;
  createdAt: number;
  updatedAt: number;
  expiresAt?: number;
  value?: TValue;
  error?: string;
  metadata?: JsonObject;
}

export interface ContentStore {
  get<TValue extends JsonValue = JsonValue>(
    key: string,
  ): Promise<ContentStoreEntry<TValue> | undefined>;
  put<TValue extends JsonValue = JsonValue>(
    entry: ContentStoreEntry<TValue>,
  ): Promise<void>;
  delete(key: string): Promise<void>;
  listByKind<TValue extends JsonValue = JsonValue>(
    kind: string,
  ): Promise<Array<ContentStoreEntry<TValue>>>;
  cleanup(now?: number): Promise<void>;
}

export class FileContentStore implements ContentStore {
  constructor(private readonly rootDir?: string) {}

  async get<TValue extends JsonValue = JsonValue>(
    key: string,
  ): Promise<ContentStoreEntry<TValue> | undefined> {
    try {
      const raw = await readFile(this.entryPath(key), "utf8");
      const parsed = JSON.parse(raw) as ContentStoreEntry<TValue>;
      if (parsed.key !== key) {
        return undefined;
      }
      return parsed;
    } catch (error) {
      if (isNotFoundError(error)) {
        return undefined;
      }
      throw error;
    }
  }

  async put<TValue extends JsonValue = JsonValue>(
    entry: ContentStoreEntry<TValue>,
  ): Promise<void> {
    await mkdir(this.getRootDir(), { recursive: true });
    await writeFile(this.entryPath(entry.key), JSON.stringify(entry, null, 2));
  }

  async delete(key: string): Promise<void> {
    await rm(this.entryPath(key), { force: true });
  }

  async listByKind<TValue extends JsonValue = JsonValue>(
    kind: string,
  ): Promise<Array<ContentStoreEntry<TValue>>> {
    try {
      const files = await readdir(this.getRootDir());
      const entries = await Promise.all(
        files
          .filter((file) => file.endsWith(".json"))
          .map(async (file) => {
            try {
              const raw = await readFile(join(this.getRootDir(), file), "utf8");
              return JSON.parse(raw) as ContentStoreEntry<TValue>;
            } catch {
              return undefined;
            }
          }),
      );
      return entries.filter(
        (entry): entry is ContentStoreEntry<TValue> => entry?.kind === kind,
      );
    } catch (error) {
      if (isNotFoundError(error)) {
        return [];
      }
      throw error;
    }
  }

  async cleanup(now = Date.now()): Promise<void> {
    try {
      const files = await readdir(this.getRootDir());
      await Promise.all(
        files
          .filter((file) => file.endsWith(".json"))
          .map(async (file) => {
            try {
              const raw = await readFile(join(this.getRootDir(), file), "utf8");
              const entry = JSON.parse(raw) as ContentStoreEntry;
              if (entry.expiresAt !== undefined && entry.expiresAt <= now) {
                await rm(join(this.getRootDir(), file), { force: true });
              }
            } catch {
              // Ignore unreadable cache files during best-effort cleanup.
            }
          }),
      );
    } catch (error) {
      if (isNotFoundError(error)) {
        return;
      }
      throw error;
    }
  }

  private entryPath(key: string): string {
    return join(this.getRootDir(), `${hashKey(key)}.json`);
  }

  private getRootDir(): string {
    return this.rootDir ?? getDefaultStoreRoot();
  }
}

export function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function createStoreKey(
  parts: Array<string | number | boolean>,
): string {
  return parts.map((part) => String(part)).join(":");
}

function getDefaultStoreRoot(): string {
  return join(homedir(), ".pi", "agent", "web-providers-cache");
}

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
