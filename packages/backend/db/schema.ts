/**
 * PostgreSQL Schema — Drizzle ORM
 *
 * Design principles:
 *   - PKs are DB-generated UUIDs (gen_random_uuid()) — globally unique, stable for FKs
 *   - Business identifiers (goal_id, task_id, plugin_name) are unique-indexed columns for lookups
 *   - FKs reference UUID PKs, never business IDs
 *   - snake_case everywhere, enums for constrained values
 *
 * Ownership model (GitHub-style):
 *   - Agent teams have a created_by (user) for direct ownership
 *   - org_id is OPTIONAL — NULL means user-owned, set means org-owned
 *   - Organizations are explicit: users create them when they want shared teams
 *   - org_members provides role-based access control for org-owned teams
 *   - goals + tasks cascade from agent_teams
 *
 * Auth tables (users, sessions, accounts) managed by better-auth Drizzle adapter.
 * Chat messages stay in MongoDB — not in this schema.
 */

import {
  pgTable,
  text,
  timestamp,
  integer,
  jsonb,
  pgEnum,
  primaryKey,
  boolean,
  index,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ─────────────────────────────────────────────────────────────
// Enums
// ─────────────────────────────────────────────────────────────

export const orgRoleEnum = pgEnum("org_role", [
  "owner",
  "admin",
  "member",
  "viewer",
]);

export const goalStatusEnum = pgEnum("goal_status", [
  "pending",
  "planning",
  "researching",
  "awaiting_approval",
  "executing",
  "completed",
  "failed",
]);

export const taskStatusEnum = pgEnum("task_status", [
  "ready",
  "pending",
  "in_progress",
  "completed",
  "failed",
  "discarded",
]);

// ─────────────────────────────────────────────────────────────
// AUTH TABLES — better-auth core schema (Drizzle adapter)
// ─────────────────────────────────────────────────────────────

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ─────────────────────────────────────────────────────────────
// HUMAN LAYER — organizations and membership
// ─────────────────────────────────────────────────────────────

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  plan: text("plan").default("free"), // free | pro | enterprise
  createdAt: timestamp("created_at").defaultNow(),
});

export const orgMembers = pgTable(
  "org_members",
  {
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(), // FK to better-auth users table
    role: orgRoleEnum("role").notNull().default("member"),
    joinedAt: timestamp("joined_at").defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.userId] }),
    index("idx_org_members_user").on(t.userId),
  ],
);

// ─────────────────────────────────────────────────────────────
// AGENT LAYER — agent teams, goals, tasks
// ─────────────────────────────────────────────────────────────

export const agentTeams = pgTable(
  "agent_teams",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    /** Optional — NULL = user-owned, set = org-owned (GitHub model) */
    orgId: uuid("org_id")
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** The user who created/owns this team (always set) */
    createdBy: text("created_by").notNull(),
    /** Deterministic SHA-256 hash of plugin name — used by PluginTeamService for lookups */
    teamId: text("team_id").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    pluginName: text("plugin_name").notNull(),
    isActive: boolean("is_active").default(true),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => [
    uniqueIndex("idx_agent_teams_team_id").on(t.teamId),
    index("idx_agent_teams_org").on(t.orgId),
    index("idx_agent_teams_plugin").on(t.pluginName),
    index("idx_agent_teams_created_by").on(t.createdBy),
  ],
);

export const goals = pgTable(
  "goals",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    /** Business identifier — deterministic slug used by frontend, rooms, orchestrator */
    goalId: text("goal_id").notNull(),
    agentTeamId: uuid("agent_team_id")
      .notNull()
      .references(() => agentTeams.id, { onDelete: "cascade" }),
    createdBy: text("created_by").notNull(), // FK to users
    title: text("title").notNull(),
    status: goalStatusEnum("status").notNull().default("pending"),
    repoUrl: text("repo_url"),
    repoBranch: text("repo_branch"),
    planId: text("plan_id"),
    approvedBy: text("approved_by"), // FK to users (who approved the plan)
    result: text("result"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (t) => [
    uniqueIndex("idx_goals_goal_id").on(t.goalId),
    index("idx_goals_team").on(t.agentTeamId),
    index("idx_goals_created_by").on(t.createdBy),
    index("idx_goals_status").on(t.status),
  ],
);

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    /** Business task identifier (e.g., "task-1") — unique within a goal */
    taskId: text("task_id").notNull(),
    goalId: uuid("goal_id")
      .notNull()
      .references(() => goals.id, { onDelete: "cascade" }),
    title: text("title"),
    description: text("description").notNull(),
    status: taskStatusEnum("status").notNull().default("pending"),
    assignedRole: text("assigned_role").notNull(),
    priority: integer("priority").default(3),
    planId: text("plan_id"),
    output: jsonb("output"),
    dependencies: text("dependencies").array(), // business taskId[] (not UUIDs)
    inputDocs: jsonb("input_docs"), // DocumentRef[]
    producedDocs: jsonb("produced_docs"), // DocumentRef[]
    decisions: jsonb("decisions"), // Array<{ decision, rationale? }>
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (t) => [
    uniqueIndex("idx_tasks_goal_task").on(t.goalId, t.taskId),
    index("idx_tasks_goal").on(t.goalId),
    index("idx_tasks_status").on(t.status),
    index("idx_tasks_role").on(t.assignedRole),
  ],
);

export const agentDefinitions = pgTable(
  "agent_definitions",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    agentTeamId: uuid("agent_team_id")
      .notNull()
      .references(() => agentTeams.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    role: text("role").notNull(),
    description: text("description"),
    goal: text("goal"),
    capabilities: jsonb("capabilities"),
    systemPrompt: text("system_prompt"),
    config: jsonb("config"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => [
    index("idx_agent_defs_team").on(t.agentTeamId),
    uniqueIndex("idx_agent_defs_team_role").on(t.agentTeamId, t.role),
  ],
);
