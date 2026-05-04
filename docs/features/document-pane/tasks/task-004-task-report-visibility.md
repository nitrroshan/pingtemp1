# Task 004: Task Report Docs in Document List

**Status:** `not-started`
**Branch:** TBD

## Description
When a task completes, the agent writes a completion report to `{taskId}/report`. These should appear in the Document List grouped under "Reports" with status badges. Currently they appear but need better UX — clicking a task should show both the task doc and its report.

## Acceptance Criteria
- [ ] Completed tasks show a "📄 View Report" sub-entry in DocumentList
- [ ] Report docs show completion status and role badge
- [ ] Clicking report opens CrdtDocViewer with the report content
- [ ] Empty reports (agent didn't write) show "No report written" placeholder
