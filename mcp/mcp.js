"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTools = exports.client = void 0;
const mcp_adapters_1 = require("@langchain/mcp-adapters");
// Create client and connect to server
exports.client = new mcp_adapters_1.MultiServerMCPClient({
    // Global tool configuration options
    // Whether to throw on errors if a tool fails to load (optional, default: true)
    throwOnLoadError: true,
    // Whether to prefix tool names with the server name (optional, default: true)
    prefixToolNameWithServerName: true,
    // Optional additional prefix for tool names (optional, default: "mcp")
    additionalToolNamePrefix: "mcp",
    // Server configuration
    mcpServers: {
        // adds a STDIO connection to a server named "math"
        math: {
            transport: "stdio",
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-math"],
            // Restart configuration for stdio transport
            restart: {
                enabled: true,
                maxAttempts: 3,
                delayMs: 1000,
            },
        },
        // here's a filesystem server
        filesystem: {
            transport: "stdio",
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-filesystem"],
        },
        // Sreamable HTTP transport example, with auth headers and automatic SSE fallback disabled (defaults to enabled)
        weather: {
            url: "https://example.com/weather/mcp",
            headers: {
                Authorization: "Bearer token123",
            },
            automaticSSEFallback: false,
        },
        // OAuth 2.0 authentication (recommended for secure servers)
        "oauth-protected-server": {
            url: "https://protected.example.com/mcp",
            authProvider: new MyOAuthProvider({
                // Your OAuth provider implementation
                redirectUrl: "https://myapp.com/oauth/callback",
                clientMetadata: {
                    redirect_uris: ["https://myapp.com/oauth/callback"],
                    client_name: "My MCP Client",
                    scope: "mcp:read mcp:write",
                },
            }),
            // Can still include custom headers for non-auth purposes
            headers: {
                "User-Agent": "My-MCP-Client/1.0",
            },
        },
        // how to force SSE, for old servers that are known to only support SSE (streamable HTTP falls back automatically if unsure)
        github: {
            transport: "sse", // also works with "type" field instead of "transport"
            url: "https://example.com/mcp",
            reconnect: {
                enabled: true,
                maxAttempts: 5,
                delayMs: 2000,
            },
        },
    },
});
const getTools = async () => {
    return await exports.client.getTools();
};
exports.getTools = getTools;
