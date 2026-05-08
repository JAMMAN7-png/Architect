import { DopellerError } from "../types.ts";

/**
 * Callback-data helpers.
 *
 * Telegram caps `callback_data` at 64 bytes (UTF-8). Any handler that
 * builds a callback string MUST route it through {@link assertCallbackData}
 * so an overflow throws at the producer rather than being silently
 * rejected by Telegram with `400 Bad Request: BUTTON_DATA_INVALID`.
 *
 * For pages that emit one button per element of a long-named option
 * list (e.g. fully-qualified model slugs), use
 * {@link indexedSettingsCallback} which encodes the option as its
 * positional index; the action handler resolves the index back through
 * the same enumeration.
 */

/** Telegram limits callback_data to 64 bytes (UTF-8). */
export const CALLBACK_DATA_MAX_BYTES = 64;

const ENCODER = new TextEncoder();

/**
 * Throw a {@link DopellerError} (severity: internal,
 * code: `bad_callback_data`) if `data` exceeds
 * {@link CALLBACK_DATA_MAX_BYTES}. The byte length is measured with
 * `new TextEncoder().encode(data).length`. Returns `data` unchanged on
 * success so callers can chain
 * `text: "...", callback_data: assertCallbackData(...)`.
 */
export function assertCallbackData(data: string): string {
  const bytes = ENCODER.encode(data).length;
  if (bytes > CALLBACK_DATA_MAX_BYTES) {
    throw new DopellerError("bad_callback_data", "internal", "callback_overflow", {
      data,
      bytes,
    });
  }
  return data;
}

/**
 * Build an indexed settings callback `action:settings:<verb>:<key>:idx:<n>`.
 * `verb` is `"set"` or `"toggle"`. The result is run through
 * {@link assertCallbackData} so a malformed key still surfaces overflow
 * at the producer.
 */
export function indexedSettingsCallback(verb: "set" | "toggle", key: string, idx: number): string {
  return assertCallbackData(`action:settings:${verb}:${key}:idx:${idx}`);
}
