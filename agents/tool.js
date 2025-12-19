"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toolNode = exports.tavilySearchTool = void 0;
const prebuilt_1 = require("@langchain/langgraph/prebuilt");
const tavily_1 = require("@langchain/tavily");
exports.tavilySearchTool = new tavily_1.TavilySearch({ maxResults: 1 });
const tools = [exports.tavilySearchTool];
// This runs tools in the graph
exports.toolNode = new prebuilt_1.ToolNode(tools);
