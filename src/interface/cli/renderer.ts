import kleur from "kleur";
import type { ProgressEvent } from "../../orchestrator/events.ts";
import type { Renderer } from "../liaison.ts";

const stageColor = kleur.cyan;
const labelColor = kleur.bold;
const warnColor = kleur.yellow;
const errColor = kleur.red;
const okColor = kleur.green;
const dim = kleur.gray;

/**
 * CLI renderer. Charm-flavoured output — concise, dense, color-aware.
 * Replaces the old per-phase progress class. Subscribes to the
 * orchestrator ProgressBus via the Liaison; never writes outside `render()`.
 */
export class CliRenderer implements Renderer {
  render(event: ProgressEvent): void {
    switch (event.type) {
      case "stage_started":
        process.stdout.write(
          `\n${stageColor("▶")} ${labelColor(event.label)} ${dim(`(${event.stageId})`)}\n`,
        );
        return;
      case "step_started":
        process.stdout.write(`  ${dim("·")} ${event.label}\n`);
        return;
      case "tool_started":
        process.stdout.write(`  ${dim("→")} ${event.tool} ${dim(event.inputSummary)}\n`);
        return;
      case "tool_finished":
        process.stdout.write(`  ${dim("✓")} ${event.tool} ${dim(event.resultSummary)}\n`);
        return;
      case "approval_required":
        process.stdout.write(
          `\n${kleur.magenta("◆")} ${labelColor("approval needed")} ${dim(`[${event.gate} ${event.approvalId}]`)}\n` +
            `  ${event.label}\n` +
            `  ${dim(`artifact: ${event.artifact}`)}\n`,
        );
        return;
      case "approval_recorded":
        process.stdout.write(
          `${okColor("✓")} ${event.gate} ${dim(event.approvalId)} ${dim(`(${event.status})`)}\n`,
        );
        return;
      case "stage_completed":
        if (event.artifactPaths.length > 0) {
          process.stdout.write(
            `${okColor("✓")} ${dim(`${event.stageId} → ${event.artifactPaths.join(", ")}`)}\n`,
          );
        } else {
          process.stdout.write(`${okColor("✓")} ${dim(event.stageId)}\n`);
        }
        return;
      case "warning":
        process.stdout.write(`${warnColor("!")} ${event.message}\n`);
        return;
      case "info":
        process.stdout.write(`${dim("·")} ${event.message}\n`);
        return;
      case "error":
        process.stderr.write(
          `${errColor("✗")} ${event.message}${event.recoverable ? dim(" (recoverable)") : ""}\n`,
        );
        return;
      case "token_stream":
        process.stdout.write(event.text);
        return;
    }
  }
}
