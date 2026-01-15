"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const createagent_1 = require("./createagent/createagent");
const azureopenai_1 = require("../llm/azureopenai");
let featureDescriptionAgent;
(async () => {
    featureDescriptionAgent = await (0, createagent_1.createAgent)({
        llm: azureopenai_1.llm,
        tools: [],
        systemMessage: "You define features for Agents that can complete the tasks",
    });
})();
async function featureDescriptionNode(state) {
    return (0, createagent_1.runAgentNode)({
        state: state,
        agent: featureDescriptionAgent,
        name: "ChartGenerator",
    });
}
