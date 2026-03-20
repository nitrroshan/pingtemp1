/**
 * Config commands: /autoexec, /autoapprove
 */

import type { Command } from "../types.js";
import { c } from "../colors.js";

export const autoExecCommand: Command = {
  name: "autoexec",
  aliases: ["ae"],
  description: "Toggle auto-execute mode",
  usage: "/autoexec [on|off]",
  category: "config",
  requiresInit: true,
  async execute(args, ctx) {
    const lower = args.toLowerCase();
    if (lower === "on" || lower === "true") {
      ctx.mgr!.setAutoExecute(true);
      ctx.print(c.success("Auto-execute ENABLED"));
    } else if (lower === "off" || lower === "false") {
      ctx.mgr!.setAutoExecute(false);
      ctx.print(
        c.success("Auto-execute DISABLED — tasks wait for manual start"),
      );
    } else {
      ctx.print(
        `Auto-execute: ${ctx.mgr!.getAutoExecute() ? c.success("ON") : c.warn("OFF")}`,
      );
    }
  },
};

export const autoApproveCommand: Command = {
  name: "autoapprove",
  aliases: ["aa"],
  description: "Configure auto-approve settings",
  usage: "/autoapprove [on|off|role]",
  category: "config",
  requiresInit: true,
  async execute(args, ctx) {
    const lower = args.toLowerCase();
    if (lower === "on" || lower === "true") {
      ctx.mgr!.setAutoApproveAllRoles(true);
      ctx.print(c.success("Auto-approve enabled for ALL roles"));
    } else if (lower === "off" || lower === "false") {
      ctx.mgr!.setAutoApproveAllRoles(false);
      ctx.print(c.success("Auto-approve disabled"));
    } else if (lower) {
      ctx.mgr!.setAutoApproveForRole(lower, true);
      ctx.print(c.success(`Auto-approve enabled for role: ${lower}`));
    } else {
      const roles = ctx.mgr!.getAutoApproveRoles();
      ctx.print(
        `Auto-approve: ${roles.length > 0 ? roles.join(", ") : c.dim("none")}`,
      );
    }
  },
};
