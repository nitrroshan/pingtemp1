# Task 007: Verify CRDT Report Content Before Completion

**Status:** `not-started`
**Branch:** TBD

## Description
The `completeTaskTool` guard checks that `producedDocs` contains `crdt:{taskId}/report` URI, but doesn't verify the doc actually has content. An agent could satisfy the guard by writing an empty doc. Add server-side verification that the CRDT report doc has non-empty content.

## Acceptance Criteria
- [ ] `completeTaskTool` checks CRDT doc content length (not just URI presence)
- [ ] Requires at least 1 block in `Y.XmlFragment("content")`
- [ ] Error message tells agent to write actual content, not just create an empty doc
- [ ] Requires CrdtTaskSync or CollaborationSpace access in the tool context

## Notes
This requires passing CRDT access into the complete_task tool, which currently only has sync access. May need to make the tool context richer or use a callback pattern.
