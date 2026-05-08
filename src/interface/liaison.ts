import type { ProgressBus, ProgressEvent } from "../orchestrator/events.ts";

/**
 * Interface Liaison. Every user-visible string MUST flow through here. No
 * agent, phase, or service module is allowed to write to stdout / send a
 * Telegram message directly. The Liaison fans `ProgressEvent`s out to the
 * registered renderers (CLI, Telegram, …).
 */

export interface Renderer {
  render(event: ProgressEvent): void | Promise<void>;
}

export class Liaison {
  #renderers: Renderer[] = [];

  constructor(bus: ProgressBus) {
    bus.subscribe((ev) => {
      for (const r of this.#renderers) {
        try {
          void r.render(ev);
        } catch {
          // a misbehaving renderer must not crash the orchestrator
        }
      }
    });
  }

  attach(renderer: Renderer): void {
    this.#renderers.push(renderer);
  }
}
