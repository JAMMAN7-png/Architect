import kleur from "kleur";
import ora, { type Ora } from "ora";

/**
 * Spinner + per-phase progress reporter. Quiet under non-TTY (CI/pipes) — only
 * prints status lines on phase transitions in that mode.
 */

export interface PhaseReport {
  index: number;
  total: number;
  name: string;
}

export class Progress {
  private spinner: Ora | null = null;
  private readonly tty: boolean;

  constructor() {
    this.tty = Boolean(process.stdout.isTTY) && process.env.ARCHITECT_JSON !== "1";
  }

  start(report: PhaseReport, message: string): void {
    const prefix = kleur.dim(`[${report.index}/${report.total}]`);
    const label = `${prefix} ${kleur.cyan(report.name)} ${kleur.dim("·")} ${message}`;
    if (this.tty) {
      this.spinner = ora({ text: label, color: "cyan" }).start();
    } else {
      console.log(label);
    }
  }

  update(message: string): void {
    if (this.spinner) this.spinner.text = message;
  }

  succeed(message?: string): void {
    if (this.spinner) {
      this.spinner.succeed(message ?? this.spinner.text);
      this.spinner = null;
    } else if (message) {
      console.log(`${kleur.green("✓")} ${message}`);
    }
  }

  fail(message?: string): void {
    if (this.spinner) {
      this.spinner.fail(message ?? this.spinner.text);
      this.spinner = null;
    } else if (message) {
      console.log(`${kleur.red("✗")} ${message}`);
    }
  }

  warn(message: string): void {
    if (this.spinner) {
      this.spinner.warn(message);
      this.spinner = null;
    } else {
      console.log(`${kleur.yellow("!")} ${message}`);
    }
  }

  info(message: string): void {
    if (this.spinner) {
      const current = this.spinner.text;
      this.spinner.stop();
      console.log(`${kleur.blue("i")} ${message}`);
      this.spinner.start(current);
    } else {
      console.log(`${kleur.blue("i")} ${message}`);
    }
  }

  stop(): void {
    if (this.spinner) {
      this.spinner.stop();
      this.spinner = null;
    }
  }
}
