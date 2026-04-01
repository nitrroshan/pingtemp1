# OpenClaw/ClawdBot Integration — Implementation Plan

**Parent:** [Feature Architecture](feature_architecture.md)  
**Phase:** Parked (research, depends on external protocol)  
**Approach:** Approach 1 — External Agent via Gateway Protocol

---

## Branch
- `feature/openclaw-integration` (when unparked)

## Scope
OpenClaw Bridge Agent that connects to Gateway WebSocket, proxies requests/responses, and enables messaging platform access (WhatsApp, Telegram, Discord, Slack).

## Implementation Steps

### Step 1: Create OpenClaw Gateway Client
**Files to create:**
- `packages/backend/agent/external/openclaw/GatewayClient.ts` — WebSocket client for OpenClaw Gateway (port 18789). Implements protocol v3: connect handshake, request/response frames, event frames. Auto-reconnect on disconnect.

**Exit criteria:** Client connects, authenticates, sends requests, receives responses

### Step 2: Create OpenClaw Bridge Agent
**Files to create:**
- `packages/backend/agent/external/openclaw/OpenClawBridgeAgent.ts` — Extends `BaseAgent` (or `ExternalAgent`). Translates Ping task → Gateway `agent` RPC call. Streams Gateway event frames → `AgentEvent` stream.

**Exit criteria:** Bridge agent receives tasks, proxies to OpenClaw, returns results

### Step 3: Create Agent YAML Definition
**Files to create:**
- `packages/backend/agent/agents/openclaw-bridge.yaml` — Type: external, endpoint: ws://localhost:18789, protocol: openclaw-gateway-v3, auth config

**Exit criteria:** Agent loadable from YAML, connects to Gateway

### Step 4: Add Messaging Tools
**Files to create:**
- `packages/backend/agent/external/openclaw/tools.ts` — Tools: `send_message(channel, message)`, `list_sessions()`, `get_session_history(sessionId)`. Route through GatewayClient.

**Exit criteria:** Agents can send/receive messages on messaging platforms

### Step 5: Wire into Orchestrator
**Files to modify:**
- `packages/backend/agent/AgentFactory.ts` — Register `openclaw` agent type
- Orchestrator can assign messaging tasks to OpenClaw bridge agent

**Exit criteria:** Planner can delegate messaging tasks to OpenClaw agent

## Prerequisites
- OpenClaw Gateway running and accessible
- `OPENCLAW_TOKEN` env var configured
- External Agent Invocation (A7) basics in place

## Research Needed
- Gateway protocol v3 stability — monitor for breaking changes
- Session management lifecycle — when to create/reuse sessions
- Rate limits on messaging platforms via OpenClaw
- Error handling for channel-specific failures (WhatsApp rate limits, Telegram bot restrictions)

## Testing Strategy
- Mock Gateway for unit tests
- Integration test: send message via bridge → verify Gateway receives
- Test: connection loss → auto-reconnect
- Test: Gateway error → task failed gracefully

## Complexity
Medium — 1-2 weeks. Mostly WebSocket protocol implementation + event translation.
