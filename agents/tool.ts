import { ToolNode } from "@langchain/langgraph/prebuilt";
import { TavilySearch } from "@langchain/tavily";
import { AgentState } from "./util/state";
export const tavilySearchTool = new TavilySearch({ maxResults: 1 });
const tools = [tavilySearchTool];
// This runs tools in the graph
export const toolNode = new ToolNode<typeof AgentState.State>(tools);
