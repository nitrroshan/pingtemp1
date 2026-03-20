/**
 * Swagger/OpenAPI Configuration for Team Service API
 */

import swaggerJsdoc from "swagger-jsdoc";

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Team Service API",
      version: "1.0.0",
      description: `
REST API for managing teams, agents, members, and skills.

## Features
- **Team Management**: Create, read, update, delete teams
- **Agent Management**: Add/remove agents, delegate to employees, manage skills
- **Member Management**: Add/remove team members
- **Workspace**: Access team workspace information

## Authentication
Currently no authentication required (development mode).
      `,
      contact: {
        name: "API Support",
      },
    },
    servers: [
      {
        url: "/api/v1",
        description: "API v1",
      },
    ],
    paths: {
      "/teams": {
        post: {
          summary: "Create a new team",
          description:
            "Creates a team with a Planner Agent and adds owner as manager",
          tags: ["Teams"],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CreateTeamRequest" },
              },
            },
          },
          responses: {
            "201": {
              description: "Team created successfully",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      status: { type: "string", example: "created" },
                      team: { $ref: "#/components/schemas/Team" },
                    },
                  },
                },
              },
            },
            "400": { description: "Missing required fields" },
          },
        },
        get: {
          summary: "List teams",
          description: "List all teams for an owner",
          tags: ["Teams"],
          parameters: [
            {
              in: "query",
              name: "ownerId",
              required: true,
              schema: { type: "string" },
              description: "Owner user ID to filter by",
            },
          ],
          responses: {
            "200": {
              description: "List of teams",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      teams: {
                        type: "array",
                        items: { $ref: "#/components/schemas/Team" },
                      },
                      count: { type: "integer" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/teams/{id}": {
        get: {
          summary: "Get team by ID",
          tags: ["Teams"],
          parameters: [
            {
              in: "path",
              name: "id",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": { description: "Team details" },
            "404": { description: "Team not found" },
          },
        },
        put: {
          summary: "Update team",
          tags: ["Teams"],
          parameters: [
            {
              in: "path",
              name: "id",
              required: true,
              schema: { type: "string" },
            },
          ],
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    description: { type: "string" },
                  },
                },
              },
            },
          },
          responses: { "200": { description: "Team updated" } },
        },
        delete: {
          summary: "Delete team",
          tags: ["Teams"],
          parameters: [
            {
              in: "path",
              name: "id",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: { "200": { description: "Team deleted" } },
        },
      },
      "/teams/{id}/agents": {
        post: {
          summary: "Add agent to team",
          tags: ["Agents"],
          parameters: [
            {
              in: "path",
              name: "id",
              required: true,
              schema: { type: "string" },
            },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/AddAgentRequest" },
              },
            },
          },
          responses: {
            "201": { description: "Agent created" },
            "409": { description: "Cannot add second planner" },
          },
        },
      },
      "/teams/{id}/agents/{agentId}": {
        delete: {
          summary: "Remove agent from team",
          tags: ["Agents"],
          parameters: [
            {
              in: "path",
              name: "id",
              required: true,
              schema: { type: "string" },
            },
            {
              in: "path",
              name: "agentId",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: { "200": { description: "Agent removed" } },
        },
      },
      "/teams/{id}/agents/{agentId}/delegate": {
        post: {
          summary: "Delegate agent to employee",
          tags: ["Agents"],
          parameters: [
            {
              in: "path",
              name: "id",
              required: true,
              schema: { type: "string" },
            },
            {
              in: "path",
              name: "agentId",
              required: true,
              schema: { type: "string" },
            },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/DelegateAgentRequest" },
              },
            },
          },
          responses: { "200": { description: "Agent delegated" } },
        },
      },
      "/teams/{id}/agents/{agentId}/reclaim": {
        post: {
          summary: "Reclaim delegated agent",
          tags: ["Agents"],
          parameters: [
            {
              in: "path",
              name: "id",
              required: true,
              schema: { type: "string" },
            },
            {
              in: "path",
              name: "agentId",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: { "200": { description: "Agent reclaimed" } },
        },
      },
      "/teams/{id}/agents/{agentId}/status": {
        put: {
          summary: "Update agent status",
          tags: ["Agents"],
          parameters: [
            {
              in: "path",
              name: "id",
              required: true,
              schema: { type: "string" },
            },
            {
              in: "path",
              name: "agentId",
              required: true,
              schema: { type: "string" },
            },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/UpdateAgentStatusRequest",
                },
              },
            },
          },
          responses: { "200": { description: "Status updated" } },
        },
      },
      "/teams/{id}/agents/{agentId}/skills": {
        get: {
          summary: "Get agent skills",
          tags: ["Skills"],
          parameters: [
            {
              in: "path",
              name: "id",
              required: true,
              schema: { type: "string" },
            },
            {
              in: "path",
              name: "agentId",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: { "200": { description: "List of skills" } },
        },
        post: {
          summary: "Assign skill to agent",
          tags: ["Skills"],
          parameters: [
            {
              in: "path",
              name: "id",
              required: true,
              schema: { type: "string" },
            },
            {
              in: "path",
              name: "agentId",
              required: true,
              schema: { type: "string" },
            },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["skillId"],
                  properties: { skillId: { type: "string" } },
                },
              },
            },
          },
          responses: { "201": { description: "Skill assigned" } },
        },
      },
      "/teams/{id}/agents/{agentId}/skills/{skillId}": {
        delete: {
          summary: "Remove skill from agent",
          tags: ["Skills"],
          parameters: [
            {
              in: "path",
              name: "id",
              required: true,
              schema: { type: "string" },
            },
            {
              in: "path",
              name: "agentId",
              required: true,
              schema: { type: "string" },
            },
            {
              in: "path",
              name: "skillId",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: { "200": { description: "Skill removed" } },
        },
        put: {
          summary: "Enable/disable skill",
          tags: ["Skills"],
          parameters: [
            {
              in: "path",
              name: "id",
              required: true,
              schema: { type: "string" },
            },
            {
              in: "path",
              name: "agentId",
              required: true,
              schema: { type: "string" },
            },
            {
              in: "path",
              name: "skillId",
              required: true,
              schema: { type: "string" },
            },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["enabled"],
                  properties: { enabled: { type: "boolean" } },
                },
              },
            },
          },
          responses: { "200": { description: "Skill updated" } },
        },
      },
      "/teams/{id}/members": {
        get: {
          summary: "Get team members",
          tags: ["Members"],
          parameters: [
            {
              in: "path",
              name: "id",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: { "200": { description: "List of members" } },
        },
        post: {
          summary: "Add member to team",
          tags: ["Members"],
          parameters: [
            {
              in: "path",
              name: "id",
              required: true,
              schema: { type: "string" },
            },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/AddMemberRequest" },
              },
            },
          },
          responses: {
            "201": { description: "Member added" },
            "409": { description: "Member already exists" },
          },
        },
      },
      "/teams/{id}/members/{userId}": {
        delete: {
          summary: "Remove member from team",
          tags: ["Members"],
          parameters: [
            {
              in: "path",
              name: "id",
              required: true,
              schema: { type: "string" },
            },
            {
              in: "path",
              name: "userId",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": { description: "Member removed" },
            "409": { description: "Cannot remove manager" },
          },
        },
      },
      "/teams/{id}/workspace": {
        get: {
          summary: "Get workspace info",
          tags: ["Workspace"],
          parameters: [
            {
              in: "path",
              name: "id",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: { "200": { description: "Workspace info" } },
        },
      },
    },
    tags: [
      {
        name: "Teams",
        description: "Team CRUD operations",
      },
      {
        name: "Agents",
        description: "Agent management within teams",
      },
      {
        name: "Skills",
        description: "Agent skill management",
      },
      {
        name: "Members",
        description: "Team member management",
      },
      {
        name: "Workspace",
        description: "Team workspace operations",
      },
    ],
    components: {
      schemas: {
        Team: {
          type: "object",
          properties: {
            id: { type: "string", description: "Team ID" },
            name: { type: "string", description: "Team name" },
            description: { type: "string", description: "Team description" },
            ownerId: { type: "string", description: "Owner user ID" },
            workspaceId: { type: "string", description: "Workspace ID" },
            settings: { $ref: "#/components/schemas/TeamSettings" },
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" },
          },
        },
        TeamSettings: {
          type: "object",
          properties: {
            executionMode: {
              type: "string",
              enum: ["sequential", "parallel", "hybrid"],
              default: "sequential",
            },
            maxConcurrency: { type: "integer", default: 3 },
          },
        },
        Agent: {
          type: "object",
          properties: {
            id: { type: "string", description: "Agent ID" },
            teamId: { type: "string", description: "Team ID" },
            name: { type: "string", description: "Agent name" },
            role: { type: "string", description: "Agent role" },
            type: {
              type: "string",
              enum: ["planner", "worker"],
              description: "Agent type",
            },
            status: {
              type: "string",
              enum: ["pending", "running", "stopped", "error"],
            },
            delegatedTo: {
              type: "string",
              nullable: true,
              description: "Employee ID if delegated",
            },
          },
        },
        Member: {
          type: "object",
          properties: {
            userId: { type: "string", description: "User ID" },
            role: {
              type: "string",
              enum: ["manager", "employee"],
              description: "Member role",
            },
            joinedAt: { type: "string", format: "date-time" },
          },
        },
        Skill: {
          type: "object",
          properties: {
            skillId: { type: "string", description: "Skill ID" },
            enabled: {
              type: "boolean",
              description: "Whether skill is enabled",
            },
            assignedAt: { type: "string", format: "date-time" },
          },
        },
        Workspace: {
          type: "object",
          properties: {
            id: { type: "string" },
            path: { type: "string" },
            gitUrl: { type: "string", nullable: true },
          },
        },
        Error: {
          type: "object",
          properties: {
            error: { type: "string", description: "Error message" },
            timestamp: { type: "integer", description: "Unix timestamp" },
          },
        },
        CreateTeamRequest: {
          type: "object",
          required: ["name", "ownerId"],
          properties: {
            name: { type: "string", description: "Team name" },
            ownerId: { type: "string", description: "Owner user ID" },
            description: { type: "string", description: "Team description" },
            settings: { $ref: "#/components/schemas/TeamSettings" },
          },
        },
        AddAgentRequest: {
          type: "object",
          required: ["name", "role", "yaml"],
          properties: {
            name: { type: "string", description: "Agent name" },
            role: { type: "string", description: "Agent role" },
            yaml: { type: "string", description: "Agent YAML definition" },
            skills: {
              type: "array",
              items: { type: "string" },
              description: "Initial skill IDs to assign",
            },
          },
        },
        DelegateAgentRequest: {
          type: "object",
          required: ["employeeId"],
          properties: {
            employeeId: {
              type: "string",
              description: "Employee user ID to delegate to",
            },
          },
        },
        AddMemberRequest: {
          type: "object",
          required: ["userId"],
          properties: {
            userId: { type: "string", description: "User ID to add" },
            role: {
              type: "string",
              enum: ["employee"],
              default: "employee",
              description: "Member role",
            },
          },
        },
        UpdateAgentStatusRequest: {
          type: "object",
          required: ["status"],
          properties: {
            status: {
              type: "string",
              enum: ["pending", "running", "stopped", "error"],
            },
            errorMessage: {
              type: "string",
              description: "Error message if status is error",
            },
          },
        },
      },
    },
  },
  apis: [], // Paths defined inline above
};

export const swaggerSpec = swaggerJsdoc(options);
