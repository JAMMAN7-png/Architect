import type { PageDefinition } from "../../engine/index.ts";
import { approachQuestionnairePage } from "./approach-questionnaire.ts";
import { blueprintPage } from "./blueprint.ts";
import { decisionsPage } from "./decisions.ts";
import { manifestPage } from "./manifest.ts";
import { maturationPage } from "./maturation.ts";
import { modePage } from "./mode.ts";
import { sketchPage } from "./sketch.ts";
import { sparkPage } from "./spark.ts";
import { stackQuestionnairePage } from "./stack-questionnaire.ts";
import { statusPage } from "./status.ts";
import { targetsPage } from "./targets.ts";
import { welcomePage } from "./welcome.ts";

/**
 * Architect page barrel. Pass `architectPages` to `startTelefocusBot`
 * (or `TeleFocus.attach`) so the registry can resolve every gate route.
 *
 * The custom pages G1 (`/spark`) and G2 (`/mode`) also expose action
 * registration helpers (`registerSparkPageActions`,
 * `registerModePageActions`) which the bootstrap MUST invoke from
 * inside the `actions` hook so their inline-button callbacks are wired.
 */
export const architectPages: PageDefinition[] = [
  welcomePage,
  statusPage,
  sparkPage,
  modePage,
  maturationPage,
  sketchPage,
  targetsPage,
  stackQuestionnairePage,
  approachQuestionnairePage,
  decisionsPage,
  manifestPage,
  blueprintPage,
];

export {
  approachQuestionnairePage,
  blueprintPage,
  decisionsPage,
  manifestPage,
  maturationPage,
  modePage,
  sketchPage,
  sparkPage,
  stackQuestionnairePage,
  statusPage,
  targetsPage,
  welcomePage,
};

export { registerSparkPageActions } from "./spark.ts";
export { registerModePageActions } from "./mode.ts";
