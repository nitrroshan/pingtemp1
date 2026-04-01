# Company/Team Templates — Implementation Plan

**Parent:** [Feature Architecture](feature_architecture.md)  
**Phase:** Unphased (after Config Revision A9)  
**ID:** A11  
**Approach:** Option A — JSON/YAML File Export (v1.0)

---

## Branch
- `feature/company-templates`

## Scope (v1.0)
Export team config as YAML template. Import template to create new team. Secret scrubbing. Built-in starter templates.

## Implementation Steps

### Step 1: Create Template Types
**Files to create:**
- `packages/backend/team/templates/types.ts` — `TeamTemplate` type: templateVersion, name, description, category, tags, team settings, agents array (with definitionYaml, skills per agent)

**Exit criteria:** Template type covers all exportable team config

### Step 2: Implement Export
**Files to create:**
- `packages/backend/team/templates/TemplateExporter.ts` — `exportTemplate(teamId)`: fetch team config + all agents + skill assignments. Apply scrubbing rules: remove IDs, secrets, users, runtime state, history. Replace secrets with `[CONFIGURE_AFTER_IMPORT]`. Return YAML string.

**Scrubbing rules:** Remove `_id`, `teamId`, `agentId`, API keys/tokens, `ownerId`, `status`, timestamps, tasks/plans/goals  
**Exit criteria:** Export produces clean YAML with no secrets or IDs

### Step 3: Implement Import
**Files to create:**
- `packages/backend/team/templates/TemplateImporter.ts` — `importTemplate(template, ownerId)`: validate template schema, create team via TeamService, create agents per template, assign skills, return new teamId.

**Exit criteria:** Import creates fully configured team from template

### Step 4: Add API Endpoints
**Files to modify:**
- `packages/backend/api/HttpServer.ts` — Add:
  - `GET /api/v2/teams/:teamId/export` — returns YAML template
  - `POST /api/v2/teams/import` — creates team from template body

**Exit criteria:** Export/import via API

### Step 5: Create Built-in Starter Templates (v1.1)
**Files to create:**
- `packages/backend/data/templates/engineering.yaml` — 4-agent dev team (planner, backend, frontend, QA)
- `packages/backend/data/templates/content.yaml` — 3-agent content team (researcher, writer, editor)
- `packages/backend/data/templates/research.yaml` — 2-agent research team (researcher, analyst)

**Exit criteria:** `GET /api/v2/templates` lists starter templates

### Step 6: Add Frontend UI
**Files to create:**
- `packages/frontend/components/TemplateGallery.tsx` — Show available templates when creating team. "Start from template" option. Preview template before importing.
- Team Settings: "Export as Template" button.

**Exit criteria:** Users can browse templates and create teams from them

## Testing Strategy
- Test: export → import produces identical team config (minus IDs and secrets)
- Test: secrets scrubbed completely (no API keys in export)
- Test: import with invalid template → clear validation error
- Test: starter templates create working teams

## Complexity
Low — 1-2 weeks for v1.0.
