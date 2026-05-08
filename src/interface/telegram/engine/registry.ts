import { DopellerError, type PageDefinition } from "./types.ts";

/**
 * Recursive node shape accepted by {@link PageRegistry.registerTree}. Each
 * node owns a {@link PageDefinition}; its children's `parent` field MUST
 * equal the parent node's `path` or registration throws.
 */
export interface PageTreeNode {
  page: PageDefinition;
  children?: PageTreeNode[];
}

/**
 * Page registry. Stores every {@link PageDefinition} in the application,
 * keyed by `path`. The router resolves navigation callbacks (`nav:<path>`)
 * through this registry. See design-system §03 and §09.
 *
 * Validation is eager: structural mistakes (missing parent, duplicate
 * paths, mismatched tree edges) surface at registration time rather than
 * when a user clicks a button.
 */
export class PageRegistry {
  private readonly pages = new Map<string, PageDefinition>();

  /**
   * Register a single page. Throws {@link DopellerError} on:
   * - path that does not start with `/`
   * - duplicate path
   * - `path === parent`
   * - non-root page whose `parent` is null or not yet registered
   *
   * The root path `/` is special-cased: it MAY have `parent: null` and is
   * registered without a parent-existence check.
   */
  register(page: PageDefinition): void {
    if (!page.path.startsWith("/")) {
      throw new DopellerError(
        "invalid_page_tree",
        "internal",
        `path_must_start_with_slash:${page.path}`,
        { path: page.path },
      );
    }
    if (this.pages.has(page.path)) {
      throw new DopellerError("invalid_page_tree", "internal", `duplicate_path:${page.path}`, {
        path: page.path,
      });
    }
    if (page.parent !== null && page.parent === page.path) {
      throw new DopellerError("invalid_page_tree", "internal", `path_equals_parent:${page.path}`, {
        path: page.path,
      });
    }
    if (page.path !== "/") {
      if (page.parent === null) {
        throw new DopellerError("invalid_page_tree", "internal", "parent_missing:null", {
          path: page.path,
        });
      }
      if (!this.pages.has(page.parent)) {
        throw new DopellerError("invalid_page_tree", "internal", `parent_missing:${page.parent}`, {
          path: page.path,
          parent: page.parent,
        });
      }
    }
    this.pages.set(page.path, page);
  }

  /** Register a flat list of pages, in order. */
  registerMany(pages: PageDefinition[]): void {
    for (const page of pages) {
      this.register(page);
    }
  }

  /**
   * Register a page subtree. Each child's `parent` MUST equal the parent
   * node's `path`; mismatches throw a {@link DopellerError} naming the
   * offending pair so the structural defect is obvious at boot.
   */
  registerTree(node: PageTreeNode): void {
    this.register(node.page);
    if (!node.children) return;
    for (const child of node.children) {
      if (child.page.parent !== node.page.path) {
        throw new DopellerError(
          "invalid_page_tree",
          "internal",
          `parent_mismatch:${child.page.path} declares parent=${String(child.page.parent)} but tree edge is ${node.page.path}`,
          {
            childPath: child.page.path,
            expectedParent: node.page.path,
            actualParent: child.page.parent,
          },
        );
      }
      this.registerTree(child);
    }
  }

  /** Lookup. Returns `undefined` for unknown paths. */
  get(path: string): PageDefinition | undefined {
    return this.pages.get(path);
  }

  /**
   * Strict lookup. Throws {@link DopellerError} with code `unknown_page`
   * and severity `user` — the navigation router surfaces this as a toast.
   */
  getOrThrow(path: string): PageDefinition {
    const page = this.pages.get(path);
    if (!page) {
      throw new DopellerError("unknown_page", "user", `unknown_page:${path}`, {
        path,
      });
    }
    return page;
  }

  /** Existence check. */
  has(path: string): boolean {
    return this.pages.has(path);
  }

  /** All registered paths, sorted lexicographically. */
  paths(): string[] {
    return [...this.pages.keys()].sort();
  }

  /**
   * All pages whose `parent === path`, sorted by their own path. Used by
   * the renderer to compose Back / sibling keyboards.
   */
  childrenOf(path: string): PageDefinition[] {
    const out: PageDefinition[] = [];
    for (const page of this.pages.values()) {
      if (page.parent === path) out.push(page);
    }
    out.sort((a, b) => a.path.localeCompare(b.path));
    return out;
  }
}

/**
 * Module-level default registry. The bootstrap populates this instance
 * with the consumer's pages so application code can `import { defaultRegistry }`
 * without threading a registry through every handler.
 */
export const defaultRegistry: PageRegistry = new PageRegistry();
