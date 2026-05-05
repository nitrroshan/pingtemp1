#!/usr/bin/env bun
/**
 * migrate-to-pg.ts — Migrate relational data from MongoDB/SQLite to PostgreSQL.
 *
 * Schema design: PG uses DB-generated UUIDs as PKs. Business IDs (teamId, goalId, taskId)
 * are stored in separate unique-indexed columns. This script inserts into the business ID
 * columns and lets PG generate the UUIDs.
 *
 * Usage:
 *   bun run scripts/migrate-to-pg.ts                    # dry-run (default)
 *   bun run scripts/migrate-to-pg.ts --execute          # real migration
 *   bun run scripts/migrate-to-pg.ts --source=mongo     # from MongoDB
 *   bun run scripts/migrate-to-pg.ts --source=sqlite    # from SQLite
 *
 * Idempotent: uses ON CONFLICT DO NOTHING on business ID columns.
 */

import { resolve, join } from "path";

const args = process.argv.slice(2);
const dryRun = !args.includes("--execute");
const sourceArg = args.find(a => a.startsWith("--source="));
const source = sourceArg?.split("=")[1] ?? "auto";

console.log(`\n🔄 Ping Data Migration → PostgreSQL (UUID schema)`);
console.log(`   Mode: ${dryRun ? "DRY RUN (add --execute to apply)" : "⚠️  EXECUTING"}`);
console.log(`   Source: ${source}\n`);

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("❌ DATABASE_URL is required.");
  process.exit(1);
}

const { getDb } = await import("../db/connection.js");
const { organizations, orgMembers, agentTeams, goals, tasks } = await import("../db/schema.js");
const db = getDb();

// Detect source
let useMongoSource = false;
let useSqliteSource = false;

if (source === "mongo" || source === "auto") {
  const mongoUri = process.env.MONGODB_URI;
  if (mongoUri) {
    try {
      const mongoose = (await import("mongoose")).default;
      if (mongoose.connection.readyState !== 1) await mongoose.connect(mongoUri);
      useMongoSource = true;
      console.log(`✅ MongoDB connected`);
    } catch (e) {
      if (source === "mongo") { console.error("❌ MongoDB failed:", e); process.exit(1); }
    }
  }
}

if (!useMongoSource && (source === "sqlite" || source === "auto")) {
  const dbPath = join(process.env.DATA_DIR || "./data", "ping.db");
  const fs = await import("fs");
  if (fs.existsSync(dbPath)) { useSqliteSource = true; console.log(`✅ SQLite found: ${dbPath}`); }
}

if (!useMongoSource && !useSqliteSource) {
  console.log("ℹ️  No source data found. Nothing to migrate.");
  process.exit(0);
}

const counts = { goals: 0, tasks: 0, teams: 0, orgs: 0, skipped: 0 };

// Helper: insert org + owner membership, return org UUID
async function ensureOrg(ownerId: string): Promise<string> {
  // Check existing
  const existing = await db.select({ orgId: orgMembers.orgId }).from(orgMembers)
    .where(({ eq, and }) => and(eq(orgMembers.userId, ownerId), eq(orgMembers.role, "owner")))
    .limit(1);
  if (existing.length > 0) return existing[0].orgId;

  const [org] = await db.insert(organizations).values({ name: "Personal", plan: "free" }).returning();
  await db.insert(orgMembers).values({ orgId: org.id, userId: ownerId, role: "owner" });
  counts.orgs++;
  return org.id;
}

// Helper: insert agent_team, return UUID
async function ensureTeam(teamId: string, orgId: string, pluginName: string): Promise<string> {
  const { eq } = await import("drizzle-orm");
  const existing = await db.select({ id: agentTeams.id }).from(agentTeams)
    .where(eq(agentTeams.teamId, teamId)).limit(1);
  if (existing.length > 0) return existing[0].id;

  const [team] = await db.insert(agentTeams).values({
    teamId,
    orgId,
    name: pluginName.replace(/-/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()),
    pluginName,
  }).returning();
  counts.teams++;
  return team.id;
}

