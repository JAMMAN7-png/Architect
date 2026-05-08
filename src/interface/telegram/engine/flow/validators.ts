import type { ValidationRule } from "../types.ts";

/**
 * Pure validation for a single input-flow step.
 *
 * The engine calls `validate(rule, raw)` with the raw value lifted from
 * the Telegram update (text payload, callback-data suffix, …). On
 * success the returned `value` is what the engine writes into
 * `flow.collectedData[step.field]`; on failure the engine surfaces
 * `reason` via a DANGER toast and increments the retry counter.
 *
 * `custom` rules are intentionally a no-op here — the page's
 * `onComplete` runs domain validation later and may reject collected
 * data wholesale. Any throw inside `validate` is caught by the engine
 * and treated as a validation failure with `rule.errorMessage`.
 *
 * Design ref: docs/design-system/05-input-flows.md.
 */

export type ValidateResult = { ok: true; value: unknown } | { ok: false; reason: string };

const fail = (rule: ValidationRule): ValidateResult => ({ ok: false, reason: rule.errorMessage });

const compilePattern = (pattern: string): RegExp | null => {
  try {
    return new RegExp(pattern);
  } catch {
    return null;
  }
};

const checkLength = (value: string, rule: ValidationRule): boolean => {
  if (rule.min !== undefined && value.length < rule.min) return false;
  if (rule.max !== undefined && value.length > rule.max) return false;
  return true;
};

export function validate(rule: ValidationRule, raw: unknown): ValidateResult {
  switch (rule.type) {
    case "text": {
      if (typeof raw !== "string") return fail(rule);
      if (!checkLength(raw, rule)) return fail(rule);
      if (rule.pattern !== undefined) {
        const re = compilePattern(rule.pattern);
        if (re === null || !re.test(raw)) return fail(rule);
      }
      return { ok: true, value: raw };
    }
    case "number": {
      const n = Number(raw);
      if (!Number.isFinite(n)) return fail(rule);
      if (rule.min !== undefined && n < rule.min) return fail(rule);
      if (rule.max !== undefined && n > rule.max) return fail(rule);
      return { ok: true, value: n };
    }
    case "choice": {
      const candidate = String(raw);
      if (!rule.choices?.includes(candidate)) return fail(rule);
      return { ok: true, value: candidate };
    }
    case "regex": {
      if (typeof raw !== "string") return fail(rule);
      if (rule.pattern === undefined) return fail(rule);
      const re = compilePattern(rule.pattern);
      if (re === null || !re.test(raw)) return fail(rule);
      if (!checkLength(raw, rule)) return fail(rule);
      return { ok: true, value: raw };
    }
    case "custom": {
      return { ok: true, value: raw };
    }
  }
}
