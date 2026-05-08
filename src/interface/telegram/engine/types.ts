import type { GateId, Stage } from "../../../orchestrator/state.ts";

/**
 * TeleFocus engine type contracts.
 *
 * The single source of truth for messaging, session, page, and middleware
 * shapes. Consumers (page handlers, middleware, transports) import from
 * here only — never from grammY directly when a typed surface exists.
 *
 * Design system: docs/design-system/01-overview.md ff.
 */

// ── Re-exports of orchestrator stage / gate identifiers ───────────────
export type { GateId, Stage };

// ── Message taxonomy ──────────────────────────────────────────────────

/** Five canonical message types. See design-system §04. */
export type MessageType = "MENU" | "EPHEMERAL" | "INTERACTIVE" | "INPUT_PROMPT" | "INPUT_PROGRESS";

/** Subtypes that further classify EPHEMERAL and INTERACTIVE messages. */
export type MessageSubtype = "INFO" | "WARNING" | "DANGER" | "CONFIRMATION" | "MODAL";

/** Error severity bucket (see design-system §08). */
export type Severity = "internal" | "user" | "platform";

// ── Tracked message + validation primitives ───────────────────────────

export interface TrackedMessage {
  messageId: number;
  type: MessageType;
  subtype?: MessageSubtype;
  pagePath: string;
  createdAt: number;
  expiresAt?: number;
  metadata?: Record<string, unknown>;
}

export interface ValidationRule {
  type: "text" | "number" | "choice" | "regex" | "custom";
  min?: number;
  max?: number;
  /** Serialised regex pattern (constructed lazily by the engine). */
  pattern?: string;
  choices?: string[];
  errorMessage: string;
}

// ── Input-flow state ──────────────────────────────────────────────────

export interface InputFlowState {
  active: boolean;
  pagePath: string | null;
  flowId: string | null;
  currentStep: number;
  totalSteps: number;
  collectedData: Record<string, unknown>;
  promptMessageId: number | null;
  progressMessageId: number | null;
  awaitingInput: boolean;
  inputType: "text" | "number" | "selection" | null;
  validationRules: ValidationRule | null;
  retries: number;
}

// ── Session ────────────────────────────────────────────────────────────

export interface UserSession {
  userId: number;
  chatId: number;
  /** Project root the session is operating against, or null before bind. */
  projectRoot: string | null;

  menu: {
    messageId: number | null;
    currentPage: string;
    previousPage: string | null;
    navigationStack: string[];
    lastAction?: string;
    lastActionAt?: number;
    /**
     * Counter of fresh non-MENU sends and captured user-flow inputs
     * since the last successful menu render. When this crosses the
     * staleness threshold the next render forces a fresh message at
     * the chat bottom so the menu doesn't drown in scroll. Reset to
     * 0 on every successful render or `forceFresh`. Optional on the
     * wire to keep pre-existing persisted sessions readable.
     */
    staleness?: number;
  };

  /** Tracked messages, grouped by page-path scope. */
  messages: Record<string, TrackedMessage[]>;

  inputFlow: InputFlowState;

  navigationGuard: {
    active: boolean;
    pendingDestination: string | null;
    confirmationMessageId: number | null;
  };

  /**
   * Currently open modal, if any. Set by `modal.confirm`, cleared by
   * `dismissActiveModal` (and indirectly by `dismissModalsInScope` when
   * it removes the hosting scope). Drives the renderer's lock state:
   * while non-null the menu shows a "modal open" body with a single
   * Cancel button.
   */
  activeModal: { scope: string; messageId: number; title: string } | null;

  /** Per-page scratch data; keyed by page path. Ephemeral by policy. */
  pageData: Record<string, Record<string, unknown>>;

  createdAt: number;
  lastInteractionAt: number;
  /** Monotonically increasing; used for version-guarded writes. */
  version: number;
}

// ── Telegram primitives (typed locally to avoid leaking grammY) ───────

export interface InlineKeyboardButton {
  text: string;
  callback_data?: string;
  url?: string;
  /** Bot API 9.4: shows a Premium custom emoji before the text. */
  icon_custom_emoji_id?: string;
  /** Bot API 9.4: "danger" | "success" | "primary". Omitted → default. */
  style?: InlineKeyboardButtonStyle;
}

/** Bot API 9.4 button color styles. */
export type InlineKeyboardButtonStyle = "danger" | "success" | "primary";

export interface InlineKeyboardMarkup {
  inline_keyboard: InlineKeyboardButton[][];
}

