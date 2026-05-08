// Shared types — single source of truth for the pipeline.
// Every agent, phase, and template consumes shapes defined here.

/* eslint-disable @typescript-eslint/no-empty-interface */

export type ModelTier = "strategic" | "ensemble" | "execution" | "ui";

/** Identifies a service inside a Blueprint. Slug-shaped. */
export type ServiceId = string;

/** A frozen Spark — the immutable human idea. */
export interface Spark {
  /** Short identifier slug, e.g. "dopeller", "todo-app". */
  slug: string;
  /** One-sentence what + who + why. */
  pitch: string;
  /** Target user(s) or persona. */
  audience: string[];
  /** What makes this different / non-negotiable identity. */
  identity: string[];
  /** Things this product must NOT become. */
  nonGoals: string[];
  /** Reference inspirations / style anchors (URLs or names). */
  references: string[];
  /** Free-form prose section authored by the human. */
  prose: string;
  /** Source: "interactive" (brainstorm), "file" (idea-file), or "stdin". */
  source: "interactive" | "file" | "stdin";
  /** ISO timestamp when the spark was frozen. */
  frozenAt: string;
}

/** A service description inside the Blueprint's service map. */
export interface BlueprintService {
  id: ServiceId;
  /** Human-readable name. */
  name: string;
  /** One-line purpose. */
  purpose: string;
  /** What the service owns (data, logic). */
  responsibilities: string[];
  /** What the service explicitly does NOT do. */
  nonResponsibilities: string[];
  /** Build priority bucket. */
  priority: "p0" | "p1" | "p2";
  /** Domain folder this service belongs to (e.g. "safety", "billing"). */
  domain: string;
  /** Service-to-service dependencies (ids). */
  dependsOn: ServiceId[];
  /** Whether the service publishes domain events. */
  emitsEvents: boolean;
  /** Whether the service has a public-facing API surface. */
  publicApi: boolean;
  /** Whether the service is security-critical (auth, payments, csam, etc.). */
  securityCritical: boolean;
}

/** The frozen master Blueprint. All agent output references this. */
export interface Blueprint {
  /** Schema version — bumps on breaking shape changes. */
  schemaVersion: 1;
  /** ISO timestamp when frozen. */
  frozenAt: string;
  /** Reference to the Spark. */
  sparkSlug: string;
  /** One-paragraph product summary distilled from the Spark. */
  summary: string;
  /** Architectural style — monolith / modular monolith / microservices. */
  architectureStyle: "monolith" | "modular-monolith" | "microservices";
  /** All services in this Blueprint. */
  services: BlueprintService[];
  /** Cross-cutting concerns: auth, observability, etc. */
  crossCutting: {
    auth: string;
    observability: string;
    deployment: string;
    dataStore: string;
    eventBus: string | null;
  };
  /** Whether the project includes a UI surface. */
  hasUi: boolean;
  /** Whether the docs/research folder should be generated. */
  hasResearch: boolean;
  /** Acceptance criteria for the entire foundation. */
  acceptance: string[];
  /** Build sequence (service ids in dependency order). */
  buildSequence: ServiceId[];
}

/** Output of a QA review pass. */
export interface QaReview {
  perspective: string;
  reviewerModel: string;
  findings: QaFinding[];
}

export interface QaFinding {
  severity: "blocker" | "major" | "minor" | "info";
  category: string;
  /** Where in the Blueprint this applies (service id, "blueprint", "architecture", etc.). */
  scope: string;
  problem: string;
  recommendation: string;
}

/** A single research finding after the 85% noise filter. */
export interface ResearchFinding {
  query: string;
  url: string;
  title: string;
  /** Implementation-relevant excerpt. ≤ ~200 tokens. */
  excerpt: string;
  /** Why this finding matters for the Blueprint. */
  relevance: string;
}

/** Deterministic registry entry. */
export interface RegistryEntry {
  /** Path relative to the output root. */
  path: string;
  /** "root" for top-level docs/, "service" for <service>/docs/, "ui" for docs/ui/. */
  scope: "root" | "service" | "ui" | "research" | "qa" | "architecture";
  /** Service id if scope === "service". */
  serviceId?: ServiceId;
  /** Doc kind (spark, blueprint, api-contract, etc.). */
  kind: string;
  /** Phase that produced it. */
  phase: number;
  /** SHA-256 of file content at registry time. */
  sha256: string;
  /** ISO timestamp when generated. */
  generatedAt: string;
}

/** Phase result. */
export interface PhaseResult {
  phase: number;
  name: string;
  ok: boolean;
  artifactsWritten: string[];
  durationMs: number;
  tokensUsed: number;
  estimatedUsd: number;
  warnings: string[];
}

/** Pipeline run summary. */
export interface PipelineSummary {
  startedAt: string;
  finishedAt: string;
  outDir: string;
  phases: PhaseResult[];
  totalTokens: number;
  totalUsd: number;
  servicesGenerated: number;
  blueprint: Blueprint | null;
}
