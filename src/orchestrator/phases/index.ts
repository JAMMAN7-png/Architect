import { PhaseRegistry } from "../phase.ts";
import { p0Bootstrap } from "./p0-bootstrap.ts";
import { p1Spark } from "./p1-spark.ts";
import { p2Mode } from "./p2-mode.ts";
import { p3Maturation } from "./p3-maturation.ts";
import { p4Sketch } from "./p4-sketch.ts";
import { p5Targets } from "./p5-targets.ts";
import { p6StackQ } from "./p6-stack-q.ts";
import { p7Research } from "./p7-research.ts";
import { p8Approach } from "./p8-approach.ts";
import { p9Decisions } from "./p9-decisions.ts";
import { p10Manifest } from "./p10-manifest.ts";
import { p11Docs } from "./p11-docs.ts";
import { p12Blueprint } from "./p12-blueprint.ts";

/**
 * Default phase registry. Phases are registered as they are implemented;
 * the engine throws `MissingPhaseError` for any stage not yet wired.
 */
export function buildDefaultRegistry(): PhaseRegistry {
  const r = new PhaseRegistry();
  r.register(p0Bootstrap);
  r.register(p1Spark);
  r.register(p2Mode);
  r.register(p3Maturation);
  r.register(p4Sketch);
  r.register(p5Targets);
  r.register(p6StackQ);
  r.register(p7Research);
  r.register(p8Approach);
  r.register(p9Decisions);
  r.register(p10Manifest);
  r.register(p11Docs);
  r.register(p12Blueprint);
  return r;
}
