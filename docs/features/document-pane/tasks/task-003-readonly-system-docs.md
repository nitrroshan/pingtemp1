# Task 003: Read-Only Mode for System Docs

**Status:** `not-started`
**Branch:** TBD

## Description
Plan docs, task description docs, and goal docs are system-generated. Users should not accidentally edit them. Add read-only mode to CrdtDocViewer for system doc types.

## Acceptance Criteria
- [ ] Plan doc (`type: "plan"`) renders in read-only BlockNote
- [ ] Task docs (`type: "task"`) render in read-only BlockNote
- [ ] Report docs (`type: "report"` or `{taskId}/report`) remain editable
- [ ] Custom agent-created docs remain editable
- [ ] Read-only indicator badge in header ("Read Only")
- [ ] Use `editable: false` on useCreateBlockNote
