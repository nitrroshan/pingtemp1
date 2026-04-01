/**
 * Team Routes Integration Tests
 *
 * Tests the REST API endpoints for Team Service.
 * Uses supertest for HTTP testing.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import request from "supertest";
import express from "express";
import { Types } from "mongoose";
import { createTeamRoutes } from "./teams.js";
import { TeamService } from "../../team/index.js";
import { initTeamServiceDb, closeDb } from "../../team/database.js";
import {
  TeamModel,
  AgentModel,
  TeamMemberModel,
  AgentSkillModel,
} from "../../team/models.js";

// Create Express app with team routes
let app: express.Application;
let teamService: TeamService;

describe("Team Routes API", () => {
  beforeAll(async () => {
    // Connect to test database
    await initTeamServiceDb();

    // Create TeamService and mount routes
    teamService = new TeamService();
    app = express();
    app.use(express.json());
    app.use("/api/v1/teams", createTeamRoutes(teamService));
  });

  afterAll(async () => {
    // Cleanup and close connection
    await TeamModel.deleteMany({});
    await AgentModel.deleteMany({});
    await TeamMemberModel.deleteMany({});
    await AgentSkillModel.deleteMany({});
    await closeDb();
  });

  beforeEach(async () => {
    // Clean up before each test
    await TeamModel.deleteMany({});
    await AgentModel.deleteMany({});
    await TeamMemberModel.deleteMany({});
    await AgentSkillModel.deleteMany({});
  });

  // ===========================================================================
  // Team CRUD Tests
  // ===========================================================================

  describe("POST /api/v1/teams", () => {
    it("should create a team with Planner Agent", async () => {
      const res = await request(app).post("/api/v1/teams").send({
        name: "API Test Team",
        ownerId: "user-api-123",
      });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe("created");
      expect(res.body.team.name).toBe("API Test Team");
      expect(res.body.team.ownerId).toBe("user-api-123");
      expect(res.body.team.workspaceId).toBeDefined();
    });

    it("should return 400 if name is missing", async () => {
      const res = await request(app).post("/api/v1/teams").send({
        ownerId: "user-123",
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Team name is required");
    });

    it("should return 400 if ownerId is missing", async () => {
      const res = await request(app).post("/api/v1/teams").send({
        name: "Test Team",
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Owner ID is required");
    });
  });

  describe("GET /api/v1/teams/:id", () => {
    it("should return team with agents and members", async () => {
      // Create team first
      const createRes = await request(app).post("/api/v1/teams").send({
        name: "Get Test Team",
        ownerId: "user-get-123",
      });

      const teamId = createRes.body.team.id;

      const res = await request(app).get(`/api/v1/teams/${teamId}`);

      expect(res.status).toBe(200);
      expect(res.body.team.name).toBe("Get Test Team");
      expect(res.body.agents.length).toBe(1); // Planner Agent
      expect(res.body.agents[0].type).toBe("planner");
      expect(res.body.members.length).toBe(1); // Manager
    });

    it("should return 404 for non-existent team", async () => {
      const fakeId = new Types.ObjectId().toHexString();
      const res = await request(app).get(`/api/v1/teams/${fakeId}`);

      expect(res.status).toBe(404);
    });
  });

  describe("GET /api/v1/teams", () => {
    it("should list teams by ownerId", async () => {
      // Create two teams
      await request(app).post("/api/v1/teams").send({
        name: "Team A",
        ownerId: "list-user-123",
      });
      await request(app).post("/api/v1/teams").send({
        name: "Team B",
        ownerId: "list-user-123",
      });
      await request(app).post("/api/v1/teams").send({
        name: "Team C",
        ownerId: "other-user",
      });

      const res = await request(app)
        .get("/api/v1/teams")
        .query({ ownerId: "list-user-123" });

      expect(res.status).toBe(200);
      expect(res.body.count).toBe(2);
    });

    it("should return 400 if ownerId is missing", async () => {
      const res = await request(app).get("/api/v1/teams");

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("ownerId query parameter is required");
    });
  });

  describe("DELETE /api/v1/teams/:id", () => {
    it("should delete team and cascade", async () => {
      const createRes = await request(app).post("/api/v1/teams").send({
        name: "Delete Test Team",
        ownerId: "user-delete-123",
      });

      const teamId = createRes.body.team.id;

      const res = await request(app).delete(`/api/v1/teams/${teamId}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("deleted");

      // Verify team is gone
      const getRes = await request(app).get(`/api/v1/teams/${teamId}`);
      expect(getRes.status).toBe(404);
    });
  });

  // ===========================================================================
  // Agent Management Tests
  // ===========================================================================

  describe("POST /api/v1/teams/:id/agents", () => {
    it("should add worker agent", async () => {
      const createRes = await request(app).post("/api/v1/teams").send({
        name: "Agent Test Team",
        ownerId: "user-agent-123",
      });
      const teamId = createRes.body.team.id;

      const res = await request(app)
        .post(`/api/v1/teams/${teamId}/agents`)
        .send({
          name: "Worker Bot",
          role: "engineer",
          yaml: "id: engineer\nname: Worker Bot",
        });

      expect(res.status).toBe(201);
      expect(res.body.agent.name).toBe("Worker Bot");
      expect(res.body.agent.role).toBe("engineer");
      expect(res.body.agent.type).toBe("worker");
    });

    it("should return 409 when adding second planner", async () => {
      const createRes = await request(app).post("/api/v1/teams").send({
        name: "Planner Test Team",
        ownerId: "user-planner-123",
      });
      const teamId = createRes.body.team.id;

      // Try to add another planner (role 'planner' => type 'planner')
      const res = await request(app)
        .post(`/api/v1/teams/${teamId}/agents`)
        .send({
          name: "Second Planner",
          role: "planner",
          yaml: "agent:\n  name: Second Planner\n  role: planner",
        });

      expect(res.status).toBe(409);
    });
  });

  describe("POST /api/v1/teams/:id/agents/:agentId/delegate", () => {
    it("should delegate agent to employee", async () => {
      // Create team
      const createRes = await request(app).post("/api/v1/teams").send({
        name: "Delegate Test Team",
        ownerId: "manager-del-123",
      });
      const teamId = createRes.body.team.id;

      // Add worker
      const agentRes = await request(app)
        .post(`/api/v1/teams/${teamId}/agents`)
        .send({
          name: "Delegate Worker",
          role: "developer",
          yaml: "id: delegate-worker\nname: Delegate Worker",
        });
      const agentId = agentRes.body.agent.id;

      // Add employee
      await request(app).post(`/api/v1/teams/${teamId}/members`).send({
        userId: "employee-del-456",
        role: "employee",
      });

      // Delegate
      const res = await request(app)
        .post(`/api/v1/teams/${teamId}/agents/${agentId}/delegate`)
        .send({ employeeId: "employee-del-456" });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("delegated");
      expect(res.body.agent.delegatedTo).toBe("employee-del-456");
    });
  });

  // ===========================================================================
  // Member Management Tests
  // ===========================================================================

  describe("POST /api/v1/teams/:id/members", () => {
    it("should add employee to team", async () => {
      const createRes = await request(app).post("/api/v1/teams").send({
        name: "Member Test Team",
        ownerId: "manager-mem-123",
      });
      const teamId = createRes.body.team.id;

      const res = await request(app)
        .post(`/api/v1/teams/${teamId}/members`)
        .send({
          userId: "new-employee-456",
          role: "employee",
        });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe("added");
      expect(res.body.userId).toBe("new-employee-456");
    });

    it("should return 409 if already a member", async () => {
      const createRes = await request(app).post("/api/v1/teams").send({
        name: "Duplicate Member Team",
        ownerId: "manager-dup-123",
      });
      const teamId = createRes.body.team.id;

      // Add member first time
      await request(app).post(`/api/v1/teams/${teamId}/members`).send({
        userId: "dup-employee",
        role: "employee",
      });

      // Try to add again
      const res = await request(app)
        .post(`/api/v1/teams/${teamId}/members`)
        .send({
          userId: "dup-employee",
          role: "employee",
        });

      expect(res.status).toBe(409);
    });
  });

  // ===========================================================================
  // Workspace Tests
  // ===========================================================================

  describe("GET /api/v1/teams/:id/workspace", () => {
    it("should return workspace info", async () => {
      const createRes = await request(app).post("/api/v1/teams").send({
        name: "Workspace Test Team",
        ownerId: "user-ws-123",
      });
      const teamId = createRes.body.team.id;

      const res = await request(app).get(`/api/v1/teams/${teamId}/workspace`);

      expect(res.status).toBe(200);
      expect(res.body.workspace.workspaceId).toBeDefined();
      expect(res.body.workspace.folders).toContain("docs");
      expect(res.body.workspace.folders).toContain("code");
    });
  });
});
