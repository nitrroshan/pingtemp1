---
applyTo: docs/features/**/tasks/**/*
---

# Task Management

Break down implementation plans into trackable tasks that can be linked from code TODOs.

## Purpose

Tasks bridge the gap between implementation planning and code:
- Convert implementation steps into granular, assignable tasks
- Link code TODOs to specific tasks for traceability
- Track progress independently of docs
- Enable parallel work by multiple developers

## Folder Structure

```
docs/features/
  feature-name/
    feature_architecture.md
    v1.0/
      feature_implementation_planning.md
      feature_implementation.md
      tasks/
        task-001-user-model.md
        task-002-login-endpoint.md
        task-003-jwt-middleware.md
    bugs/
      bug-001.md
```

## Task File Format

Each task is a separate markdown file: `task-XXX-brief-name.md`

**Template:**
```markdown
# Task XXX: [Task Title]

**Status:** `not-started` | `in-progress` | `completed` | `blocked`
**Assignee:** [Name or leave blank]
**Estimated:** [time estimate]
**Branch:** `feature/feature-name-v1.0`

## Description
Brief description of what needs to be done (2-3 sentences).

## Acceptance Criteria
- [ ] Criterion 1
- [ ] Criterion 2
- [ ] Criterion 3

## Implementation Notes
- File to create/modify: `src/path/to/file.ts`
- Dependencies: Task-001 must be complete
- Related tasks: Task-004

## Code TODOs
List of TODO comments in code that reference this task:
- `src/models/User.ts:15` - Implement validation
- `src/middleware/auth.ts:8` - Add error handling

## Testing
- Unit tests: What to test
- Integration tests: What to verify

## Blockers
[Any blockers preventing progress]

## Notes
[Any additional context, decisions, or updates]
```

## Linking Tasks from Code

### TODO Comment Format

Use consistent format to link code TODOs to task files:

```typescript
// TODO(task-001): Implement user validation logic
// See: docs/features/user-auth/v1.0/tasks/task-001-user-model.md

// TODO(task-003): Add JWT token expiration handling
// See: docs/features/user-auth/v1.0/tasks/task-003-jwt-middleware.md
```

### Rules for Code TODOs

- **Always reference task ID**: `TODO(task-XXX)`
- **Include relative path**: Link to task file
- **Keep TODO brief**: Details are in task file
- **Update task file**: Add TODO location to task's "Code TODOs" section
- **Remove TODO** when task is complete

## Creating Tasks from Implementation Plan

When creating tasks from `feature_implementation_planning.md`:

1. **One task per implementation step** (or break large steps into multiple tasks)
2. **Sequential numbering**: task-001, task-002, task-003...
3. **Clear dependencies**: Reference prerequisite tasks
4. **Granular**: Each task should be completable in < 1 day
5. **Testable**: Clear acceptance criteria

**Example transformation:**

**Implementation Plan:**
```markdown
## Version 1.0 Implementation Steps
- [ ] Step 1: Add User model and database schema
- [ ] Step 2: Create login endpoint
- [ ] Step 3: Implement JWT token generation
```

**Tasks Created:**
```
tasks/
  task-001-user-model.md           (from Step 1)
  task-002-database-migration.md   (from Step 1, split)
  task-003-login-endpoint.md       (from Step 2)
  task-004-jwt-generation.md       (from Step 3)
  task-005-jwt-middleware.md       (from Step 3, split)
```

## Task Status Management

### Status Values
- **`not-started`**: Task defined but not begun
- **`in-progress`**: Actively being worked on
- **`blocked`**: Waiting on dependency or decision
- **`completed`**: Done and tested

### Updating Status

Update task status in the task file header when:
- Starting work: Change to `in-progress`, add assignee
- Encountering blocker: Change to `blocked`, document blocker
- Completing work: Change to `completed`, verify acceptance criteria
- During code review: Update notes with feedback

## Task Completion Checklist

Before marking a task as `completed`:

- [ ] All acceptance criteria met
- [ ] Tests written and passing
- [ ] Code TODOs removed (or moved to new tasks)
- [ ] Task file updated with final notes
- [ ] Related tasks notified (if they depend on this)
- [ ] Implementation doc updated with any deviations

## Archiving Completed Tasks

**Option 1: Keep in place** (recommended)
- Leave completed tasks in `tasks/` folder
- Status shows they're done
- Useful for reference

**Option 2: Archive**
- Move to `tasks/archive/` after feature merge
- Keeps active task list clean

**Option 3: Delete**
- Remove after feature is stable
- Only if implementation doc captures the story

## Rules

### ✅ DO:
- Create tasks from implementation plan steps
- Keep tasks focused and small (< 1 day)
- Link code TODOs to tasks
- Update task status regularly
- Add notes for future developers
- Reference task IDs in commit messages

### ❌ DON'T:
- Create tasks without acceptance criteria
- Let task status get stale
- Duplicate information between task and code
- Skip linking TODOs to tasks
- Create tasks for trivial changes

## Integration with Other Docs

**Implementation Planning**: Source of tasks (break down steps)
**Implementation Log**: References completed tasks
**Code TODOs**: Link to specific tasks
**Bug Fixes**: May create follow-up tasks

## Example Workflow

1. **From planning doc**, identify Step 2: "Create login endpoint"
2. **Create task file**: `tasks/task-003-login-endpoint.md`
3. **Add acceptance criteria** and implementation notes
4. **Start work**: Update status to `in-progress`
5. **Add code TODO**: `// TODO(task-003): Validate email format`
6. **Update task**: Add TODO location to task file
7. **Complete work**: Check acceptance criteria
8. **Remove TODO**, mark task `completed`
9. **Update implementation doc**: Reference task-003 completion

## Task ID in Commit Messages

Reference task IDs in commit messages for traceability:

```bash
git commit -m "feat: implement user login endpoint (task-003)"
git commit -m "test: add JWT middleware tests (task-005)"
git commit -m "fix: handle token expiration (task-003)"
```
