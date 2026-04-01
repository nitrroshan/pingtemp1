# Open-Source Research — Implementation Plan

**Parent:** [Feature Architecture](feature_architecture.md)  
**Phase:** Ongoing research track (not a buildable deliverable)

---

## Scope
This is not a traditional implementation plan. Open-Source Research is an ongoing evaluation track that feeds architecture decisions for other features.

## Active Evaluation Process

### How to Conduct Evaluations

For each project in the evaluation pipeline:

1. **Read docs** — official documentation, README, getting started guide
2. **Check vitals** — GitHub stars, last commit, open issues, contributors, release cadence
3. **Run example** — clone, install, run hello world. Measure setup time.
4. **Assess fit** — Does it replace custom code? TypeScript-first? Self-hostable? Lock-in risk?
5. **Document findings** — Update the architecture doc's evaluation table with results
6. **Recommend** — Adopt / Evaluate deeper / Watch / Skip

### Evaluation Schedule

| Priority | Projects | Target Feature | Action |
|---|---|---|---|
| **Now** | Vercel AI SDK, @ai-sdk/azure, @mastra/mcp | A1, A2, A3 | Adopt in Phase 2 |
| **Now** | @mastra/evals | C1 | Adopt in Phase 7 |
| **Phase 4** | Microsandbox stability test | A4 | Test before Phase 6 |
| **Phase 5** | Brave Search MCP, Docker MCP, GitHub MCP | A3 | Integrate in Phase 5 |
| **Watch** | Google A2A, E2B, Daytona | A7, A4 | Monitor, re-evaluate quarterly |
| **Study** | OpenHands, SWE-agent, Plandex, Claude Code | Patterns | Extract architecture patterns |

### Tracking Document
Update [feature_architecture.md](feature_architecture.md) evaluation tables as findings emerge. Don't create separate files per evaluation — keep the central table current.

### Decision Log
When a research finding leads to an architecture decision, document it in the relevant feature's architecture doc under "Research Findings" or "Why [Choice]".

## Deliverables
- Updated evaluation tables in architecture doc (ongoing)
- Architecture recommendations fed into feature planning docs
- No code deliverables — this is pure research
