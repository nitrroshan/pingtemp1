/**
 * Worker Capabilities — Reusable prompt sections for worker agents
 *
 * Each capability is a self-contained definition: name, description, tools.
 * WorkerPromptFactory selects which capabilities to include based on
 * what plugins are available (e.g., no workspace plugin → no workspace capability).
 */

export interface CapabilityDef {
  name: string;
  description: string;
  tools: string[];
}

export const LIFECYCLE: CapabilityDef = {
  name: "lifecycle",
  description:
    "Report your progress and signal when your task is complete.",
  tools: ["report_status", "complete_task"],
};

export const WORKSPACE: CapabilityDef = {
  name: "workspace",
  description:
    "You work inside a git-based workspace (a branch isolated to your task). " +
    "Create, read, edit, and search files. Commit frequently after each logical step.",
  tools: [
    "workspace_create_file", "workspace_write_file", "workspace_read_file",
    "workspace_list_files", "workspace_delete_file", "workspace_file_exists",
    "workspace_grep", "workspace_glob", "workspace_keyword_search",
    "workspace_search_and_replace", "workspace_commit", "workspace_publish",
    "workspace_status", "workspace_info", "workspace_get_history", "workspace_file_stats",
  ],
};

export const SCRATCHPAD: CapabilityDef = {
  name: "scratchpad",
  description:
    "Private working memory for notes, todos, and drafts. Not shared with other agents.",
  tools: ["scratch_note", "scratch_todo", "scratch_remember", "scratch_file", "promote_to_workspace"],
};

export const COLLABORATION: CapabilityDef = {
  name: "collaboration",
  description:
    "Shared CRDT documents visible to all agents. Use write-block for text content " +
    "(reports, summaries), write for structured data (agent-statuses, configs). " +
    "Use read-block to see what humans and other agents wrote.",
  tools: ["collab"],
};

export const IDENTITY: CapabilityDef = {
  name: "identity",
  description:
    "Check who you are, your task, your tools, and your progress.",
  tools: ["who_am_i", "my_progress", "my_tools", "my_context"],
};

/** All default worker capabilities in standard order */
export const DEFAULT_WORKER_CAPABILITIES: CapabilityDef[] = [
  LIFECYCLE, WORKSPACE, SCRATCHPAD, COLLABORATION, IDENTITY,
];
