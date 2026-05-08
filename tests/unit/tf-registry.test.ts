import { describe, expect, test } from "bun:test";
import { PageRegistry } from "../../src/interface/telegram/engine/registry.ts";
import { DopellerError, type PageDefinition } from "../../src/interface/telegram/engine/types.ts";

/**
 * `PageRegistry` validates the page tree eagerly; structural mistakes
 * surface at registration time, not when a user clicks a button.
 */

const page = (path: string, parent: string | null): PageDefinition => ({
  path,
  parent,
  render: () => ({ text: "" }),
  keyboard: () => [],
});

describe("PageRegistry.register", () => {
  test("non-root path with missing parent throws invalid_page_tree (internal)", () => {
    const reg = new PageRegistry();
    let caught: unknown;
    try {
      reg.register(page("/orphan", "/missing"));
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(DopellerError);
    const dop = caught as DopellerError;
    expect(dop.code).toBe("invalid_page_tree");
    expect(dop.severity).toBe("internal");
  });

  test("duplicate path throws invalid_page_tree", () => {
    const reg = new PageRegistry();
    reg.register(page("/", null));
    reg.register(page("/a", "/"));
    let caught: unknown;
    try {
      reg.register(page("/a", "/"));
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(DopellerError);
    expect((caught as DopellerError).code).toBe("invalid_page_tree");
  });
});

describe("PageRegistry.getOrThrow", () => {
  test("unknown path throws unknown_page (user)", () => {
    const reg = new PageRegistry();
    reg.register(page("/", null));
    let caught: unknown;
    try {
      reg.getOrThrow("/missing");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(DopellerError);
    const dop = caught as DopellerError;
    expect(dop.code).toBe("unknown_page");
    expect(dop.severity).toBe("user");
  });
});

describe("PageRegistry traversal", () => {
  test("childrenOf returns siblings sorted by path", () => {
    const reg = new PageRegistry();
    reg.register(page("/", null));
    reg.register(page("/c", "/"));
    reg.register(page("/a", "/"));
    reg.register(page("/b", "/"));
    reg.register(page("/a/x", "/a"));

    const kids = reg.childrenOf("/").map((p) => p.path);
    expect(kids).toEqual(["/a", "/b", "/c"]);
  });

  test("paths() returns every registered path, sorted", () => {
    const reg = new PageRegistry();
    reg.register(page("/", null));
    reg.register(page("/zeta", "/"));
    reg.register(page("/alpha", "/"));
    reg.register(page("/alpha/inner", "/alpha"));

    expect(reg.paths()).toEqual(["/", "/alpha", "/alpha/inner", "/zeta"]);
  });
});
