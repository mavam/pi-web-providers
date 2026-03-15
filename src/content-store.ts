import { createHash } from "node:crypto";
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

export class MemoryContentStore implements ContentStore {
  private entries = new Map<string, ContentStoreEntry>();

  clear(): void {
    this.entries.clear();
  }

  async get<TValue extends JsonValue = JsonValue>(
    key: string,
  ): Promise<ContentStoreEntry<TValue> | undefined> {
    return this.entries.get(key) as ContentStoreEntry<TValue> | undefined;
  }

  async put<TValue extends JsonValue = JsonValue>(
    entry: ContentStoreEntry<TValue>,
  ): Promise<void> {
    this.entries.set(entry.key, entry as ContentStoreEntry);
  }

  async delete(key: string): Promise<void> {
    this.entries.delete(key);
  }

  async listByKind<TValue extends JsonValue = JsonValue>(
    kind: string,
  ): Promise<Array<ContentStoreEntry<TValue>>> {
    const result: Array<ContentStoreEntry<TValue>> = [];
    for (const entry of this.entries.values()) {
      if (entry.kind === kind) {
        result.push(entry as ContentStoreEntry<TValue>);
      }
    }
    return result;
  }

  async cleanup(now = Date.now()): Promise<void> {
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt !== undefined && entry.expiresAt <= now) {
        this.entries.delete(key);
      }
    }
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
