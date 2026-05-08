import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verify } from "../../src/core/verify.ts";

async function tmpDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "architect-verify-test-"));
}

async function writeAt(root: string, rel: string, content: string): Promise<void> {
  const path = join(root, rel);
  await mkdir(path.replace(/[\\/][^\\/]+$/, ""), { recursive: true });
  await writeFile(path, content, "utf8");
}

describe("verify", () => {
  it("ok when all docs are in whitelist and registry exists", async () => {
    const dir = await tmpDir();
    await writeAt(dir, "docs/spark.md", "# spark");
    await writeAt(dir, "docs/blueprint.md", "# blueprint");
    await writeAt(dir, "docs/doc-registry.md", "# registry");
    await writeAt(dir, "billing/payments/docs/spark.md", "# spark");
    await writeAt(dir, "billing/payments/docs/api-contract.md", "# api");

    const result = await verify(dir);
    expect(result.ok).toBe(true);
    expect(result.checked).toBeGreaterThanOrEqual(5);
    expect(result.violations).toEqual([]);
  });

  it("flags root .md outside whitelist", async () => {
    const dir = await tmpDir();
    await writeAt(dir, "docs/spark.md", "# spark");
    await writeAt(dir, "docs/random.md", "# rogue");
    await writeAt(dir, "docs/doc-registry.md", "# registry");

    const result = await verify(dir);
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.path.endsWith("docs/random.md"))).toBe(true);
  });

  it("flags .md inside <service>/src/", async () => {
    const dir = await tmpDir();
    await writeAt(dir, "docs/spark.md", "# spark");
    await writeAt(dir, "docs/doc-registry.md", "# registry");
    await writeAt(dir, "billing/payments/docs/spark.md", "# spark");
    await writeAt(dir, "billing/payments/src/notes.md", "# rogue");

    const result = await verify(dir);
    expect(result.ok).toBe(false);
    const v = result.violations.find((x) => x.path.includes("/src/notes.md"));
    expect(v).toBeDefined();
    expect(v?.reason).toContain("forbidden");
  });

  it("flags missing doc-registry.md", async () => {
    const dir = await tmpDir();
    await writeAt(dir, "docs/spark.md", "# spark");
    const result = await verify(dir);
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.reason.includes("doc-registry.md missing"))).toBe(true);
  });
});
