import { END, START, StateGraph } from "@langchain/langgraph";
import { AgentState } from "./util/state";
import { taskNode } from "./taskManager/taskagent";
import { toolNode } from "./tool";
import { router } from "./routingdecider";
import { roleManagerNode } from "./roleManager/roleagent";



// 1. Create the graph
const workflow = new StateGraph(AgentState)
  // 2. Add the nodes; these will do the work
  .addNode("TaskAgent", taskNode) //Task Manager
  .addNode("RoleManagerAgent", roleManagerNode)
  .addNode("call_tool", toolNode);


// 3. Define the edges. We will define both regular and conditional ones
// After a worker completes, report to supervisor
workflow.addConditionalEdges("TaskAgent", router, {
  // We will transition to the other agent
  continue: "RoleManagerAgent",
  call_tool: "call_tool",
  end: END,
});

workflow.addConditionalEdges("RoleManagerAgent", router, {
  // We will transition to the other agent
  continue: "TaskAgent",
  call_tool: "call_tool",
  end: END,
});

workflow.addConditionalEdges(
  "call_tool",
  // Each agent node updates the 'sender' field
  // the tool calling node does not, meaning
  // this edge will route back to the original agent
  // who invoked the tool
  (x) => x.sender,
  {
    TaskAgent: "TaskAgent",
    RoleManagerAgent: "RoleManagerAgent",
  }
);

workflow.addEdge(START, "TaskAgent");
export const graph = workflow.compile();
