-- GitHub-style ownership: org_id nullable, created_by added
-- agent_teams can be user-owned (org_id NULL) or org-owned (org_id set)
ALTER TABLE "agent_teams" ALTER COLUMN "org_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_teams" ADD COLUMN "created_by" text NOT NULL DEFAULT 'system';--> statement-breakpoint
-- Backfill: assign existing teams to their org owner (not 'system')
-- Teams that have an org get the org owner's userId; teams without an org keep 'system'
UPDATE "agent_teams" SET "created_by" = sub.owner_id
FROM (
  SELECT at.id AS team_uuid, om.user_id AS owner_id
  FROM "agent_teams" at
  JOIN "org_members" om ON at.org_id = om.org_id AND om.role = 'owner'
) sub
WHERE "agent_teams".id = sub.team_uuid;--> statement-breakpoint
-- Remove the default — new rows must supply created_by explicitly
ALTER TABLE "agent_teams" ALTER COLUMN "created_by" DROP DEFAULT;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_agent_teams_created_by" ON "agent_teams" USING btree ("created_by");