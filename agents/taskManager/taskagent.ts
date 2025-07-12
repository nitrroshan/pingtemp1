import { createAgent, runAgentNode } from "../createagent/createagent";
import { AgentState } from "../util/state";
import { tavilySearchTool } from "../tool";
// import { tool } from "@langchain/core/tools";
let taskAgent: any;
import { TasksFormatter } from "../schema/taskdescriptoroutputschema";

// // Create a tool with TasksFormatter as its schema.
// const taskFormatterTool = tool(async () => {}, {
//   name: "taskFormatter",
//   schema: TasksFormatter,
// });
const tools = [tavilySearchTool]; // , taskFormatterTool didn't work
export async function taskNode(state: typeof AgentState.State) {
  const systemMessage = 
  taskAgent = await createAgent({
    tools: tools,
    systemMessage:
      "You need to break this task to more tasks that are actionable and can be completed by other tools or agents.",
    schema: TasksFormatter,
  });

  return runAgentNode({
    state: state,
    agent: taskAgent,
    name: "TaskCreator",
  });
}
