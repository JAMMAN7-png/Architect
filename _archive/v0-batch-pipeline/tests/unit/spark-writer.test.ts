import { describe, expect, it } from "bun:test";
import { writeSpark } from "../../src/brainstorm/spec-writer.ts";

describe("spec-writer", () => {
  it("renders all spark fields", () => {
    const md = writeSpark({
      slug: "todo-app",
      pitch: "A todo app for makers.",
      audience: ["Indie hackers", "Solo founders"],
      identity: ["Calm UX", "Local-first"],
      nonGoals: ["Team collaboration", "Mobile native"],
      references: ["https://example.com/inspiration"],
      prose: "It is a small, opinionated todo tool.",
    });
    expect(md).toContain("# Spark — todo-app");
    expect(md).toContain("A todo app for makers.");
    expect(md).toContain("- Indie hackers");
    expect(md).toContain("- Calm UX");
    expect(md).toContain("- Team collaboration");
    expect(md).toContain("https://example.com/inspiration");
    expect(md).toContain("opinionated todo");
  });

  it("handles empty arrays gracefully", () => {
    const md = writeSpark({
      slug: "minimal",
      pitch: "A minimal something.",
      audience: [],
      identity: [],
      nonGoals: [],
      references: [],
      prose: "",
    });
    expect(md).toContain("# Spark — minimal");
    expect(md).toContain("_(none captured)_");
  });
});
