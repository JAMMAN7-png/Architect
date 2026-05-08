import { makeGatePage } from "../gate-page.ts";

/**
 * `/maturation` — G3 Spark Maturation review.
 *
 * The orchestrator (P3) has already produced either a grown spark
 * (`brainstorm` mode) or a checkup report, depending on the mode chosen
 * at G2. The page only surfaces the artifact and the standard
 * Approve / Edit / Revise / Reject keyboard.
 */
export const maturationPage = makeGatePage({
  path: "/maturation",
  parent: "/",
  gate: "G3",
  title: "Spark Maturation",
  nextPath: "/sketch",
  artifactPath: (s) => s.grownSparkPath ?? s.checkupPath ?? null,
  summarise: (s) =>
    s.sparkMode === "brainstorm"
      ? "Grown spark ready."
      : s.sparkMode === "checkup"
        ? "Checkup ready."
        : "Continuing with spark unchanged.",
});
