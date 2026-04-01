/**
 * CommandRegistry — Register, look up, and dispatch CLI commands.
 *
 * Provides tab-completion and auto-generated /help output.
 */

import type { Command, CommandContext } from "./types.js";
import { c } from "./colors.js";

export class CommandRegistry {
  private commands: Map<string, Command> = new Map();
  private aliases: Map<string, string> = new Map();

  /** Register a command */
  register(cmd: Command): void {
    this.commands.set(cmd.name, cmd);
    for (const alias of cmd.aliases) {
      this.aliases.set(alias, cmd.name);
    }
  }

  /** Resolve a name or alias to a Command */
  resolve(input: string): Command | undefined {
    const lower = input.toLowerCase();
    const name = this.aliases.get(lower) ?? lower;
    return this.commands.get(name);
  }

  /** Get all command names + aliases for tab completion */
  completions(): string[] {
    const all: string[] = [];
    for (const cmd of this.commands.values()) {
      all.push(`/${cmd.name}`);
      for (const a of cmd.aliases) {
        all.push(`/${a}`);
      }
    }
    return all.sort();
  }

  /** Dispatch an input string to the right command */
  async dispatch(input: string, ctx: CommandContext): Promise<boolean> {
    // Strip leading /
    const raw = input.startsWith("/") ? input.slice(1) : input;
    const spaceIdx = raw.indexOf(" ");
    const cmdName = spaceIdx === -1 ? raw : raw.slice(0, spaceIdx);
    const args = spaceIdx === -1 ? "" : raw.slice(spaceIdx + 1).trim();

    const cmd = this.resolve(cmdName);
    if (!cmd) return false;

    if (cmd.requiresInit && !ctx.initialized) {
      ctx.print(c.error("Not initialized. Run /init first."));
      return true;
    }

    await cmd.execute(args, ctx);
    return true;
  }

  /** Print formatted help grouped by category */
  printHelp(ctx: CommandContext): void {
    const categories: Record<string, Command[]> = {};
    for (const cmd of this.commands.values()) {
      if (!categories[cmd.category]) categories[cmd.category] = [];
      categories[cmd.category]!.push(cmd);
    }

    const categoryLabels: Record<string, string> = {
      setup: "Setup & Configuration",
      planning: "Planning",
      tasks: "Task Management",
      worker: "Worker CLI",
      config: "Auto-Approve & Execution",
      debug: "Testing & Debug",
      system: "Utilities",
    };

    const order = ["setup", "planning", "tasks", "worker", "config", "debug", "system"];

    ctx.print(`\n${c.header(" COMMANDS ")}\n`);

    for (const cat of order) {
      const cmds = categories[cat];
      if (!cmds || cmds.length === 0) continue;

      ctx.print(c.cmd(categoryLabels[cat] || cat));
      for (const cmd of cmds) {
        const aliases = cmd.aliases.length > 0 ? c.dim(` (${cmd.aliases.join(", ")})`) : "";
        ctx.print(`  ${cmd.usage.padEnd(30)} ${cmd.description}${aliases}`);
      }
      ctx.print("");
    }

    ctx.print(c.dim("Prefix commands with / (e.g. /plan, /tasks)"));
    ctx.print(c.dim("Bare text is sent to orchestrator or active worker\n"));
  }
}
