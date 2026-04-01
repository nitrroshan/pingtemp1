/**
 * CLI Command Types
 *
 * Defines the command interface used by CommandRegistry.
 */

import type { AgentManager } from "../agentManager/AgentManagerV2.js";

/** Shared context passed to every command handler */
export interface CommandContext {
  /** The AgentManager instance (null before init) */
  mgr: AgentManager | null;
  /** Whether init has been called */
  initialized: boolean;
  /** Currently active task ID in the CLI */
  activeTaskId: string | null;
  /** Currently active worker role (null = orchestrator mode) */
  activeWorkerRole: string | null;
  /** Team ID */
  teamId: string;
  /** Team roles */
  teamRoles: string[];
  /** Print helper */
  print: (msg: string) => void;
  /** Set active task */
  setActiveTask: (taskId: string | null) => void;
  /** Set active worker */
  setActiveWorker: (role: string | null) => void;
  /** Set initialized flag */
  setInitialized: (v: boolean) => void;
  /** Set manager */
  setManager: (mgr: AgentManager) => void;
  /** Exit the CLI */
  exit: () => Promise<void>;
}

/** A registered CLI command */
export interface Command {
  /** Primary command name (e.g. "plan") */
  name: string;
  /** Short aliases (e.g. ["p"]) */
  aliases: string[];
  /** One-line description for help */
  description: string;
  /** Usage example (e.g. "/plan <description>") */
  usage: string;
  /** Category for grouping in help */
  category: "setup" | "planning" | "tasks" | "worker" | "config" | "debug" | "system";
  /** Whether this command requires init */
  requiresInit: boolean;
  /** Execute the command */
  execute: (args: string, ctx: CommandContext) => Promise<void>;
}
