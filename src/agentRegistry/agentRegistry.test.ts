import { ServiceRegistry } from "./agentRegistry";
import { researchAgent, codingAgent, dataAgent } from "./sample-agents";
const discovery = new ServiceRegistry();
// Register sample agents
discovery.registerAgent(researchAgent);
discovery.registerAgent(codingAgent);
discovery.registerAgent(dataAgent);
const allAgents = discovery.discoverAgents().then((agents) => {
  console.log("All agents:", agents);
});
