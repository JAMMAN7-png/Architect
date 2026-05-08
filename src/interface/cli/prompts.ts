import prompts from "prompts";
import type { PhasePrompts } from "../../orchestrator/phase.ts";

/**
 * CLI implementation of the phase prompt contract. Wraps `prompts` so that
 * Ctrl-C is treated as a hard exit (Architect MUST NOT advance past a gate
 * the user did not consent to).
 */
export function makeCliPrompts(): PhasePrompts {
  const onCancel = () => {
    process.stderr.write("\naborted by user\n");
    process.exit(130);
  };

  return {
    async text(question, opts) {
      const res = await prompts(
        {
          type: opts?.multiline ? "invisible" : "text",
          name: "value",
          message: question,
        },
        { onCancel },
      );
      return String(res.value ?? "");
    },
    async select(question, choices) {
      const res = await prompts(
        {
          type: "select",
          name: "value",
          message: question,
          choices: choices.map((c) => ({ title: c.label, value: c.value })),
        },
        { onCancel },
      );
      return res.value as (typeof choices)[number]["value"];
    },
    async confirm(question, defaultValue = true) {
      const res = await prompts(
        {
          type: "confirm",
          name: "value",
          message: question,
          initial: defaultValue,
        },
        { onCancel },
      );
      return Boolean(res.value);
    },
    async approve(label, artifact) {
      const status = await prompts(
        {
          type: "select",
          name: "value",
          message: `${label}\n  artifact: ${artifact}`,
          choices: [
            { title: "Approve", value: "approved" },
            { title: "Edit", value: "edited" },
            { title: "Revise", value: "revised" },
            { title: "Reject", value: "rejected" },
          ],
        },
        { onCancel },
      );
      const notes = await prompts(
        {
          type: "text",
          name: "value",
          message: "notes (optional)",
        },
        { onCancel },
      );
      const out: { status: "approved" | "rejected" | "edited" | "revised"; notes?: string } = {
        status: status.value as "approved" | "rejected" | "edited" | "revised",
      };
      const trimmed = String(notes.value ?? "").trim();
      if (trimmed) out.notes = trimmed;
      return out;
    },
  };
}
