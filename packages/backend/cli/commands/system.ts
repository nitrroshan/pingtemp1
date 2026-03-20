/**
 * System commands: /help, /clear, /exit
 */

import type { Command, CommandContext } from "../types.js";
import type { CommandRegistry } from "../CommandRegistry.js";
import { c } from "../colors.js";

/** Creates the /help command — needs registry reference for auto-generation */
export function createHelpCommand(registry: CommandRegistry): Command {
  return {
    name: "help",
    aliases: ["h", "?"],
    description: "Show available commands",
    usage: "/help",
    category: "system",
    requiresInit: false,
    async execute(_args, ctx) {
      registry.printHelp(ctx);
    },
  };
}

export const clearCommand: Command = {
  name: "clear",
  aliases: ["cls"],
  description: "Clear screen",
  usage: "/clear",
  category: "system",
  requiresInit: false,
  async execute(_args, _ctx) {
    console.clear();
  },
};

export const exitCommand: Command = {
  name: "exit",
  aliases: ["q", "quit"],
  description: "Exit CLI",
  usage: "/exit",
  category: "system",
  requiresInit: false,
  async execute(_args, ctx) {
    await ctx.exit();
  },
};
