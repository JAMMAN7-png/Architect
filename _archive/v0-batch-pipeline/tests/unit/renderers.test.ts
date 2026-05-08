import { describe, expect, it } from "bun:test";
import { renderBlueprintMd, renderQaReviewMd } from "../../src/agents/renderers.ts";
import type { Blueprint, QaReview } from "../../src/core/types.ts";

const fixture: Blueprint = {
  schemaVersion: 1,
  frozenAt: "2026-05-06T00:00:00Z",
  sparkSlug: "todo-app",
  summary: "A small todo app foundation.",
  architectureStyle: "modular-monolith",
  services: [
    {
      id: "auth",
      name: "Auth",
      purpose: "User identity",
      responsibilities: ["sign-in"],
      nonResponsibilities: ["billing"],
      priority: "p0",
      domain: "platform",
      dependsOn: [],
      emitsEvents: false,
      publicApi: true,
      securityCritical: true,
    },
    {
      id: "todo",
      name: "Todo",
      purpose: "Tasks",
      responsibilities: ["CRUD tasks"],
      nonResponsibilities: ["search"],
      priority: "p0",
      domain: "core",
      dependsOn: ["auth"],
      emitsEvents: false,
      publicApi: true,
      securityCritical: false,
    },
  ],
  crossCutting: {
    auth: "JWT",
    observability: "OTel",
    deployment: "Docker",
    dataStore: "Postgres",
    eventBus: null,
  },
  hasUi: true,
  hasResearch: false,
  acceptance: ["A user can sign in and create a task."],
  buildSequence: ["auth", "todo"],
};

describe("renderBlueprintMd", () => {
  it("includes all services in a markdown table", () => {
    const md = renderBlueprintMd(fixture);
    expect(md).toContain("# Blueprint");
    expect(md).toContain("`auth`");
    expect(md).toContain("`todo`");
    expect(md).toContain("modular-monolith");
    expect(md).toContain("A small todo app foundation.");
    expect(md).toContain("1. `auth`");
    expect(md).toContain("2. `todo`");
  });
});

describe("renderQaReviewMd", () => {
  it("counts severity totals and lists each finding", () => {
    const reviews: QaReview[] = [
      {
        perspective: "Security",
        reviewerModel: "test/model",
        findings: [
          {
            severity: "blocker",
            category: "auth",
            scope: "auth",
            problem: "Passwords stored in plain text",
            recommendation: "Use bcrypt with cost ≥ 12",
          },
        ],
      },
    ];
    const md = renderQaReviewMd(reviews);
    expect(md).toContain("1 blocker");
    expect(md).toContain("Passwords stored in plain text");
    expect(md).toContain("bcrypt");
    expect(md).toContain("test/model");
  });
});
