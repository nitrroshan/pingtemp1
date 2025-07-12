import { createAgent, runAgentNode } from "./createagent/createagent";
import { AgentState } from "./util/state";
import { llm } from "../llm/azureopenai";
let featureDescriptionAgent: any;

(async () => {
  featureDescriptionAgent = await createAgent({
    llm,
    tools: [],
    systemMessage: "You define features for Agents that can complete the tasks",
  });
})();

async function featureDescriptionNode(state: typeof AgentState.State) {
  return runAgentNode({
    state: state,
    agent: featureDescriptionAgent,
    name: "ChartGenerator",
  });
}