// Helper: insert goal, return UUID
async function ensureGoal(goalId: string, teamUuid: string, userId: string, title: string, status: string, opts: any = {}): Promise<string> {
  const { eq } = await import("drizzle-orm");
  const existing = await db.select({ id: goals.id }).from(goals)
    .where(eq(goals.goalId, goalId)).limit(1);
  if (existing.length > 0) return existing[0].id;

  const [goal] = await db.insert(goals).values({
    goalId,
    agentTeamId: teamUuid,
    createdBy: userId,
    title,
    status: mapGoalStatus(status),
    repoUrl: opts.repoUrl ?? null,
    repoBranch: opts.repoBranch ?? null,
    planId: opts.planId ?? null,
    result: opts.result ?? null,
  }).returning();
  counts.goals++;
  return goal.id;
}

// ── Migrate from MongoDB ──
if (useMongoSource) {
  console.log("\n📦 Reading from MongoDB...\n");
  const { default: mongoose } = await import("mongoose");

  // 1. Team registrations
  const TeamRegModel = mongoose.models.TeamRegistry ||
    mongoose.model("TeamRegistry", new mongoose.Schema({
      teamId: String, ownerId: String, pluginName: String,
      createdAt: { type: Date, default: Date.now },
    }, { collection: "teamregistries" }));

  const teamDocs = await TeamRegModel.find().lean();
  console.log(`   Team registrations: ${teamDocs.length}`);

  if (!dryRun) {
    for (const t of teamDocs) {
      const doc = t as any;
      try {
        const orgId = await ensureOrg(doc.ownerId);
        await ensureTeam(doc.teamId, orgId, doc.pluginName ?? "unknown");
      } catch (e: any) { console.warn(`   ⚠️ Team ${doc.teamId}: ${e.message}`); counts.skipped++; }
    }
  }

  // 2. Goals
  const { GoalModel } = await import("../services/mongo/schemas/GoalSchema.js");
  const goalDocs = await GoalModel.find().lean();
  console.log(`   Goals: ${goalDocs.length}`);

  if (!dryRun) {
    for (const g of goalDocs) {
      const doc = g as any;
      const goalId = doc.goalId || doc._id.toString();
      try {
        // Resolve team UUID
        const { eq } = await import("drizzle-orm");
        const teamRows = await db.select({ id: agentTeams.id }).from(agentTeams)
          .where(eq(agentTeams.teamId, doc.teamId)).limit(1);
        if (teamRows.length === 0) { counts.skipped++; continue; }

        await ensureGoal(goalId, teamRows[0].id, doc.userId, doc.goal, doc.status, {
          repoUrl: doc.repoUrl, repoBranch: doc.repoBranch, planId: doc.planId, result: doc.result,
        });
      } catch (e: any) { console.warn(`   ⚠️ Goal ${goalId}: ${e.message}`); counts.skipped++; }
    }
  }

  // 3. Tasks
  const TaskModel = mongoose.models.Task ||
    mongoose.model("Task", new mongoose.Schema({
      taskId: String, goalId: String, teamId: String, title: String,
      description: String, status: String, assignedRole: String,
      priority: Number, output: mongoose.Schema.Types.Mixed,
      planId: String, dependencies: [String],
    }, { timestamps: true, collection: "tasks" }));

  const taskDocs = await TaskModel.find().lean();
  console.log(`   Tasks: ${taskDocs.length}`);

  if (!dryRun) {
    for (const t of taskDocs) {
      const doc = t as any;
      try {
        // Resolve goal UUID from goalId
        const { eq } = await import("drizzle-orm");
        const goalRows = await db.select({ id: goals.id }).from(goals)
          .where(eq(goals.goalId, doc.goalId)).limit(1);
        if (goalRows.length === 0) { counts.skipped++; continue; }

        await db.insert(tasks).values({
          taskId: doc.taskId,
          goalId: goalRows[0].id,
          title: doc.title ?? null,
          description: doc.description ?? "",
          status: mapTaskStatus(doc.status),
          assignedRole: doc.assignedRole ?? "unknown",
          priority: doc.priority ?? 3,
          planId: doc.planId ?? null,
          output: doc.output ?? null,
          dependencies: doc.dependencies ?? null,
        }).onConflictDoNothing();
        counts.tasks++;
      } catch (e: any) { console.warn(`   ⚠️ Task ${doc.taskId}: ${e.message}`); counts.skipped++; }
    }
  }
}

