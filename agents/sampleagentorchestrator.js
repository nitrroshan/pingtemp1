"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.graph = void 0;
const langgraph_1 = require("@langchain/langgraph");
const state_1 = require("./util/state");
const taskagent_1 = require("./taskManager/taskagent");
const tool_1 = require("./tool");
const routingdecider_1 = require("./routingdecider");
const roleagent_1 = require("./roleManager/roleagent");
// 1. Create the graph
const workflow = new langgraph_1.StateGraph(state_1.AgentState)
    // 2. Add the nodes; these will do the work
    .addNode("TaskAgent", taskagent_1.taskNode) //Task Manager
    .addNode("RoleManagerAgent", roleagent_1.roleManagerNode)
    .addNode("call_tool", tool_1.toolNode);
// 3. Define the edges. We will define both regular and conditional ones
// After a worker completes, report to supervisor
workflow.addConditionalEdges("TaskAgent", routingdecider_1.router, {
    // We will transition to the other agent
    continue: "RoleManagerAgent",
    call_tool: "call_tool",
    end: langgraph_1.END,
});
workflow.addConditionalEdges("RoleManagerAgent", routingdecider_1.router, {
    // We will transition to the other agent
    continue: "TaskAgent",
    call_tool: "call_tool",
    end: langgraph_1.END,
});
workflow.addConditionalEdges("call_tool", 
// Each agent node updates the 'sender' field
// the tool calling node does not, meaning
// this edge will route back to the original agent
// who invoked the tool
(x) => x.sender, {
    TaskAgent: "TaskAgent",
    RoleManagerAgent: "RoleManagerAgent",
});
workflow.addEdge(langgraph_1.START, "TaskAgent");
exports.graph = workflow.compile();
