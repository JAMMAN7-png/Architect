import { describe, expect, test } from "bun:test";
import { runPipeline } from "../../src/interface/telegram/engine/middleware/pipeline.ts";
import type { Middleware } from "../../src/interface/telegram/engine/middleware/types.ts";
import type { Ctx } from "../../src/interface/telegram/engine/types.ts";

/**
 * `runPipeline` is the Koa-style fold that powers the engine. The
 * acceptance criterion (design-system §10) is two-fold:
 *
 *   1. Middlewares run in the order supplied.
 *   2. Not calling `next()` short-circuits the remainder.
 *
 * The minimal context cast below sidesteps building a full `Ctx` —
 * `runPipeline` itself never reads any field; the chain owns whatever
 * shape the consuming middlewares need.
 */
const dummyCtx = {} as Ctx;

describe("runPipeline", () => {
  test("invokes middlewares in declared order", async () => {
    const seen: string[] = [];
    const chain: Middleware[] = [
      async (_ctx, next) => {
        seen.push("a:before");
        await next();
        seen.push("a:after");
      },
      async (_ctx, next) => {
        seen.push("b:before");
        await next();
        seen.push("b:after");
      },
      async (_ctx, _next) => {
        seen.push("c");
      },
    ];

    await runPipeline(dummyCtx, chain);

    expect(seen).toEqual(["a:before", "b:before", "c", "b:after", "a:after"]);
  });

  test("stops on short-circuit (middleware does not call next)", async () => {
    const seen: string[] = [];
    const chain: Middleware[] = [
      async (_ctx, next) => {
        seen.push("a");
        await next();
      },
      async (_ctx, _next) => {
        seen.push("b:short-circuit");
        // intentionally no next()
      },
      async (_ctx, _next) => {
        seen.push("c:should-not-run");
      },
    ];

    await runPipeline(dummyCtx, chain);

    expect(seen).toEqual(["a", "b:short-circuit"]);
  });

  test("empty chain is a no-op", async () => {
    await expect(runPipeline(dummyCtx, [])).resolves.toBeUndefined();
  });

  test("throws if a middleware calls next() twice", async () => {
    const chain: Middleware[] = [
      async (_ctx, next) => {
        await next();
        await next();
      },
      async (_ctx, _next) => {
        // pass-through
      },
    ];

    await expect(runPipeline(dummyCtx, chain)).rejects.toThrow(/next\(\) called multiple times/);
  });

  test("propagates errors thrown by middlewares", async () => {
    const chain: Middleware[] = [
      async (_ctx, next) => {
        await next();
      },
      async (_ctx, _next) => {
        throw new Error("boom");
      },
    ];

    await expect(runPipeline(dummyCtx, chain)).rejects.toThrow("boom");
  });
});
