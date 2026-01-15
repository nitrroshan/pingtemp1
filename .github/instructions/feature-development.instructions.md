---
applyTo: docs/features/**/*
---

# Feature Development Process

All features follow a **three-document workflow** to maintain clarity and prevent scope creep.

## Three Required Documents

Each feature requires these three documents:

1. **`feature_architecture.md`** - How the feature fits into overall design (see `feature-architecture.instructions.md`)
2. **`feature_implementation_planning.md`** - Step-by-step implementation plan (see `feature-implementation-planning.instructions.md`)
3. **`feature_implementation.md`** - Actual progress tracking (see `feature-implementation.instructions.md`)

See the respective instruction files for detailed guidelines on each document type.

## Folder Structure

### Simple Feature (No Versions)
```
docs/features/
  feature-name/
    feature_architecture.md
    feature_implementation_planning.md
    feature_implementation.md
    tasks/
      task-001-brief-name.md
      task-002-brief-name.md
    bugs/
      bug-001.md
      bug-002.md
```

### Feature with Incremental Versions
```
docs/features/
  feature-name/
    feature_architecture.md           (covers all versions)
    v1.0/
      feature_implementation_planning.md
      feature_implementation.md
      tasks/
        task-001-user-model.md
        task-002-login-endpoint.md
    v1.1/
      feature_implementation_planning.md
      feature_implementation.md
      tasks/
        task-003-oauth-integration.md
    v2.0/
      feature_implementation_planning.md
      feature_implementation.md
      tasks/
        task-004-mfa-setup.md
    bugs/
      bug-001.md                      (shared across versions)
      bug-002.md
```

### Sub-feature Organization
```
docs/features/
  parent-feature/
    feature_architecture.md           (parent overview)
    sub-feature-a/
      feature_architecture.md
      feature_implementation_planning.md
      feature_implementation.md
      tasks/
        task-001-brief-name.md
      bugs/
        bug-001.md
    sub-feature-b/
      feature_architecture.md
      v1.0/
        feature_implementation_planning.md
        feature_implementation.md
        tasks/
          task-002-brief-name.md
      v1.1/
        feature_implementation_planning.md
        feature_implementation.md
        tasks/
          task-003-brief-name.md
      bugs/
        bug-001.md
```

### Rules for Folder Organization
- **Architecture doc** stays at feature root (applies to all versions)
- **Planning and Implementation docs** go in version folders if using incremental delivery
- **Tasks folder** at same level as planning/implementation (per version)
- **Bugs folder** at feature root (bugs can span versions)
- Each **version folder** represents a deployable increment
- **Sub-features** can have their own version folders if needed
- **Task files** created from implementation planning steps (see `task-management.instructions.md`)

## Workflow Examples

### Starting a New Feature (No Versions)
1. Create folder: `docs/features/<feature-name>/`
2. Create `feature_architecture.md` with 2-3 architecture options
3. **Ask user to choose** - wait for approval
4. Create `feature_implementation_planning.md`
5. **Create feature branch**: `git checkout -b feature/<feature-name>`
6. Create `feature_implementation.md` and begin coding
7. Create `bugs/` folder as needed

### Starting a New Feature (With Incremental Versions)
1. Create folder: `docs/features/<feature-name>/`
2. Create `feature_architecture.md` with options (covers all planned versions)
3. **Ask user to choose** - wait for approval
4. Create version folder: `docs/features/<feature-name>/v1.0/`
5. Create `v1.0/feature_implementation_planning.md`
6. **Create tasks folder**: `docs/features/<feature-name>/v1.0/tasks/`
7. **Create task files** from implementation plan steps (see `task-management.instructions.md`)
8. **Create version branch**: `git checkout -b feature/<feature-name>-v1.0`
9. Create `v1.0/feature_implementation.md` and begin coding
10. **Link code TODOs to tasks**: `// TODO(task-001): Description`
11. Complete v1.0, merge to feature branch, create PR
12. For v1.1: Create `v1.1/` folder, tasks folder, and new branch
13. Create `bugs/` folder at feature root as needed

### Adding a New Version to Existing Feature
1. Ensure `feature_architecture.md` covers new version scope
2. If architecture needs changes, **present options to user**
3. Create new version folder: `docs/features/<feature-name>/v1.1/`
4. Create `v1.1/feature_implementation_planning.md`
5. **Create version branch** from feature branch: `git checkout -b feature/<feature-name>-v1.1`
6. Create `v1.1/feature_implementation.md`
7. Implement, test, merge to feature branch

### Updating an Existing Feature
1. Navigate to feature folder and read all docs
2. If architecture changes needed, **present options to user**
3. **Don't proceed** without user approval for architecture changes
4. Update appropriate version folder or create new version
5. **Revise** docs (don't just append)
6. Update git branch as needed
7. Keep folder structure clean - remove obsolete version folders after merge

### Branch Naming Convention
- **Feature branch**: `feature/<feature-name>` (main feature branch)
- **Version branches**: `feature/<feature-name>-v1.0`, `feature/<feature-name>-v1.1`, etc.
- **Bug fix branches**: `bugfix/<feature-name>-<bug-id>` (branch from feature branch)

### Merge Strategy
1. Work on version branch (e.g., `feature/<feature-name>-v1.0`)
2. When version is complete and tested, merge to feature branch
3. Create PR from feature branch to `main`/`develop` for code review
4. After approval, merge to main branch
5. Tag releases: `git tag v1.0.0-<feature-name>`

## Integration with Main Copilot Guide

These feature documents **complement** (not duplicate) the main copilot guide:
- Main guide: **Permanent architectural patterns and conventions**
- Feature docs: **Specific implementation details and progress**

When a feature becomes stable and its patterns should be followed broadly, **migrate key insights** from feature docs into the main guide, then **remove redundant details** from feature docs.
