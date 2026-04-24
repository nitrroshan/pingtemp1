# Frontend Phase 2: Streaming & Live Experience — Implementation Plan

**Parent:** [Feature Architecture](feature_architecture.md)  
**Phase:** 2 (Real-Time Experience)

---

## Branch
- `feature/frontend-phase2-streaming`

## Scope
Render streaming agent output: token-by-token text, tool call cards, reasoning sections, notification chips, artifact previews, skill selector.

## Implementation Steps

### Step 1: Create Stream State Manager
**Files to create:**
- `packages/frontend/hooks/useStreamRenderer.ts` — Listen to single `stream` Socket.IO event, maintain `StreamState` (parts array, active text/reasoning IDs, active tool cards). Switch on `part.type` to accumulate state.
- `packages/frontend/types.ts` — Add `StreamState`, `RenderedPart`, `ToolCardState` types

**Exit criteria:** Hook processes all stream part types, state accumulates correctly

### Step 2: Build StreamMessage Component
**Files to create:**
- `packages/frontend/components/StreamMessage.tsx` — Container that renders `RenderedPart[]` in order. Each part renders as text block, reasoning section, tool card, notification chip, or error.

**Exit criteria:** Mixed content (text + tool + reasoning) renders correctly in order

### Step 3: Build ToolCard Component
**Files to create:**
- `packages/frontend/components/ToolCard.tsx` — Renders differently by `toolName`. Default: generic card with input/output JSON. Special cases: `create_plan` → PlanCard, `request_approval` → ApprovalButtons, `present_artifact` → ArtifactPreview, `get_status` → progress card.

**Lifecycle states:** calling → streaming-args → executing → complete/error  
**Exit criteria:** Tool cards show lifecycle, expand/collapse, render by tool name

### Step 4: Build ReasoningSection Component
**Files to create:**
- `packages/frontend/components/ReasoningSection.tsx` — Collapsible "Thinking..." block. Collapsed by default. Shows streamed reasoning content when expanded.

**Exit criteria:** Reasoning collapses/expands, streams incrementally

### Step 5: Build NotificationChip Component
**Files to create:**
- `packages/frontend/components/NotificationChip.tsx` — Inline chips for task events. Green = started, check = completed, red = failed. Shows role name + task ID.

**Exit criteria:** Task lifecycle events render as inline chips in message stream

### Step 6: Build ArtifactPreview Component
**Files to create:**
- `packages/frontend/components/ArtifactPreview.tsx` — Render by media type: markdown → react-markdown, code → syntax-highlighted, image → img with zoom, CSV → table view, default → raw text + download.

**Exit criteria:** Different file types preview correctly inline

### Step 7: Build SkillSelector Component
**Files to create:**
- `packages/frontend/components/SkillSelector.tsx` — Checkbox list of available skills per agent. Default skills checked. User can add/remove. Saves via API.

**Exit criteria:** Skills togglable per agent, saved to backend

### Step 8: Wire into Chat Flow
**Files to modify:**
- `packages/frontend/components/ChatArea.tsx` (or equivalent) — Replace flat text bubble rendering with `StreamMessage` for actively streaming messages. Keep completed messages as static rendered content.

**Exit criteria:** Active messages stream live, completed messages render statically

## Testing Strategy
- Visual testing: verify all component states render correctly
- Test: mixed stream (text → tool → text → notification) renders in correct order
- Test: tool card lifecycle transitions smoothly

## Complexity
Medium — 12-15 days frontend work.
