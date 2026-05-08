/**
 * TeleFocus Engine — public entrypoint.
 *
 * Consumers (pages, action handlers, services) MUST import every engine
 * primitive from this module. Reaching into the underlying files (`./router/...`,
 * `./messages/...`) is reserved for the engine itself and unit tests.
 *
 * See `docs/telefocus-engine/README.md` for the architectural overview.
 */

export type {
  BotApi,
  Ctx,
  GateId,
  InlineKeyboardButton,
  InlineKeyboardMarkup,
  InputFlowDefinition,
  InputFlowState,
  InputFlowStep,
  MenuBody,
  MessageSubtype,
  MessageType,
  Middleware,
  NextFn,
  PageDefinition,
  SendOptions,
  ServicesShape,
  Severity,
  Stage,
  TrackedMessage,
  UserSession,
  ValidationRule,
} from "./types.ts";
export { DopellerError } from "./types.ts";

export { defaultRegistry, PageRegistry, type PageTreeNode } from "./registry.ts";

export { MenuRenderer } from "./renderer/menu-renderer.ts";

export { DEFAULT_ICON, DEFAULT_TTL, replacePrevious, send } from "./messages/send.ts";
export { toast } from "./messages/toast.ts";
export { dismissModalsInScope, modal } from "./messages/modal.ts";
export {
  cleanupScope,
  dropExpiredMessages,
  findInScope,
  trackMessage,
  untrackMessage,
} from "./messages/tracking.ts";
export { escapeHtml, safeBodyHtml } from "./messages/sanitise.ts";
export { ce, ceText, type EmojiIntent } from "./messages/custom-emoji.ts";

export { templates } from "./errors/templates.ts";
export { renderTemplate } from "./errors/render.ts";
export { errorBoundary } from "./errors/boundary.ts";

export { makeRouter, navigateTo } from "./router/navigate.ts";
export { goBack } from "./router/back.ts";
export { openNavigationGuard, resolveNavigationGuard } from "./router/guard.ts";
export { resolveStart } from "./router/deep-link.ts";

export { InputFlowEngine } from "./flow/engine.ts";
export { validate as validateInput } from "./flow/validators.ts";

export { buildPipeline, runPipeline } from "./middleware/pipeline.ts";

export type { SessionStore } from "./session/store.ts";
export { FileSessionStore, MemorySessionStore } from "./session/store.ts";
export { freshSession } from "./session/schema.ts";

export type { AttachedTeleFocus, AttachOptions } from "./bootstrap.ts";
export { TeleFocus } from "./bootstrap.ts";
