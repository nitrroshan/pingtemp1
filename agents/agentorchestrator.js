"use strict";
//Agent Registration & Discovery
//Lifecycle Management – Start, stop, pause, and resume agents as needed.
Object.defineProperty(exports, "__esModule", { value: true });
const agents_1 = require("../utils/agents");
const logger_1 = require("../utils/logger"); // Assuming a logger utility exists
// class Method {
//   url: string;
//   feature: Feature;
//   constructor(url: string, feature: Feature) {
//     this.url = url;
//     this.feature = feature;
//   }
// }
// class RoleAgent {
//   roleName: string;
//   roleDescription: string;
//   methods: Method[];
//   constructor(roleName: string, roleDescription: string, methods: Method[]) {
//     this.roleName = roleName;
//     this.roleDescription = roleDescription;
//     this.methods = methods;
//   }
// }
class Role {
    constructor(roleName, roleDescription, features) {
        this.roleName = roleName;
        this.roleDescription = roleDescription;
        this.features = features;
    }
}
/*AgentResource
 Agent as a resource to work on the given role and have required functionalities
*/
class AgentResource {
    constructor(role, agent) {
        this.agent = agent;
        this.role = role;
    }
    assign(agent) {
        this.agent = agent;
        logger_1.Logger.info(`Assigning agent ${this.agent.name} to role ${this.role.roleName}`);
    }
}
const searchAgents = (features) => {
    logger_1.Logger.info(`Searching agents for features: ${JSON.stringify(features)}`);
    const agentsWithMaxFeatures = new Map();
    for (const agent of agents_1.agentDb) {
        for (const feature of features) {
            if (agent.features.includes(feature)) {
                agentsWithMaxFeatures.set(agent, (agentsWithMaxFeatures.get(agent) || 0) + 1);
            }
        }
    }
    return Array.from(agentsWithMaxFeatures.entries()).reduce((prev, curr) => {
        if (curr[1] > prev[1]) {
            return curr;
        }
        return prev;
    })[0];
};
const findAgent = (role) => {
    // Find an agent based on role and tasks
    //search for agent which has the required functionalities
    let requiredFeatures = [...role.features];
    const agent = searchAgents(requiredFeatures);
    return agent;
};
/*
orchestrateTask: Find the right agent to do the task or break it to multiple tasks and then find right agents
Input:
Task : string
Output


Group of Agents with Assigned Roles and task
*/
const orchestrateTask = (task) => {
    try {
        logger_1.Logger.info(`Starting task orchestration for: ${task}`);
        // Step 0: Parse the task into action tasks
        const actionTasks = taskToActionTasks(task);
        // Step 1: Map the  subtasks to  required features
        const requiredFeatures = taskToFeatureMapper(actionTasks);
        logger_1.Logger.info(`Parsed features: ${JSON.stringify(requiredFeatures)}`);
        // Step 2: Group features into roles
        const roles = groupFeaturesIntoRoles(requiredFeatures);
        logger_1.Logger.info(`Grouped roles: ${JSON.stringify(roles)}`);
        // Step 3: Find agents for each role
        const agentsWithRoles = roles.map((role) => {
            const agentResource = new AgentResource(role);
            const agent = findAgent(role);
            if (!agent) {
                logger_1.Logger.error(`No agent found for role: ${role.roleName}`);
                throw new Error(`No agent available for role: ${role.roleName}`);
            }
            else {
                agentResource.assign(agent);
                logger_1.Logger.info(`Assigned agent ${agent.name} to role ${role.roleName} with features: ${JSON.stringify(role.features)}`);
            }
            return AgentResource;
        });
        // Step 4: Return the group of agents with their assigned roles and tasks
        logger_1.Logger.info(`Task orchestration completed successfully.`);
        return agentsWithRoles;
    }
    catch (error) {
        logger_1.Logger.error(`Error during task orchestration: ${error.message}`);
        throw error;
    }
};
/*
Action Task are tasks that take an input and convert it to an output
Example:
Main Task:
  Desc:
  Input:
  RequiredOutput:
Action Task1:
  Desc:
  Input1: Input
  Output1:
Action Task2:
  Desc:
  Input2: Output1
  Output2:
Action Task3:
  Desc:
  Input3: Output1
  Output3:
Action Task4:
  Desc:
  Input4: Output2,Output4
  Output: ActualOutput
ActualOutput ~ RequiredOutput
*/
const taskToActionTasks = (task) => {
    logger_1.Logger.info(`Mapping task to actions: ${task}`);
    return [];
};
/*
This function defines features required by agent to do the task
*/
const taskToFeatureMapper = (task) => {
    // Placeholder for task to feature mapping logic
    // This could be a simple mapping or a more complex NLP-based approach
    logger_1.Logger.info(`Mapping task to features: ${task}`);
    return [];
};
// Helper function to group features into roles
const groupFeaturesIntoRoles = (features) => {
    // Enhanced implementation: Use dynamic logic or predefined mappings
    logger_1.Logger.info(`Grouping features into roles: ${JSON.stringify(features)}`);
    // Placeholder logic
    return [];
};
