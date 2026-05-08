import type { Ctx, TrackedMessage } from "../types.ts";
import { DEFAULT_TTL, send } from "./send.ts";

/**
 * Toast helpers — thin wrappers over `send` that materialise the three
 * canonical ephemeral subtypes. Each helper enforces the "one per
 * subtype per scope" rule via `replacePrevious: true` and falls back
 * to the default TTL for the subtype.
 *
 * Design ref: docs/design-system/07-toasts-modals.md.
 */

export interface ToastOptions {
  ttlMs?: number;
  noIcon?: boolean;
  scope?: string;
  parseMode?: "HTML" | "MarkdownV2";
}

type ToastSubtype = "INFO" | "WARNING" | "DANGER";
type ToastFn = (ctx: Ctx, text: string, opts?: ToastOptions) => Promise<TrackedMessage>;

const make =
  (subtype: ToastSubtype): ToastFn =>
  (ctx, text, opts) =>
    send(ctx, text, {
      type: "EPHEMERAL",
      subtype,
      replacePrevious: true,
      ttlMs: opts?.ttlMs ?? DEFAULT_TTL[subtype],
      parseMode: opts?.parseMode ?? "HTML",
      scope: opts?.scope,
      metadata: opts?.noIcon === true ? { noIcon: true } : undefined,
    });

export const toast: { info: ToastFn; warning: ToastFn; danger: ToastFn } = {
  info: make("INFO"),
  warning: make("WARNING"),
  danger: make("DANGER"),
};
