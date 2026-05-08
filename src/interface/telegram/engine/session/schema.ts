import { z } from "zod";
import type { UserSession } from "../types.ts";

/**
 * Zod schema for `UserSession` and the `freshSession()` factory.
 *
 * The schema mirrors `UserSession` in `../types.ts` exactly; structural
 * drift between the two is a bug. `.strict()` ensures unknown fields cause
 * `parse()` to throw, which is how the file store detects corrupt or
 * outdated payloads.
 */

export const TrackedMessageSchema = z
  .object({
    messageId: z.number(),
    type: z.enum(["MENU", "EPHEMERAL", "INTERACTIVE", "INPUT_PROMPT", "INPUT_PROGRESS"]),
    subtype: z.enum(["INFO", "WARNING", "DANGER", "CONFIRMATION", "MODAL"]).optional(),
    pagePath: z.string(),
    createdAt: z.number(),
    expiresAt: z.number().optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .strict();

export const ValidationRuleSchema = z
  .object({
    type: z.enum(["text", "number", "choice", "regex", "custom"]),
    min: z.number().optional(),
    max: z.number().optional(),
    pattern: z.string().optional(),
    choices: z.array(z.string()).optional(),
    errorMessage: z.string(),
  })
  .strict();

export const InputFlowStateSchema = z
  .object({
    active: z.boolean(),
    pagePath: z.string().nullable(),
    flowId: z.string().nullable(),
    currentStep: z.number(),
    totalSteps: z.number(),
    collectedData: z.record(z.unknown()),
    promptMessageId: z.number().nullable(),
    progressMessageId: z.number().nullable(),
    awaitingInput: z.boolean(),
    inputType: z.enum(["text", "number", "selection"]).nullable(),
    validationRules: ValidationRuleSchema.nullable(),
    retries: z.number(),
  })
  .strict();

export const MenuStateSchema = z
  .object({
    messageId: z.number().nullable(),
    currentPage: z.string(),
    previousPage: z.string().nullable(),
    navigationStack: z.array(z.string()),
    lastAction: z.string().optional(),
    lastActionAt: z.number().optional(),
  })
  .strict();

export const NavigationGuardSchema = z
  .object({
    active: z.boolean(),
    pendingDestination: z.string().nullable(),
    confirmationMessageId: z.number().nullable(),
  })
  .strict();

export const UserSessionSchema = z
  .object({
    userId: z.number(),
    chatId: z.number(),
    projectRoot: z.string().nullable(),
    menu: MenuStateSchema,
    messages: z.record(z.array(TrackedMessageSchema)),
    inputFlow: InputFlowStateSchema,
    navigationGuard: NavigationGuardSchema,
    activeModal: z
      .object({
        scope: z.string(),
        messageId: z.number(),
        title: z.string(),
      })
      .strict()
      .nullable(),
    pageData: z.record(z.record(z.unknown())),
    createdAt: z.number(),
    lastInteractionAt: z.number(),
    version: z.number(),
  })
  .strict();

/**
 * Build a brand-new session at page `/` with empty buffers. The caller is
 * responsible for persisting it (typically the session store does this on
 * first `load`).
 */
export function freshSession(input: {
  userId: number;
  chatId: number;
  now: number;
}): UserSession {
  return {
    userId: input.userId,
    chatId: input.chatId,
    projectRoot: null,
    menu: {
      messageId: null,
      currentPage: "/",
      previousPage: null,
      navigationStack: ["/"],
    },
    messages: {},
    inputFlow: {
      active: false,
      pagePath: null,
      flowId: null,
      currentStep: 0,
      totalSteps: 0,
      collectedData: {},
      promptMessageId: null,
      progressMessageId: null,
      awaitingInput: false,
      inputType: null,
      validationRules: null,
      retries: 0,
    },
    navigationGuard: {
      active: false,
      pendingDestination: null,
      confirmationMessageId: null,
    },
    activeModal: null,
    pageData: {},
    createdAt: input.now,
    lastInteractionAt: input.now,
    version: 1,
  };
}
