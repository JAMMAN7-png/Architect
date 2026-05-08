#!/usr/bin/env bun
/**
 * Wrapper around `bun build` that injects ARCHITECT_VERSION from package.json
 * so compiled binaries report the right version.
 *
 * Usage:
 *   bun scripts/build.ts                                  # bundle to dist/architect.js
 *   bun scripts/build.ts --compile                        # compile single-file binary for current platform
 *   bun scripts/build.ts --compile --target=bun-linux-x64 # cross-compile
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const pkgPath = fileURLToPath(new URL("../package.json", import.meta.url));
const pkg = JSON.parse(await Bun.file(pkgPath).text());
const version: string = pkg.version;

const args = process.argv.slice(2);
const compile = args.includes("--compile");

const targetIdx = args.findIndex((a) => a === "--target");
const target = targetIdx >= 0 ? args[targetIdx + 1] : undefined;
const targetEq = args.find((a) => a.startsWith("--target="));
const targetVal = target ?? targetEq?.split("=", 2)[1];

const outIdx = args.findIndex((a) => a === "--outfile");
const out = outIdx >= 0 ? args[outIdx + 1] : undefined;
const outEq = args.find((a) => a.startsWith("--outfile="));
const outVal = out ?? outEq?.split("=", 2)[1] ?? defaultOut(compile, targetVal);

const cmd = ["build", "src/cli/index.ts"];
if (compile) cmd.push("--compile");
if (targetVal) cmd.push(`--target=${targetVal}`);
else if (!compile) cmd.push("--target=node");
cmd.push(`--outfile=${outVal}`);
cmd.push("--define", `ARCHITECT_VERSION=${JSON.stringify(version)}`);
const result = spawnSync("bun", cmd, { stdio: "inherit" });
process.exit(result.status ?? 1);

function defaultOut(compile: boolean, target?: string): string {
  if (!compile) return "dist/architect.js";
  if (!target) return "dist/architect";
  // dist/architect-{linux|darwin|windows}-{x64|arm64}[.exe]
  const m = /^bun-(linux|darwin|windows)-(x64|arm64)$/.exec(target);
  if (!m) return "dist/architect";
  const ext = m[1] === "windows" ? ".exe" : "";
  return `dist/architect-${m[1]}-${m[2]}${ext}`;
}
