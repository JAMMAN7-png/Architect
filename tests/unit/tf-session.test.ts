import { describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { freshSession } from "../../src/interface/telegram/engine/session/schema.ts";
import {
  FileSessionStore,
  MemorySessionStore,
} from "../../src/interface/telegram/engine/session/store.ts";

/**
 * Session-store tests. Both implementations honour optimistic concurrency
 * via `version`; the file store additionally promises atomic writes
 * (no leftover `*.tmp-*` files on the happy path).
 */

describe("freshSession", () => {
  test("starts at root page, no input flow, version 1", () => {
    const s = freshSession({ userId: 1, chatId: 2, now: 1_000 });
    expect(s.menu.currentPage).toBe("/");
    expect(s.inputFlow.active).toBe(false);
    expect(s.version).toBe(1);
  });
});

describe("MemorySessionStore", () => {
  test("load on missing user creates fresh and saves", async () => {
    const store = new MemorySessionStore();
    const session = await store.load(11, 22);
    expect(session.userId).toBe(11);
    expect(session.chatId).toBe(22);
    expect(session.menu.currentPage).toBe("/");
    // First save bumped version 1 -> 2 inside `load`.
    expect(session.version).toBe(2);
  });

  test("save returns true, stale version returns false, reload+save returns true", async () => {
    const store = new MemorySessionStore();
    const session = await store.load(1, 1);
    // Snapshot a stale copy BEFORE the next save bumps version.
    const stale = JSON.parse(JSON.stringify(session)) as typeof session;

    expect(await store.save(session)).toBe(true);
    expect(await store.save(stale)).toBe(false);

    const reloaded = await store.load(1, 1);
    expect(await store.save(reloaded)).toBe(true);
  });
});

describe("FileSessionStore", () => {
  test("round-trips across two store instances", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tf-sess-rt-"));
    try {
      const writer = new FileSessionStore(dir);
      const session = await writer.load(42, 84);
      session.menu.lastAction = "ping";
      expect(await writer.save(session)).toBe(true);

      const reader = new FileSessionStore(dir);
      const loaded = await reader.load(42, 84);
      expect(loaded.menu.lastAction).toBe("ping");
      expect(loaded.userId).toBe(42);
      expect(loaded.chatId).toBe(84);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("version mismatch returns false", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tf-sess-vm-"));
    try {
      const store = new FileSessionStore(dir);
      const a = await store.load(7, 7);
      const b = await store.load(7, 7); // independent in-memory copy

      expect(await store.save(a)).toBe(true); // disk version advances
      expect(await store.save(b)).toBe(false); // b is now stale
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("save leaves no temp file behind (atomic write)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tf-sess-at-"));
    try {
      const store = new FileSessionStore(dir);
      const session = await store.load(99, 100);
      session.menu.lastAction = "tick";
      expect(await store.save(session)).toBe(true);

      const entries = readdirSync(dir);
      expect(entries).toContain("99.json");
      const stragglers = entries.filter((e) => e.startsWith("99.json.tmp-"));
      expect(stragglers).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
