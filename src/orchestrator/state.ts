import { z } from "zod";

/**
 * Architect orchestrator state — the single source of truth for an in-flight
 * project. Persisted as `projects/<name>/architect.state.json` (atomic writes,
 * write-temp-rename). Approvals are append-only.
 */

export const Stage = z.enum([
  "P0_BOOTSTRAP",
  "P1_SPARK_CAPTURE",
  "P2_MODE_SELECTION",
  "P3_SPARK_MATURATION",
  "P4_BLUEPRINT_SKETCH",
  "P5_RESEARCH_TARGETS",
  "P6_STACK_QUESTIONNAIRE",
  "P7_DEEP_RESEARCH",
  "P8_APPROACH_QUESTIONNAIRE",
  "P9_DECISION_SETTLEMENT",
  "P10_DOCS_MANIFEST",
  "P11_DOCS_GENERATION",
  "P12_BLUEPRINT_ASSEMBLY",
  "DONE",
]);
export type Stage = z.infer<typeof Stage>;

export const GateId = z.enum([
  "G1", // spark complete
  "G2", // mode selection
  "G3", // approve grown / checked spark
  "G4", // approve sketch
  "G5", // approve research target list
  "G6", // stack questionnaire answers
  "G7", // approach questionnaire answers
  "G8", // approve final decisions
  "G9", // approve docs manifest
  "G10", // blueprint lock
]);
export type GateId = z.infer<typeof GateId>;

export const SparkMode = z.enum(["brainstorm", "checkup", "skip"]);
export type SparkMode = z.infer<typeof SparkMode>;

export const ApprovalStatus = z.enum(["approved", "rejected", "edited", "revised"]);
export type ApprovalStatus = z.infer<typeof ApprovalStatus>;

export const Approval = z.object({
  id: z.string(),
  gate: GateId,
  status: ApprovalStatus,
  artifact: z.string(),
  approvedBy: z.literal("user"),
  signedAt: z.string(),
  notes: z.string().optional(),
});
export type Approval = z.infer<typeof Approval>;

export const PendingApproval = z.object({
  id: z.string(),
  gate: GateId,
  artifact: z.string(),
  presentedAt: z.string(),
  label: z.string(),
});
export type PendingApproval = z.infer<typeof PendingApproval>;

export const SparkRef = z.object({
  path: z.string(),
  sha256: z.string(),
  immutable: z.literal(true),
});
export type SparkRef = z.infer<typeof SparkRef>;

export const ResearchTarget = z.object({
  id: z.string(),
  name: z.string(),
  category: z.string(),
  rationale: z.string(),
  userSpecified: z.boolean().default(false),
  approved: z.boolean().default(false),
});
export type ResearchTarget = z.infer<typeof ResearchTarget>;

export const ResearchFindingState = z.object({
  id: z.string(),
  targetId: z.string(),
  topic: z.string(),
  source: z.string(),
  title: z.string(),
  excerpt: z.string(),
  relevance: z.number().min(0).max(1),
  critical: z.boolean().default(false),
  capturedAt: z.string(),
});
export type ResearchFindingState = z.infer<typeof ResearchFindingState>;

export const Decision = z.object({
  id: z.string(),
  question: z.string(),
  answer: z.string(),
  source: z.enum(["stack-q", "approach-q", "settlement"]),
  references: z.array(z.string()).default([]),
  recordedAt: z.string(),
});
export type Decision = z.infer<typeof Decision>;

export const ModelCall = z.object({
  id: z.string(),
  agent: z.string(),
  tier: z.enum(["strategic", "ensemble", "execution", "ui"]),
  modelId: z.string(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  usd: z.number(),
  ms: z.number(),
  startedAt: z.string(),
});
export type ModelCall = z.infer<typeof ModelCall>;

export const ErrorEvent = z.object({
  id: z.string(),
  stage: Stage,
  agent: z.string().optional(),
  message: z.string(),
  recoverable: z.boolean(),
  occurredAt: z.string(),
});
export type ErrorEvent = z.infer<typeof ErrorEvent>;

export const ArchitectState = z
  .object({
    schemaVersion: z.literal(1).default(1),
    projectId: z.string(),
    projectName: z.string(),
    projectRoot: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
    currentStage: Stage,
    sparkMode: SparkMode.nullable().default(null),
    spark: SparkRef.nullable().default(null),
    grownSparkPath: z.string().nullable().default(null),
    checkupPath: z.string().nullable().default(null),
    approvedEssencePath: z.string().nullable().default(null),
    sketchPath: z.string().nullable().default(null),
    decisionsPath: z.string().nullable().default(null),
    docsManifestPath: z.string().nullable().default(null),
    blueprintLocked: z.boolean().default(false),
    blueprintLockedAt: z.string().nullable().default(null),
    pendingApproval: PendingApproval.nullable().default(null),
    approvals: z.array(Approval).default([]),
    researchTargets: z.array(ResearchTarget).default([]),
    researchFindings: z.array(ResearchFindingState).default([]),
    decisions: z.array(Decision).default([]),
    modelCalls: z.array(ModelCall).default([]),
    errors: z.array(ErrorEvent).default([]),
  })
  .strict();
export type ArchitectState = z.infer<typeof ArchitectState>;

/** Fresh state at P0 — orchestrator transitions to P1 immediately on first run. */
export function freshState(input: {
  projectId: string;
  projectName: string;
  projectRoot: string;
  now: string;
}): ArchitectState {
  return ArchitectState.parse({
    projectId: input.projectId,
    projectName: input.projectName,
    projectRoot: input.projectRoot,
    createdAt: input.now,
    updatedAt: input.now,
    currentStage: "P0_BOOTSTRAP",
  });
}

/** Stage → primary gate associated with that stage (if any). */
export const STAGE_GATE: Partial<Record<Stage, GateId>> = {
  P1_SPARK_CAPTURE: "G1",
  P2_MODE_SELECTION: "G2",
  P3_SPARK_MATURATION: "G3",
  P4_BLUEPRINT_SKETCH: "G4",
  P5_RESEARCH_TARGETS: "G5",
  P6_STACK_QUESTIONNAIRE: "G6",
  P8_APPROACH_QUESTIONNAIRE: "G7",
  P9_DECISION_SETTLEMENT: "G8",
  P10_DOCS_MANIFEST: "G9",
  P12_BLUEPRINT_ASSEMBLY: "G10",
};
