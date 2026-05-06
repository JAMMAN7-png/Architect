import { describe, expect, it } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildRegistry, renderRegistryMd } from "../../src/core/registry.ts";

async function tmpDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "architect-test-"));
}

async function writeAt(root: string, rel: string, content: string): Promise<void> {
  const path = join(root, rel);
  const { mkdir } = await import("node:fs/promises");
  await mkdir(path.replace(/[\\/][^\\/]+$/, ""), { recursive: true });
  await writeFile(path, content, "utf8");
}

describe("registry", () => {
  it("walks root + service docs and produces stable, sorted entries", async () => {
    const dir = await tmpDir();
    await writeAt(dir, "docs/spark.md", "# spark");
    await writeAt(dir, "docs/blueprint.md", "# blueprint");
    await writeAt(dir, "docs/architecture/service-map.md", "# map");
    await writeAt(dir, "safety/csam-shield/docs/spark.md", "# csam spark");
    await writeAt(dir, "safety/csam-shield/docs/api-contract.md", "# api");

    const entries = await buildRegistry(dir);
    const paths = entries.map((e) => e.path);
    expect(paths).toContain("docs/spark.md");
    expect(paths).toContain("docs/blueprint.md");
    expect(paths).toContain("docs/architecture/service-map.md");
    expect(paths).toContain("safety/csam-shield/docs/spark.md");
    expect(paths).toContain("safety/csam-shield/docs/api-contract.md");

    // Sorted
    const sorted = [...paths].sort();
    expect(paths).toEqual(sorted);

    // Service entries are tagged with serviceId
    const csamSpark = entries.find((e) => e.path === "safety/csam-shield/docs/spark.md");
    expect(csamSpark?.serviceId).toBe("csam-shield");
  });

  it("renderRegistryMd produces a valid markdown table with all entries", async () => {
    const dir = await tmpDir();
    await writeAt(dir, "docs/spark.md", "# spark");
    const entries = await buildRegistry(dir);
    const md = renderRegistryMd(entries);
    expect(md).toContain("# Documentation Registry");
    expect(md).toContain("docs/spark.md");
    expect(md).toContain("**Entries:** 1");
  });

  it("ignores .md files outside whitelist (root scope)", async () => {
    const dir = await tmpDir();
    await writeAt(dir, "docs/spark.md", "# spark");
    await writeAt(dir, "docs/random-notes.md", "# rogue");
    const entries = await buildRegistry(dir);
    const paths = entries.map((e) => e.path);
    expect(paths).toContain("docs/spark.md");
    expect(paths).not.toContain("docs/random-notes.md");
  });
});
