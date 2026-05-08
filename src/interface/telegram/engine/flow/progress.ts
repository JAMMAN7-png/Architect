import { escapeHtml } from "../messages/sanitise.ts";
import type { InputFlowState, InputFlowStep } from "../types.ts";

/**
 * Render the single-line `INPUT_PROGRESS` body.
 *
 * The line lists overall progress (`Step <i> of <n>`) followed by a
 * checked breadcrumb for each previously-collected field. Field labels
 * derive from `step.field` and are HTML-escaped so user-influenced
 * names cannot break the canonical HTML parse mode.
 *
 * Design ref: docs/design-system/05-input-flows.md "Progress indicator".
 */

const capitalise = (label: string): string =>
  label.length === 0 ? label : label.charAt(0).toUpperCase() + label.slice(1);

export function renderProgressLine(flow: InputFlowState, steps: InputFlowStep[]): string {
  const total = steps.length;
  const positionRaw = total === 0 ? 0 : Math.min(flow.currentStep + 1, total);
  const head = `Step ${positionRaw} of ${total}`;

  const completed: string[] = [];
  const upTo = Math.min(flow.currentStep, steps.length);
  for (let i = 0; i < upTo; i += 1) {
    const step = steps[i];
    if (step === undefined) continue;
    if (!(step.field in flow.collectedData)) continue;
    completed.push(`${escapeHtml(capitalise(step.field))} ✓`);
  }

  return completed.length === 0 ? head : `${head} · ${completed.join(" · ")}`;
}
