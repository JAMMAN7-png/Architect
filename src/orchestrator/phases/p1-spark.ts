import { readFile } from "node:fs/promises";
import { docExists, projectDoc, readDoc, writeDoc, writeImmutableDoc } from "../../util/files.ts";
import { sha256 } from "../../util/fs.ts";
import { lastApprovalFor, presentApproval } from "../approvals.ts";
import type { PhaseContext, PhaseDefinition } from "../phase.ts";
import type { ArchitectState } from "../state.ts";

/**
 * P1 — Spark Capture. Receives the raw human spark, writes a draft to
 * `docs/00-human-spark.md`, and presents G1.
 *
 * The phase is idempotent: callable repeatedly. It examines the latest G1
 * approval to decide what to do.
 *   - approved  → freeze the file (chmod 0444), set state.spark, advance.
 *   - edited    → re-open the draft, re-present G1.
 *   - revised   → discard draft, re-prompt for spark, re-present G1.
 *   - rejected  → user explicitly aborted; engine surfaces, exits.
 *   - none yet  → capture spark, write draft, present G1.
 */
export const p1Spark: PhaseDefinition = {
  stage: "P1_SPARK_CAPTURE",
  label: "Spark capture",
  run: async (ctx) => runP1(ctx),
};

async function runP1(ctx: PhaseContext): Promise<ArchitectState> {
  const { state, prompts, bus } = ctx;
  const sparkPath = projectDoc(state.projectRoot, "00-human-spark.md");
  const last = lastApprovalFor(state, "G1");

  if (last?.status === "approved") {
    // Freeze (idempotent) and advance.
    if (!state.spark) {
      const text = await readDoc(sparkPath);
      // Re-write through writeImmutableDoc to ensure read-only bit, but only
      // if file exists. (If user edited via filesystem we honor the new content.)
      await writeImmutableDoc(sparkPath, text);
      return {
        ...state,
        spark: { path: sparkPath, sha256: sha256(text), immutable: true },
      };
    }
    return state;
  }

  if (last?.status === "rejected") {
    bus.emit({
      type: "error",
      message: "Spark capture rejected by user. Aborting.",
      recoverable: false,
    });
    throw new Error("spark capture aborted by user (G1 rejected)");
  }

  // Capture / re-capture path. If the spark file already exists on disk we
  // present G1 against its current content (the Telegram driver pre-stages
  // the file via an input-flow `onComplete`; the CLI driver enters with no
  // file present and falls through to `captureSpark`).
  let draft: string;
  if (await docExists(sparkPath)) {
    draft = await readDoc(sparkPath);
  } else {
    draft = await captureSpark(ctx);
    await writeDoc(sparkPath, draft);
  }

  return presentApproval(state, bus, {
    gate: "G1",
    artifact: relative(state.projectRoot, sparkPath),
    label: `Confirm your spark — ${describeSpark(draft)}`,
  });
}

async function captureSpark(ctx: PhaseContext): Promise<string> {
  const choice = await ctx.prompts.select<"file" | "type">("How will you provide your spark?", [
    { value: "file", label: "Read from a file path" },
    { value: "type", label: "Type or paste it now" },
  ]);
  if (choice === "file") {
    const path = (await ctx.prompts.text("Path to spark file")).trim();
    if (!path) throw new Error("no spark path provided");
    const content = await readFile(path, "utf8");
    if (!content.trim()) throw new Error(`spark file is empty: ${path}`);
    return content;
  }
  const typed = await ctx.prompts.text(
    "Paste your spark (single field; for long sparks, save to a file and use the 'file' option)",
    {
      multiline: true,
    },
  );
  if (!typed.trim()) throw new Error("empty spark");
  return typed;
}

function describeSpark(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= 80) return `${flat.length} chars`;
  return `${flat.length} chars — "${flat.slice(0, 60)}…"`;
}

function relative(from: string, to: string): string {
  const idx = to.indexOf(from);
  if (idx === 0)
    return to
      .slice(from.length)
      .replace(/^[/\\]/, "")
      .split("\\")
      .join("/");
  return to;
}