// ── Migrate from SQLite ──
if (useSqliteSource) {
  console.log("\n📦 Reading from SQLite...\n");
  const { Database } = await import("bun:sqlite");
  const sqliteDb = new Database(join(process.env.DATA_DIR || "./data", "ping.db"));

  // 1. Team registrations
  try {
    const teamRows = sqliteDb.query("SELECT * FROM team_registry").all() as any[];
    console.log(`   Team registrations: ${teamRows.length}`);
    if (!dryRun) {
      for (const row of teamRows) {
        try {
          const orgId = await ensureOrg(row.owner_id);
          await ensureTeam(row.team_id, orgId, row.plugin_name ?? "unknown");
        } catch (e: any) { counts.skipped++; }
      }
    }
  } catch { console.log("   No team_registry table found"); }

  // 2. Goals
  try {
    const goalRows = sqliteDb.query("SELECT * FROM goals").all() as any[];
    console.log(`   Goals: ${goalRows.length}`);
    if (!dryRun) {
      const { eq } = await import("drizzle-orm");
      for (const row of goalRows) {
        try {
          const goalId = row.goal_id || row.id;
          const teamRows2 = await db.select({ id: agentTeams.id }).from(agentTeams)
            .where(eq(agentTeams.teamId, row.team_id)).limit(1);
          if (teamRows2.length === 0) { counts.skipped++; continue; }
          await ensureGoal(goalId, teamRows2[0].id, row.user_id, row.goal, row.status, {
            repoUrl: row.repo_url, repoBranch: row.repo_branch, planId: row.plan_id, result: row.result,
          });
        } catch { counts.skipped++; }
      }
    }
  } catch { console.log("   No goals table found"); }

  // 3. Tasks
  try {
    const taskRows = sqliteDb.query("SELECT * FROM tasks").all() as any[];
    console.log(`   Tasks: ${taskRows.length}`);
    if (!dryRun) {
      const { eq } = await import("drizzle-orm");
      for (const row of taskRows) {
        try {
          const goalRows2 = await db.select({ id: goals.id }).from(goals)
            .where(eq(goals.goalId, row.goal_id || row.id)).limit(1);
          if (goalRows2.length === 0) { counts.skipped++; continue; }
          await db.insert(tasks).values({
            taskId: row.task_id || row.id,
            goalId: goalRows2[0].id,
            title: row.title ?? null,
            description: row.description ?? "",
            status: mapTaskStatus(row.status),
            assignedRole: row.assigned_role ?? "unknown",
            priority: row.priority ?? 3,
            planId: row.plan_id ?? null,
            output: row.output ? JSON.parse(row.output) : null,
            dependencies: row.dependencies ? JSON.parse(row.dependencies) : null,
          }).onConflictDoNothing();
          counts.tasks++;
        } catch { counts.skipped++; }
      }
    }
  } catch { console.log("   No tasks table found"); }

  sqliteDb.close();
}

// Summary
console.log("\n📊 Migration Summary:");
console.log(`   Organizations: ${counts.orgs}`);
console.log(`   Teams: ${counts.teams}`);
console.log(`   Goals: ${counts.goals}`);
console.log(`   Tasks: ${counts.tasks}`);
console.log(`   Skipped: ${counts.skipped}`);

if (dryRun) {
  console.log("\n⚠️  DRY RUN — no data written. Run with --execute to apply.\n");
} else {
  console.log("\n✅ Migration complete!\n");
}

const { closeDb } = await import("../db/connection.js");
await closeDb();
if (useMongoSource) {
  const mongoose = (await import("mongoose")).default;
  await mongoose.disconnect();
}
process.exit(0);

function mapGoalStatus(s?: string): any {
  const v = ["pending", "planning", "researching", "awaiting_approval", "executing", "completed", "failed"] as const;
  return s && v.includes(s as any) ? s : "pending";
}
function mapTaskStatus(s?: string): any {
  const v = ["ready", "pending", "in_progress", "completed", "failed", "discarded"] as const;
  return s && v.includes(s as any) ? s : "pending";
}