export interface MenuBody {
  text: string;
  parseMode?: "HTML" | "MarkdownV2";
}

export interface SendOptions {
  type: "EPHEMERAL" | "INTERACTIVE" | "INPUT_PROMPT" | "INPUT_PROGRESS";
  subtype?: MessageSubtype;
  /** Defaults to `session.menu.currentPage`. */
  scope?: string;
  /** Override the subtype default TTL. */
  ttlMs?: number;
  parseMode?: "HTML" | "MarkdownV2";
  replyMarkup?: InlineKeyboardMarkup;
  /** Edit any prior same-type+subtype message in scope rather than send anew. */
  replacePrevious?: boolean;
  metadata?: Record<string, unknown>;
  /**
   * Reply target for the FRESH-send branch. Defaults to
   * `session.menu.messageId` so non-MENU messages thread under the
   * main menu. Pass `null` to opt out (e.g. when intentionally
   * sending a top-level message). Ignored on edit-replace.
   */
  replyTo?: number | null;
}

// ── Input flow definitions ────────────────────────────────────────────

export interface InputFlowStep {
  field: string;
  prompt: string;
  inputType: "text" | "number" | "selection";
  validation: ValidationRule;
  choices?: { label: string; value: string }[];
  placeholder?: string;
  skipIf?(collected: Record<string, unknown>): boolean;
  formatPrompt?(collected: Record<string, unknown>): string;
}

export interface InputFlowDefinition {
  flowId: string;
  steps: InputFlowStep[];
  onComplete(collected: Record<string, unknown>, ctx: Ctx): Promise<void>;
  onCancel?(collected: Record<string, unknown>, ctx: Ctx): Promise<void>;
  /**
   * @deprecated Advisory only — retained on the type for backwards
   * compatibility. Validation failures no longer auto-cancel the flow;
   * the engine edits the prompt in place and keeps awaiting input.
   */
  maxRetries?: number;
}

// ── Bot API surface (subset of grammY consumed by the engine) ─────────

export interface BotApi {
  sendMessage(
    chatId: number,
    text: string,
    opts?: Record<string, unknown>,
  ): Promise<{ message_id: number }>;
  editMessageText(
    chatId: number,
    messageId: number,
    text: string,
    opts?: Record<string, unknown>,
  ): Promise<unknown>;
  editMessageReplyMarkup(
    chatId: number,
    messageId: number,
    opts?: Record<string, unknown>,
  ): Promise<unknown>;
  deleteMessage(chatId: number, messageId: number): Promise<unknown>;
  answerCallbackQuery(callbackQueryId: string, opts?: Record<string, unknown>): Promise<unknown>;
  sendChatAction(chatId: number, action: string): Promise<unknown>;
}

// ── Context + middleware ──────────────────────────────────────────────

/**
 * Service container. Deliberately open: each consumer (Architect, Persona
 * Builder, …) augments the slot with its own typed services. Pages access
 * these via `ctx.services`.
 */
export interface ServicesShape {
  [k: string]: unknown;
}

export interface Ctx {
  api: BotApi;
  chatId: number;
  userId: number;
  callbackQuery?: {
    data: string;
    id: string;
    message?: { message_id: number };
  };
  message?: {
    text?: string;
    message_id: number;
  };
  session: UserSession;
  services: ServicesShape;
}

export type NextFn = () => Promise<void>;
export type Middleware = (ctx: Ctx, next: NextFn) => Promise<void>;

// ── Page definition ───────────────────────────────────────────────────

export interface PageDefinition {
  path: string;
  parent: string | null;
  render(ctx: Ctx): MenuBody | Promise<MenuBody>;
  keyboard(ctx: Ctx): InlineKeyboardButton[][] | Promise<InlineKeyboardButton[][]>;
  inputFlow?: InputFlowDefinition;
  hasUnsavedWork?(ctx: Ctx): boolean;
  onEnter?(ctx: Ctx): Promise<void>;
  onExit?(ctx: Ctx): Promise<void>;
}

// ── Errors ────────────────────────────────────────────────────────────

/**
 * Engine-recognised error. The error boundary middleware inspects `code`,
 * `severity`, and `metadata` to render the appropriate user-facing toast
 * or modal. See design-system §08.
 */
export class DopellerError extends Error {
  constructor(
    public readonly code: string,
    public readonly severity: Severity,
    message: string,
    public readonly metadata?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "DopellerError";
  }
}
