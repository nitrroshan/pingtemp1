# Task 002: Document Metadata Header

**Status:** `not-started`
**Branch:** TBD

## Description
CrdtDocViewer currently wraps CollaborativeEditor directly with no metadata. Add a header bar showing doc type badge, author, last modified, and assigned role (for task docs).

## Acceptance Criteria
- [ ] Header bar above BlockNote editor with: type badge, author, last modified
- [ ] Task docs show assigned role and status
- [ ] Plan doc shows task count and plan status
- [ ] Read metadata from Y.Map("meta") via provider.document.getMap("meta")
