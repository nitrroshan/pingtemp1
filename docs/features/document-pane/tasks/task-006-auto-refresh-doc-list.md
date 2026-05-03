# Task 006: Auto-Refresh Document List

**Status:** `not-started`
**Branch:** TBD

## Description
DocumentList only fetches docs on mount. During execution, new task docs and report docs appear but the list is stale. Add auto-refresh when tasks complete or new docs are created.

## Acceptance Criteria
- [ ] Listen to `state` Socket.IO events for task status changes
- [ ] Auto-refresh doc list when a task completes (new report doc may exist)
- [ ] Auto-refresh when `sessionState` changes
- [ ] Debounce refreshes (max 1 per 5s)
