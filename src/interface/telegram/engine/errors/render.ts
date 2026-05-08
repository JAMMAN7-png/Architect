/**
 * Substitutes `{placeholder}` tokens in an `ErrorTemplate` from a flat
 * `Record<string, string>` derived from `DopellerError.metadata`.
 *
 * Missing keys render as empty strings rather than raising — error
 * surfaces should always show *something* even when metadata is sparse.
 */

import type { ErrorTemplate } from "./templates.ts";

export function renderTemplate(
  tpl: ErrorTemplate,
  vars: Record<string, string>,
): { title: string; body: string; cta?: { label: string; callback: string } } {
  const fill = (s: string): string => s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
  const out: { title: string; body: string; cta?: { label: string; callback: string } } = {
    title: fill(tpl.title),
    body: fill(tpl.body),
  };
  if (tpl.cta) out.cta = tpl.cta;
  return out;
}
