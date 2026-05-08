import {
  brainstormSpark,
  checkupSpark,
  deriveProductEssence,
} from "../../agents/spark-maturation.ts";
import { projectDoc, readDoc, writeDoc } from "../../util/files.ts";
import { lastApprovalFor, presentApproval } from "../approvals.ts";
import type { PhaseContext, PhaseDefinition } from "../phase.ts";
import type { ArchitectState } from "../state.ts";

/**
 * P3 — Spark Maturation. Runs Brainstorm, Checkup, or Skip per state.sparkMode.
 *
 * Idempotent against G3:
 *   - approved → derive `02-approved-product-essence.md`, advance.
 *   - rejected → abort.
 *   - edited / revised / not yet → (re)run the maturation step and present G3.
 */
export const p3Maturation: PhaseDefinition = {
  stage: "P3_SPARK_MATURATION",
  label: "Spark maturation",
  run: async (ctx) => runP3(ctx),
};

async function runP3(ctx: PhaseContext): Promise<ArchitectState> {
  const { state, prompts, bus, router } = ctx;
  if (!state.spark) throw new Error("P3 entered without a frozen spark");
  if (!state.sparkMode) throw new Error("P3 entered without a spark mode");

  const sparkText = await readDoc(state.spark.path);
  const last = lastApprovalFor(state, "G3");

  if (last?.status === "approved") {
    if (!state.approvedEssencePath) {
      const maturation = state.grownSparkPath
        ? await readDoc(state.grownSparkPath)
        : state.checkupPath
          ? await readDoc(state.checkupPath)
          : null;
      const essence = await deriveProductEssence({
        router,
        bus,
        spark: sparkText,
        maturation,
      });
      const target = projectDoc(state.projectRoot, "02-approved-product-essence.md");
      await writeDoc(target, essence);
      return { ...state, approvedEssencePath: target };
    }
    return state;
  }

  if (last?.status === "rejected") {
    throw new Error("spark maturation rejected by user (G3 rejected)");
  }

  // Run the chosen maturation strategy.
  let next: ArchitectState = state;
  let artifactPath: string;
  let artifactLabel: string;

  if (state.sparkMode === "brainstorm") {
    const grown = await brainstormSpark({ router, bus, spark: sparkText });
    artifactPath = projectDoc(state.projectRoot, "01-grown-spark.md");
    await writeDoc(artifactPath, grown);
    next = { ...next, grownSparkPath: artifactPath, checkupPath: null };
    artifactLabel = "Approve grown spark";
  } else if (state.sparkMode === "checkup") {
    const checkup = await checkupSpark({ router, bus, spark: sparkText });
    artifactPath = projectDoc(state.projectRoot, "01-spark-checkup.md");
    await writeDoc(artifactPath, checkup);
    next = { ...next, checkupPath: artifactPath, grownSparkPath: null };
    artifactLabel = "Approve spark checkup (and continue with original spark)";
  } else {
    // skip — no intermediate doc; user just confirms to proceed.
    artifactPath = state.spark.path;
    next = { ...next, grownSparkPath: null, checkupPath: null };
    artifactLabel = "Approve continuing with the spark unchanged";
  }

  // If the previous attempt was 'revised', we may want a confirm before
  // presenting the gate (the agent already used budget).
  if (last?.status === "revised") {
    const ok = await prompts.confirm(
      "Maturation re-run complete. Inspect the new artifact and decide?",
      true,
    );
    if (!ok) throw new Error("user aborted after revision");
  }

  return presentApproval(next, bus, {
    gate: "G3",
    artifact: relativise(state.projectRoot, artifactPath),
    label: artifactLabel,
  });
}

function relativise(from: string, to: string): string {
  if (to.startsWith(from))
    return to
      .slice(from.length)
      .replace(/^[/\\]/, "")
      .split("\\")
      .join("/");
  return to;
}
