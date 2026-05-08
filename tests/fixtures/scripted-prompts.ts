import type { PhasePrompts } from "../../src/orchestrator/phase.ts";

/**
 * Scripted prompts implementation for tests. Pulls answers from a queue
 * keyed by `text` / `select` / `confirm` / `approve`. Throws if the queue
 * runs dry — better to fail loudly than to deadlock waiting on stdin.
 */
export type ScriptedAnswer =
  | { kind: "text"; value: string }
  | { kind: "select"; value: string }
  | { kind: "confirm"; value: boolean }
  | { kind: "approve"; status: "approved" | "rejected" | "edited" | "revised"; notes?: string };

export class ScriptedPrompts implements PhasePrompts {
  private q: ScriptedAnswer[];
  constructor(answers: ScriptedAnswer[]) {
    this.q = [...answers];
  }
  private next<K extends ScriptedAnswer["kind"]>(kind: K): Extract<ScriptedAnswer, { kind: K }> {
    const a = this.q.shift();
    if (!a) throw new Error(`scripted prompts exhausted (expected ${kind})`);
    if (a.kind !== kind)
      throw new Error(`scripted prompt kind mismatch: expected ${kind}, got ${a.kind}`);
    return a as Extract<ScriptedAnswer, { kind: K }>;
  }
  async text(): Promise<string> {
    return this.next("text").value;
  }
  async select<T extends string>(): Promise<T> {
    return this.next("select").value as T;
  }
  async confirm(): Promise<boolean> {
    return this.next("confirm").value;
  }
  async approve(): Promise<{
    status: "approved" | "rejected" | "edited" | "revised";
    notes?: string;
  }> {
    const a = this.next("approve");
    const out: { status: "approved" | "rejected" | "edited" | "revised"; notes?: string } = {
      status: a.status,
    };
    if (a.notes !== undefined) out.notes = a.notes;
    return out;
  }
  remaining(): number {
    return this.q.length;
  }
}
