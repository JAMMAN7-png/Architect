import { makeGatePage } from "../gate-page.ts";

/**
 * `/blueprint` — G10 Blueprint Lock review.
 *
 * The terminal gate. Approving G10 freezes `docs/blueprint/` (chmod
 * 0444) and marks `state.blueprintLocked = true`. After approval the
 * page navigates back to `/status` so the user can confirm the locked
 * state.
 */
export const blueprintPage = makeGatePage({
  path: "/blueprint",
  parent: "/",
  gate: "G10",
  title: "Blueprint",
  nextPath: "/status",
  artifactPath: (s) => (s.blueprintLocked ? "docs/blueprint/ (locked)" : "docs/blueprint/"),
  summarise: (s) =>
    s.blueprintLocked ? "Blueprint locked — read-only." : "Blueprint draft ready for lock.",
});
