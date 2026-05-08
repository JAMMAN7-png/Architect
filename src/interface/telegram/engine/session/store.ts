import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { UserSession } from "../types.ts";
import { UserSessionSchema, freshSession } from "./schema.ts";

/**
 * Session storage. Two implementations:
 *
 *   - `MemorySessionStore`  in-process Map; default for tests.
 *   - `FileSessionStore`    JSON file per user under `<rootDir>/<userId>.json`.
 *
 * Both honour optimistic concurrency: `save()` returns `false` if the
 * stored copy has advanced past the caller's `version`. The caller MUST
 * then reload, re-apply, and retry.
 */

export interface SessionStore {
  load(userId: number, chatId: number): Promise<UserSession>;
  /** Returns false on version mismatch (caller must reload + retry). */
  save(session: UserSession): Promise<boolean>;
  delete(userId: number): Promise<void>;
}

// ── Memory store ─────────────────────────────────────────────────────

export class MemorySessionStore implements SessionStore {
  readonly #map = new Map<number, UserSession>();

  async load(userId: number, chatId: number): Promise<UserSession> {
    const existing = this.#map.get(userId);
    if (existing) return existing;
    const fresh = freshSession({ userId, chatId, now: Date.now() });
    await this.save(fresh);
    return fresh;
  }

  async save(session: UserSession): Promise<boolean> {
    const current = this.#map.get(session.userId);
    if (current && current.version !== session.version) return false;
    session.version += 1;
    this.#map.set(session.userId, session);
    return true;
  }

  async delete(userId: number): Promise<void> {
    this.#map.delete(userId);
  }
}

// ── File store ───────────────────────────────────────────────────────

export class FileSessionStore implements SessionStore {
  readonly #rootDir: string;

  constructor(rootDir: string) {
    this.#rootDir = rootDir;
  }

  #path(userId: number): string {
    return join(this.#rootDir, `${userId}.json`);
  }

  async load(userId: number, chatId: number): Promise<UserSession> {
    const file = this.#path(userId);
    const raw = await this.#readOrNull(file);
    if (raw === null || raw.trim() === "") {
      const fresh = freshSession({ userId, chatId, now: Date.now() });
      await this.save(fresh);
      return fresh;
    }
    return UserSessionSchema.parse(JSON.parse(raw));
  }

  async save(session: UserSession): Promise<boolean> {
    await mkdir(this.#rootDir, { recursive: true });
    const file = this.#path(session.userId);

    const raw = await this.#readOrNull(file);
    if (raw !== null && raw.trim() !== "") {
      const current = UserSessionSchema.parse(JSON.parse(raw));
      if (current.version !== session.version) return false;
    }

    session.version += 1;
    const payload = JSON.stringify(session);
    const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(tmp, payload, "utf8");
    try {
      await rename(tmp, file);
    } catch (err) {
      // best-effort cleanup; surface the original failure
      try {
        await unlink(tmp);
      } catch {
        // already gone; ignore
      }
      throw err;
    }
    return true;
  }

  async delete(userId: number): Promise<void> {
    const file = this.#path(userId);
    try {
      await unlink(file);
    } catch (err) {
      if (!isEnoent(err)) throw err;
    }
  }

  async #readOrNull(file: string): Promise<string | null> {
    try {
      return await readFile(file, "utf8");
    } catch (err) {
      if (isEnoent(err)) return null;
      throw err;
    }
  }
}

function isEnoent(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: unknown }).code === "ENOENT"
  );
}
