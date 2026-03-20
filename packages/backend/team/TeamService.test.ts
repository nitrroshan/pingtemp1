/**
 * TeamService Unit Tests (Mongoose version)
 *
 * Tests business logic with mocked Mongoose models.
 */

import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Types } from "mongoose";

// Mock Mongoose models before importing TeamService
mock.module("./models.js", () => {
  interface MockDoc {
    _id: Types.ObjectId;
    save?: ReturnType<typeof vi.fn>;
    [key: string]: unknown;
  }

  type QueryFilter = Record<string, unknown>;
  type UpdateDoc = { $set?: Record<string, unknown> };

  const createMockModel = () => {
    let store: MockDoc[] = [];

    const Model = mock().mockImplementation((data: Partial<MockDoc>) => {
      const doc: MockDoc = {
        ...data,
        _id: (data._id as Types.ObjectId) || new Types.ObjectId(),
        save: mock().mockResolvedValue(undefined),
        toObject: mock().mockReturnThis(),
      };
      return doc;
    }) as any;

    Model._store = store;
    Model.resetStore = () => {
      store = [];
      Model._store = store;
    };

    Model.create = mock(async (data: Partial<MockDoc>): Promise<MockDoc> => {
      const doc: MockDoc = {
        ...data,
        _id: (data._id as Types.ObjectId) || new Types.ObjectId(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      // Add save that captures doc reference
      const savedDoc = doc;
      savedDoc.save = mock(async () => {
        const idx = store.findIndex((d) => d._id.equals(savedDoc._id));
        if (idx >= 0) store[idx] = savedDoc;
        return savedDoc;
      });
      store.push(savedDoc);
      return savedDoc;
    });

    Model.findById = mock(
      async (id: string | Types.ObjectId): Promise<MockDoc | null> => {
        const oid = typeof id === "string" ? new Types.ObjectId(id) : id;
        const found = store.find((d) => d._id.equals(oid));
        if (found) {
          const foundDoc = found;
          foundDoc.save = mock(async () => {
            const idx = store.findIndex((d) => d._id.equals(foundDoc._id));
            if (idx >= 0) store[idx] = foundDoc;
            return foundDoc;
          });
        }
        return found || null;
      },
    );

    Model.findOne = mock(
      async (query: QueryFilter): Promise<MockDoc | null> => {
        const found = store.find((d) => matchQuery(d, query));
        if (found) {
          const foundDoc = found;
          foundDoc.save = mock(async () => {
            const idx = store.findIndex((doc) => doc._id.equals(foundDoc._id));
            if (idx >= 0) store[idx] = foundDoc;
            return foundDoc;
          });
        }
        return found || null;
      },
    );

    Model.find = mock((query: QueryFilter = {}) => {
      const results = store.filter((d) => matchQuery(d, query));
      return {
        sort: mock().mockReturnValue(Promise.resolve(results)),
        exec: mock().mockResolvedValue(results),
        then: (fn: (results: MockDoc[]) => unknown) =>
          Promise.resolve(results).then(fn),
      };
    });

    Model.deleteOne = mock(async (query: QueryFilter) => {
      const idx = store.findIndex((d) => matchQuery(d, query));
      if (idx >= 0) {
        store.splice(idx, 1);
        return { deletedCount: 1 };
      }
      return { deletedCount: 0 };
    });

    Model.deleteMany = mock(async (query: QueryFilter) => {
      const toDelete = store.filter((d) => matchQuery(d, query));
      toDelete.forEach((doc) => {
        const idx = store.indexOf(doc);
        if (idx >= 0) store.splice(idx, 1);
      });
      return { deletedCount: toDelete.length };
    });

    Model.updateOne = mock(async (query: QueryFilter, update: UpdateDoc) => {
      const doc = store.find((d) => matchQuery(d, query));
      if (doc && update.$set) {
        Object.assign(doc, update.$set);
        return { matchedCount: 1, modifiedCount: 1 };
      }
      return { matchedCount: 0, modifiedCount: 0 };
    });

    Model.updateMany = mock(async (query: QueryFilter, update: UpdateDoc) => {
      const docs = store.filter((d) => matchQuery(d, query));
      docs.forEach((doc) => {
        if (update.$set) Object.assign(doc, update.$set);
      });
      return { matchedCount: docs.length, modifiedCount: docs.length };
    });

    Model.countDocuments = mock(async (query: QueryFilter = {}) => {
      return store.filter((d) => matchQuery(d, query)).length;
    });

    return Model;
  };

  function matchQuery(doc: MockDoc, query: QueryFilter): boolean {
    for (const [key, value] of Object.entries(query)) {
      if (key === "$in") continue;

      const docValue = doc[key];

      // Handle ObjectId comparison
      if (value instanceof Types.ObjectId) {
        if (
          !docValue ||
          !(value as Types.ObjectId).equals(docValue as Types.ObjectId)
        )
          return false;
      }
      // Handle $in operator
      else if (value && typeof value === "object" && "$in" in value) {
        const inValues = (value as { $in: unknown[] }).$in;
        if (
          !inValues.some((v: unknown) => {
            if (
              v instanceof Types.ObjectId &&
              docValue instanceof Types.ObjectId
            ) {
              return v.equals(docValue);
            }
            return v === docValue;
          })
        )
          return false;
      }
      // Handle $regex
      else if (value && typeof value === "object" && "$regex" in value) {
        const regexVal = value as { $regex: string; $options?: string };
        const regex = new RegExp(regexVal.$regex, regexVal.$options);
        if (!regex.test(String(docValue))) return false;
      }
      // Simple equality
      else if (docValue !== value) {
        return false;
      }
    }
    return true;
  }

  return {
    TeamModel: createMockModel(),
    AgentModel: createMockModel(),
    TeamMemberModel: createMockModel(),
    AgentSkillModel: createMockModel(),
  };
});

// Import after mocking
import { TeamService } from "./TeamService.js";
import {
  TeamModel,
  AgentModel,
  TeamMemberModel,
  AgentSkillModel,
} from "./models.js";
import {
  TeamNotFoundError,
  TeamNameRequiredError,
  CannotAddSecondPlannerError,
  CannotDelegatePlannerError,
  CannotRemovePlannerError,
  AgentAlreadyDelegatedError,
  AgentNotDelegatedError,
  MemberAlreadyExistsError,
  CannotRemoveManagerError,
  SkillAlreadyAssignedError,
} from "./errors.js";

// =============================================================================
// Tests
// =============================================================================

describe("TeamService (Mongoose)", () => {
  let teamService: TeamService;

  beforeEach(() => {
    // Reset all mock stores
    (TeamModel as any).resetStore();
    (AgentModel as any).resetStore();
    (TeamMemberModel as any).resetStore();
    (AgentSkillModel as any).resetStore();

    teamService = new TeamService();
  });

  // ===========================================================================
  // Team CRUD Tests
  // ===========================================================================

  describe("createTeam", () => {
    it("should create a team with auto Planner Agent", async () => {
      const team = await teamService.createTeam({
        name: "Mobile Team",
        ownerId: "user-123",
      });

      expect(team.name).toBe("Mobile Team");
      expect(team.ownerId).toBe("user-123");
      expect(team.workspaceId).toContain("workspace-");
      expect(team.settings.executionMode).toBe("parallel");

      // Check Planner Agent was created
      const agents = (AgentModel as any)._store;
      expect(agents.length).toBe(1);
      expect(agents[0].type).toBe("planner");
      expect(agents[0].role).toBe("planner");

      // Check owner added as manager
      const members = (TeamMemberModel as any)._store;
      expect(members.length).toBe(1);
      expect(members[0].role).toBe("manager");
    });

    it("should throw if team name is empty", async () => {
      await expect(
        teamService.createTeam({
          name: "",
          ownerId: "user-123",
        }),
      ).rejects.toThrow(TeamNameRequiredError);
    });

    it("should apply custom settings", async () => {
      const team = await teamService.createTeam({
        name: "Sequential Team",
        ownerId: "user-123",
        settings: { executionMode: "sequential", maxConcurrency: 1 },
      });

      expect(team.settings.executionMode).toBe("sequential");
      expect(team.settings.maxConcurrency).toBe(1);
    });
  });

  describe("getTeam", () => {
    it("should return team with agents and members", async () => {
      const created = await teamService.createTeam({
        name: "Test Team",
        ownerId: "user-123",
      });

      const team = await teamService.getTeam(created._id.toHexString());

      expect(team.name).toBe("Test Team");
      expect(team.agents.length).toBe(1); // Planner
      expect(team.members.length).toBe(1); // Manager
    });

    it("should throw if team not found", async () => {
      const fakeId = new Types.ObjectId().toHexString();
      await expect(teamService.getTeam(fakeId)).rejects.toThrow(
        TeamNotFoundError,
      );
    });
  });

  describe("listTeams", () => {
    it("should filter by ownerId", async () => {
      await teamService.createTeam({ name: "Team A", ownerId: "user-1" });
      await teamService.createTeam({ name: "Team B", ownerId: "user-2" });
      await teamService.createTeam({ name: "Team C", ownerId: "user-1" });

      const teams = await teamService.listTeams({ ownerId: "user-1" });
      expect(teams.length).toBe(2);
    });
  });

  describe("deleteTeam", () => {
    it("should cascade delete agents, members, and skills", async () => {
      const team = await teamService.createTeam({
        name: "Delete Me",
        ownerId: "user-123",
      });

      await teamService.deleteTeam(team._id.toHexString());

      expect((TeamModel as any)._store.length).toBe(0);
      expect((AgentModel as any)._store.length).toBe(0);
      expect((TeamMemberModel as any)._store.length).toBe(0);
    });
  });

  // ===========================================================================
  // Agent Management Tests
  // ===========================================================================

  describe("addAgent", () => {
    it("should add a worker agent", async () => {
      const team = await teamService.createTeam({
        name: "Test Team",
        ownerId: "user-123",
      });

      const agent = await teamService.addAgent(team._id.toHexString(), {
        name: "Security Specialist",
        role: "security",
        yaml: "id: security\nname: Security",
      });

      expect(agent.type).toBe("worker");
      expect(agent.role).toBe("security");
      expect(agent.status).toBe("pending");
      expect(agent.delegatedTo).toBeNull();
    });

    it("should throw if adding second planner", async () => {
      const team = await teamService.createTeam({
        name: "Test Team",
        ownerId: "user-123",
      });

      await expect(
        teamService.addAgent(team._id.toHexString(), {
          name: "Another Planner",
          role: "planner",
          yaml: "id: planner2",
        }),
      ).rejects.toThrow(CannotAddSecondPlannerError);
    });

    it("should assign skills when provided", async () => {
      const team = await teamService.createTeam({
        name: "Test Team",
        ownerId: "user-123",
      });

      await teamService.addAgent(team._id.toHexString(), {
        name: "Engineer",
        role: "engineer",
        yaml: "id: engineer",
        skillIds: ["skill-1", "skill-2"],
      });

      const skills = (AgentSkillModel as any)._store;
      expect(skills.length).toBe(2);
    });
  });

  describe("removeAgent", () => {
    it("should remove a worker agent", async () => {
      const team = await teamService.createTeam({
        name: "Test Team",
        ownerId: "user-123",
      });

      const agent = await teamService.addAgent(team._id.toHexString(), {
        name: "Worker",
        role: "worker",
        yaml: "id: worker",
      });

      await teamService.removeAgent(
        team._id.toHexString(),
        agent._id.toHexString(),
      );

      // Should only have Planner left
      const agents = (AgentModel as any)._store;
      expect(agents.length).toBe(1);
      expect(agents[0].type).toBe("planner");
    });

    it("should throw if removing Planner", async () => {
      const team = await teamService.createTeam({
        name: "Test Team",
        ownerId: "user-123",
      });

      const planner = (AgentModel as any)._store[0];

      await expect(
        teamService.removeAgent(
          team._id.toHexString(),
          planner._id.toHexString(),
        ),
      ).rejects.toThrow(CannotRemovePlannerError);
    });
  });

  describe("delegateAgent", () => {
    it("should delegate worker to employee", async () => {
      const team = await teamService.createTeam({
        name: "Test Team",
        ownerId: "manager-1",
      });

      await teamService.addMember(
        team._id.toHexString(),
        "employee-1",
        "employee",
      );

      const worker = await teamService.addAgent(team._id.toHexString(), {
        name: "Worker",
        role: "worker",
        yaml: "id: worker",
      });

      const delegated = await teamService.delegateAgent(
        team._id.toHexString(),
        worker._id.toHexString(),
        "employee-1",
      );

      expect(delegated.delegatedTo).toBe("employee-1");
    });

    it("should throw if delegating Planner", async () => {
      const team = await teamService.createTeam({
        name: "Test Team",
        ownerId: "manager-1",
      });

      await teamService.addMember(
        team._id.toHexString(),
        "employee-1",
        "employee",
      );

      const planner = (AgentModel as any)._store[0];

      await expect(
        teamService.delegateAgent(
          team._id.toHexString(),
          planner._id.toHexString(),
          "employee-1",
        ),
      ).rejects.toThrow(CannotDelegatePlannerError);
    });

    it("should throw if already delegated", async () => {
      const team = await teamService.createTeam({
        name: "Test Team",
        ownerId: "manager-1",
      });

      await teamService.addMember(
        team._id.toHexString(),
        "employee-1",
        "employee",
      );
      await teamService.addMember(
        team._id.toHexString(),
        "employee-2",
        "employee",
      );

      const worker = await teamService.addAgent(team._id.toHexString(), {
        name: "Worker",
        role: "worker",
        yaml: "id: worker",
      });

      await teamService.delegateAgent(
        team._id.toHexString(),
        worker._id.toHexString(),
        "employee-1",
      );

      await expect(
        teamService.delegateAgent(
          team._id.toHexString(),
          worker._id.toHexString(),
          "employee-2",
        ),
      ).rejects.toThrow(AgentAlreadyDelegatedError);
    });
  });

  describe("reclaimAgent", () => {
    it("should reclaim delegated agent", async () => {
      const team = await teamService.createTeam({
        name: "Test Team",
        ownerId: "manager-1",
      });

      await teamService.addMember(
        team._id.toHexString(),
        "employee-1",
        "employee",
      );

      const worker = await teamService.addAgent(team._id.toHexString(), {
        name: "Worker",
        role: "worker",
        yaml: "id: worker",
      });

      await teamService.delegateAgent(
        team._id.toHexString(),
        worker._id.toHexString(),
        "employee-1",
      );
      const reclaimed = await teamService.reclaimAgent(
        team._id.toHexString(),
        worker._id.toHexString(),
      );

      expect(reclaimed.delegatedTo).toBeNull();
    });

    it("should throw if not delegated", async () => {
      const team = await teamService.createTeam({
        name: "Test Team",
        ownerId: "manager-1",
      });

      const worker = await teamService.addAgent(team._id.toHexString(), {
        name: "Worker",
        role: "worker",
        yaml: "id: worker",
      });

      await expect(
        teamService.reclaimAgent(
          team._id.toHexString(),
          worker._id.toHexString(),
        ),
      ).rejects.toThrow(AgentNotDelegatedError);
    });
  });

  describe("updateAgentStatus", () => {
    it("should update agent status", async () => {
      const team = await teamService.createTeam({
        name: "Test Team",
        ownerId: "user-123",
      });

      const planner = (AgentModel as any)._store[0];

      const updated = await teamService.updateAgentStatus(
        planner._id.toHexString(),
        {
          status: "running",
          lastStartedAt: new Date(),
        },
      );

      expect(updated.status).toBe("running");
      expect(updated.lastStartedAt).toBeDefined();
    });

    it("should update error message", async () => {
      const team = await teamService.createTeam({
        name: "Test Team",
        ownerId: "user-123",
      });

      const planner = (AgentModel as any)._store[0];

      const updated = await teamService.updateAgentStatus(
        planner._id.toHexString(),
        {
          status: "error",
          errorMessage: "Failed to initialize",
        },
      );

      expect(updated.status).toBe("error");
      expect(updated.errorMessage).toBe("Failed to initialize");
    });
  });

  // ===========================================================================
  // Skill Management Tests
  // ===========================================================================

  describe("assignSkillToAgent", () => {
    it("should assign skill to agent", async () => {
      const team = await teamService.createTeam({
        name: "Test Team",
        ownerId: "user-123",
      });

      const agent = await teamService.addAgent(team._id.toHexString(), {
        name: "Worker",
        role: "worker",
        yaml: "id: worker",
      });

      await teamService.assignSkillToAgent(
        agent._id.toHexString(),
        "security-review",
      );

      const skills = await teamService.getAgentSkills(agent._id.toHexString());
      expect(skills.length).toBe(1);
      expect(skills[0]!.skillId).toBe("security-review");
      expect(skills[0]!.enabled).toBe(true);
    });

    it("should throw if skill already assigned", async () => {
      const team = await teamService.createTeam({
        name: "Test Team",
        ownerId: "user-123",
      });

      const agent = await teamService.addAgent(team._id.toHexString(), {
        name: "Worker",
        role: "worker",
        yaml: "id: worker",
      });

      await teamService.assignSkillToAgent(
        agent._id.toHexString(),
        "security-review",
      );

      await expect(
        teamService.assignSkillToAgent(
          agent._id.toHexString(),
          "security-review",
        ),
      ).rejects.toThrow(SkillAlreadyAssignedError);
    });
  });

  describe("setSkillEnabled", () => {
    it("should enable/disable skill", async () => {
      const team = await teamService.createTeam({
        name: "Test Team",
        ownerId: "user-123",
      });

      const agent = await teamService.addAgent(team._id.toHexString(), {
        name: "Worker",
        role: "worker",
        yaml: "id: worker",
      });

      await teamService.assignSkillToAgent(
        agent._id.toHexString(),
        "security-review",
      );
      await teamService.setSkillEnabled(
        agent._id.toHexString(),
        "security-review",
        false,
      );

      const skills = await teamService.getAgentSkills(agent._id.toHexString());
      expect(skills[0]!.enabled).toBe(false);
    });
  });

  // ===========================================================================
  // Member Management Tests
  // ===========================================================================

  describe("addMember", () => {
    it("should add employee to team", async () => {
      const team = await teamService.createTeam({
        name: "Test Team",
        ownerId: "manager-1",
      });

      await teamService.addMember(
        team._id.toHexString(),
        "employee-1",
        "employee",
      );

      const members = await teamService.getTeamMembers(team._id.toHexString());
      expect(members.length).toBe(2); // manager + employee
    });

    it("should throw if already a member", async () => {
      const team = await teamService.createTeam({
        name: "Test Team",
        ownerId: "manager-1",
      });

      await teamService.addMember(
        team._id.toHexString(),
        "employee-1",
        "employee",
      );

      await expect(
        teamService.addMember(team._id.toHexString(), "employee-1", "employee"),
      ).rejects.toThrow(MemberAlreadyExistsError);
    });
  });

  describe("removeMember", () => {
    it("should remove employee and reclaim delegated agents", async () => {
      const team = await teamService.createTeam({
        name: "Test Team",
        ownerId: "manager-1",
      });

      await teamService.addMember(
        team._id.toHexString(),
        "employee-1",
        "employee",
      );

      const worker = await teamService.addAgent(team._id.toHexString(), {
        name: "Worker",
        role: "worker",
        yaml: "id: worker",
      });

      await teamService.delegateAgent(
        team._id.toHexString(),
        worker._id.toHexString(),
        "employee-1",
      );
      await teamService.removeMember(team._id.toHexString(), "employee-1");

      // Agent should be reclaimed
      const agents = (AgentModel as any)._store;
      const updatedWorker = agents.find((a: any) => a._id.equals(worker._id));
      expect(updatedWorker?.delegatedTo).toBeNull();

      // Member should be removed
      const members = await teamService.getTeamMembers(team._id.toHexString());
      expect(members.length).toBe(1); // only manager
    });

    it("should throw if removing manager", async () => {
      const team = await teamService.createTeam({
        name: "Test Team",
        ownerId: "manager-1",
      });

      await expect(
        teamService.removeMember(team._id.toHexString(), "manager-1"),
      ).rejects.toThrow(CannotRemoveManagerError);
    });
  });

  // ===========================================================================
  // Workspace Tests
  // ===========================================================================

  describe("getWorkspace", () => {
    it("should return workspace info", async () => {
      const team = await teamService.createTeam({
        name: "Test Team",
        ownerId: "user-123",
      });

      const workspace = await teamService.getWorkspace(team._id.toHexString());

      expect(workspace.workspaceId).toBe(team.workspaceId);
      expect(workspace.folders).toContain("docs");
      expect(workspace.folders).toContain("code");
    });
  });
});
