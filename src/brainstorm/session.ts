import kleur from "kleur";
import prompts from "prompts";
import type { ArchitectConfig } from "../config/schema.ts";
import type { LLMRouter } from "../llm/router.ts";
import { fetchBrainstormSkill } from "./runner.ts";
import { writeSpark } from "./spec-writer.ts";

const MAX_TURNS = 30;

/**
 * Drive an interactive brainstorm in the terminal, following the methodology in
 * superpowers' skills/brainstorming/SKILL.md. Returns the FINAL spark.md content.
 *
 * Loop:
 *   1. Send the SKILL + accumulated dialogue to the STRATEGIC tier.
 *   2. The model returns either:
 *        - a question (one at a time), with optional multiple-choice options
 *        - a "section" of the design, requiring user yes/no/comment
 *        - a "READY" sentinel and a complete spark draft
 *   3. We render to terminal, capture the user's answer, append to dialogue, repeat.
 */
export async function runBrainstormSession(opts: {
  router: LLMRouter;
  cfg: ArchitectConfig;
  seed: string;
}): Promise<string> {
  const skill = await fetchBrainstormSkill(opts.cfg);

  const system = [
    "You are running an interactive brainstorming session in a terminal.",
    "You MUST follow this skill verbatim:",
    "",
    "----- BEGIN SKILL -----",
    skill,
    "----- END SKILL -----",
    "",
    "Constraints for this terminal interface:",
    "- Output exactly ONE turn per response, in JSON.",
    "- Output schema:",
    '  { "kind": "question", "text": string, "options"?: string[] }',
    '  { "kind": "section", "title": string, "body": string }',
    '  { "kind": "ready", "spark": { slug: string, pitch: string,',
    "    audience: string[], identity: string[], nonGoals: string[],",
    "    references: string[], prose: string } }",
    "- 'options' should contain 2-5 short labels when the question is multiple-choice.",
    "- When the user has approved the design and you have all the information you need,",
    "  emit kind=ready with the final spark fields. Do not emit ready until they approve.",
    "- Do NOT add commentary outside the JSON.",
  ].join("\n");

  const dialogue: { role: "user" | "assistant"; content: string }[] = [];
  if (opts.seed) {
    dialogue.push({
      role: "user",
      content: `Seed idea (rough draft from the user — refine, don't trust uncritically):\n\n${opts.seed}`,
    });
  } else {
    dialogue.push({
      role: "user",
      content: "I want to start a brainstorm. I have no draft yet — ask me the first question.",
    });
  }

  let turn = 0;
  while (turn < MAX_TURNS) {
    turn += 1;
    const res = await opts.router.chat({
      tier: "strategic",
      messages: [{ role: "system", content: system }, ...dialogue],
      jsonSchema: {},
      maxTokens: 2000,
    });

    let parsed: BrainstormTurn | null = null;
    try {
      parsed = JSON.parse(stripFences(res.text));
    } catch {
      console.log(kleur.yellow("(brainstorm: model returned non-JSON, retrying)"));
      // Keep the bad assistant turn in dialogue so the model sees what it said and avoids repeating the mistake.
      dialogue.push({ role: "assistant", content: res.text });
      dialogue.push({
        role: "user",
        content:
          "Your previous turn was not valid JSON. Please re-emit it as a single JSON object matching the schema. No prose.",
      });
      continue;
    }
    if (!parsed) continue;

    dialogue.push({ role: "assistant", content: res.text });

    if (parsed.kind === "ready") {
      return writeSpark(parsed.spark);
    }

    if (parsed.kind === "section") {
      console.log("");
      console.log(kleur.bold(parsed.title));
      console.log(parsed.body);
      const ans = await prompts({
        type: "select",
        name: "v",
        message: "Does this look right?",
        choices: [
          { title: "Yes — continue", value: "yes" },
          { title: "No — revise", value: "no" },
          { title: "Need to clarify (free-form)", value: "clarify" },
        ],
      });
      if (ans.v === "no") {
        dialogue.push({
          role: "user",
          content: "I don't agree with this section. Please revise it.",
        });
      } else if (ans.v === "clarify") {
        const free = await prompts({ type: "text", name: "v", message: "Comment:" });
        dialogue.push({ role: "user", content: String(free.v ?? "") });
      } else {
        dialogue.push({ role: "user", content: "Approved. Continue." });
      }
      continue;
    }

    // question
    console.log("");
    if (parsed.options && parsed.options.length > 0) {
      const ans = await prompts({
        type: "select",
        name: "v",
        message: parsed.text,
        choices: parsed.options.map((o) => ({ title: o, value: o })),
      });
      dialogue.push({ role: "user", content: String(ans.v ?? "") });
    } else {
      const ans = await prompts({ type: "text", name: "v", message: parsed.text });
      dialogue.push({ role: "user", content: String(ans.v ?? "") });
    }
  }

  throw new Error(`brainstorm: hit max turns (${MAX_TURNS}) without converging on a spark`);
}

type BrainstormTurn =
  | { kind: "question"; text: string; options?: string[] }
  | { kind: "section"; title: string; body: string }
  | {
      kind: "ready";
      spark: {
        slug: string;
        pitch: string;
        audience: string[];
        identity: string[];
        nonGoals: string[];
        references: string[];
        prose: string;
      };
    };

function stripFences(text: string): string {
  const m = text.match(/```(?:json)?\n?([\s\S]*?)\n?```/);
  return m ? (m[1] ?? text) : text;
}
