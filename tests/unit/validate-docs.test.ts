import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { matchesGlob, validateDocs } from "../../src/validate/docs.ts";

describe("docs validator", () => {
  test("matchesGlob handles ** and *", () => {
    expect(matchesGlob("docs/blueprint/00-overview.md", "docs/blueprint/**/*.md")).toBe(true);
    expect(matchesGlob("docs/blueprint/sub/00.md", "docs/blueprint/**/*.md")).toBe(true);
    expect(matchesGlob("docs/research/runtime.md", "docs/blueprint/**/*.md")).toBe(false);
  });

  test("rejects out-of-tree markdown", async () => {
    const root = mkdtempSync(join(tmpdir(), "arch-v-"));
    try {
      await mkdir(join(root, "docs"), { recursive: true });
      await writeFile(join(root, "docs/spec.md"), "# spec");
      await writeFile(join(root, "stray.md"), "# stray");
      const res = await validateDocs(root, [{ path: "docs/spec.md", purpose: "spec" }]);
      expect(res.ok).toBe(false);
      expect(res.errors.some((e) => e.includes("markdown outside docs/"))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("rejects markdown inside src/", async () => {
    const root = mkdtempSync(join(tmpdir(), "arch-v-"));
    try {
      await mkdir(join(root, "docs"), { recursive: true });
      await mkdir(join(root, "src"), { recursive: true });
      await writeFile(join(root, "src/notes.md"), "");
      const res = await validateDocs(root, []);
      expect(res.ok).toBe(false);
      expect(res.errors.some((e) => e.includes("inside src/"))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("rejects forbidden filenames", async () => {
    const root = mkdtempSync(join(tmpdir(), "arch-v-"));
    try {
      await mkdir(join(root, "docs"), { recursive: true });
      await writeFile(join(root, "docs/notes.md"), "");
      const res = await validateDocs(root, [{ path: "docs/notes.md", purpose: "x" }]);
      expect(res.ok).toBe(false);
      expect(res.errors.some((e) => e.includes("forbidden filename"))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("rejects research docs missing required sections", async () => {
    const root = mkdtempSync(join(tmpdir(), "arch-v-"));
    try {
      await mkdir(join(root, "docs/research"), { recursive: true });
      await writeFile(
        join(root, "docs/research/runtime.md"),
        "# Runtime\n## Decision Summary\nX\n",
      );
      const res = await validateDocs(root, [
        { path: "docs/research/runtime.md", purpose: "runtime doc" },
      ]);
      expect(res.ok).toBe(false);
      expect(res.errors.some((e) => e.includes("Approved Choice"))).toBe(true);
      expect(res.errors.some((e) => e.includes("Blueprint References"))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("passes a clean project", async () => {
    const root = mkdtempSync(join(tmpdir(), "arch-v-"));
    try {
      await mkdir(join(root, "docs/blueprint"), { recursive: true });
      await mkdir(join(root, "docs/research"), { recursive: true });
      await writeFile(join(root, "docs/00-spark.md"), "# spark");
      await writeFile(
        join(root, "docs/research/x.md"),
        "# X\n## Decision Summary\n.\n## Approved Choice\n.\n## Blueprint References\n.\n",
      );
      await writeFile(join(root, "docs/blueprint/00-overview.md"), "# overview");
      const res = await validateDocs(root, [
        { path: "docs/00-spark.md", purpose: "spark" },
        { path: "docs/research/x.md", purpose: "x" },
        { path: "docs/blueprint/**/*.md", pattern: "docs/blueprint/**/*.md", purpose: "blueprint" },
      ]);
      expect(res.ok).toBe(true);
      expect(res.errors).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
