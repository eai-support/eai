## Workspace Preflight

Before doing stage/helper work:

1. Resolve the repository root.
2. Check the core Gofer sentinels:
   - `.specify/.gofer-version`
   - `.specify/commands/0_business_scenario.md`
   - `.specify/templates/spec-template.md`
   - `.specify/scripts/bash/create-new-feature.sh`
   - `.specify/scripts/node/parse-stage-command.mjs`
   - `.specify/scripts/hooks/post-tool-use.mjs`
   - `.specify/scripts/powershell/install-optional-tools.ps1`
   - `.specify/templates/gofer-model-policy.yaml`
   - `.specify/memory/gofer-model-policy.yaml`
   - `.specify/specs/`
   - `.specify/memory/`
3. Check host-specific repo-owned files when relevant:
   - Claude: `AGENTS.md`, `CLAUDE.md`, `.claude/settings.json`
   - Codex: `AGENTS.md`
   - Copilot: `.github/copilot-instructions.md`
   - VS Code extension mirrors Claude/Copilot/Gemini resources itself and should still keep the core scaffold healthy
4. If the repo already has the workspace checker script, prefer running:
   - `node .specify/scripts/node/gofer-workspace-check.mjs --host gemini --json`
5. If the workspace is missing or stale, ask exactly:
   - **"This repo is missing or stale for Gofer. Initialize/update it now?"**
6. If the user says yes, run the Gofer workspace bootstrap helper and then resume this command from the top.
7. If the user says no, stop and explain that Gofer stage/helper work depends on the repo-owned scaffold.

---
description:
  Create or update project constitution with coding principles and guidelines
---

# Gofer Constitution

## Token And Cost Policy
<!-- gofer:token-cost-policy:start -->

Before spawning agents, calling tools, or loading large files:

1. Treat `.specify/memory/gofer-model-policy.yaml` as the repo-owned source of truth for simple, medium, hard, and arbiter model routing. If it is missing, run `/gofer:bootstrap-workspace` before continuing.
2. Use the cheapest capable model first.
   - Claude: Haiku for scouting/extraction; Sonnet for normal implementation, synthesis, validation, and security; Opus for high-risk arbitration or release-critical failures.
   - Codex/OpenAI: GPT mini for simple coding; GPT nano only for locate/classify/summarize/mechanical work; GPT-5.3-Codex or flagship GPT for tool-heavy coding, architecture, and release-critical validation.
   - Gemini: Flash-Lite for cheap large-context scan/summarize; Flash for default research synthesis; Pro for large-context architecture or high-risk arbitration.
   - Copilot: prefer Auto for simple and default work; ask the user before choosing a paid/high-tier picker model for hard security, architecture, or release gates.
3. Keep raw tool output out of the main conversation context. Save stable findings to `.specify/specs/{feature}/context-bundle.md`, then work from summaries.
4. Use provider prompt/context caching only for stable, non-secret prefixes: Gofer scaffold, AGENTS/CLAUDE/Copilot instructions, constitution, repo map, stage contracts, and validation rubric.
5. Before continuing after large research, planning, implementation, or validation bursts, checkpoint the durable artifacts and compact/clear/resume context when the host supports it.
6. Escalate model tier only when a cheaper pass is low-confidence, contradictory, security-sensitive, or blocking release quality.
<!-- gofer:token-cost-policy:end -->

## Source-of-Truth and Codex Distribution (FR-001, FR-010)

The Gofer constitution lives at `.specify/memory/constitution.md` and is the
authoritative reference for cross-cutting concerns the entire pipeline must
respect.

Two invariants the constitution MUST document and this command MUST preserve
when updating:

1. **Source-of-truth (FR-001)**: All stage commands derive from canonical files
   at `.specify/commands/<stage>.md` — YAML frontmatter (name, description ≤140
   chars, surfaces, args) plus Markdown body. The generator at
   `.specify/scripts/node/generate-commands.mjs` emits to every CLI surface
   (`.claude/commands/`, `extension/resources/copilot-prompts/`,
   `.github/prompts/`, `.gemini/commands/gofer/`, `.agents/skills/`, and the
   legacy compatibility mirror `.system/skills/`). Hand-edits on emitted files
   are rejected by the generator without `--force-emit`. **Never bypass the
   source-of-truth.**

2. **Codex distribution path (FR-010)**: Codex discovers skills at
   `.agents/skills/` (one folder per skill:
   `.agents/skills/<stage>/SKILL.md`). This is NOT the same as
   `.claude/skills/`, and it is the only repo-local path Codex should rely on
   for normal Gofer installs. The constitution MUST capture that distinction
   explicitly so future authors do not conflate the two paths or recreate
   duplicate global Gofer bundles. The official Codex disable knob is a
   per-skill `[[skills.config]]` entry with a `path = "/full/path/to/skill"`
   plus `enabled = false` in `~/.codex/config.toml`; there is no global
   skill-budget percentage key (FR-011).

When updating the constitution, ensure both sections survive the edit pass.

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty).

---

## Why Constitution Matters for Agentic Coding

1. **Consistency Across Sessions**: Agents follow the same rules every time
2. **Memory Persistence**: Decisions survive context window limits
3. **Team Alignment**: All agents (and humans) follow same guidelines
4. **Quality Gates**: Automatic validation against principles
5. **Knowledge Capture**: Learnings from past work inform future work

---

## When to Use This Command

- **Project Setup**: Initialize constitution for new project
- **Post-Implementation Learning**: Capture decisions from completed features
- **Standards Update**: Add new conventions or patterns
- **Onboarding**: Document expectations for new team members/agents

---

## Step 1: Check Existing Constitution

```bash
# Check if constitution exists
if [ -f ".specify/memory/constitution.md" ]; then
  echo "Constitution exists - will update"
else
  echo "No constitution - will create"
fi
```

Read existing constitution if present.

---

## Step 2: Gather Principles

### If Creating New Constitution

Ask the user using AskUserQuestion:

```
I'll help you create a project constitution. What areas would you like to define?

1. Coding Standards (naming, formatting, patterns)
2. Architecture Principles (structure, dependencies, layering)
3. Testing Requirements (coverage, types, conventions)
4. Security Guidelines (auth, data handling, secrets)
5. Performance Standards (targets, monitoring, optimization)
6. Documentation Requirements (comments, READMEs, ADRs)
7. All of the above (I'll ask about each)
```

### If Updating Existing Constitution

Ask:

```
What would you like to update in the constitution?

1. Add new principle(s)
2. Modify existing principle(s)
3. Remove outdated principle(s)
4. Add architectural decision record (ADR)
5. Update coding standards
6. Review and validate current constitution
```

---

## Step 3: Research Codebase Patterns

Before writing principles, understand current codebase:

```
Task: subagent_type="codebase-pattern-finder", model="haiku"
Prompt: "Analyze the codebase for existing patterns and conventions.
Find:
- Naming conventions (files, variables, functions)
- Code organization patterns
- Testing patterns and conventions
- Error handling patterns
- Documentation style
Report patterns that should be formalized as principles."
```

---

## Step 4: Generate Constitution

Write to `.specify/memory/constitution.md`:

````markdown
---
version: 1.0
created: [ISO date]
updated: [ISO date]
status: active
---

# Project Constitution

> This document defines the principles and standards that guide all development
> work in this project. AI agents and human developers MUST follow these
> guidelines.

## Core Principles

### P1: [Principle Name]

**Statement**: [Clear, actionable statement]

**Rationale**: [Why this matters]

**Examples**:

- Good: [Example of following this principle]
- Bad: [Example of violating this principle]

**Enforcement**: [How this is validated]

### P2: [Principle Name]

...

## Coding Standards

### Naming Conventions

| Element   | Convention        | Example           |
| --------- | ----------------- | ----------------- |
| Files     | [kebab/camel/etc] | `user-service.ts` |
| Classes   | [PascalCase]      | `UserService`     |
| Functions | [camelCase]       | `getUserById`     |
| Constants | [UPPER_SNAKE]     | `MAX_RETRY_COUNT` |
| Variables | [camelCase]       | `userData`        |

### Code Organization

```
src/
├── [layer]/           # [Description]
│   ├── [sublayer]/    # [Description]
│   └── index.ts       # Public exports only
├── types/             # Shared type definitions
├── utils/             # Shared utilities
└── index.ts           # Main entry point
```
````

### Import Order

1. External packages (node_modules)
2. Internal absolute imports
3. Relative imports
4. Type imports (if separate)

### Error Handling

- MUST: [Error handling requirement]
- MUST NOT: [Anti-pattern to avoid]
- SHOULD: [Best practice]

## Architecture Principles

### Dependency Direction

```
UI → Application → Domain → Infrastructure
     ↓
   Never depend on layers above
```

### Component Boundaries

| Component | May Depend On      | Must Not Depend On |
| --------- | ------------------ | ------------------ |
| UI        | Application, Types | Domain, Infra      |
| Domain    | Types              | Anything else      |

### State Management

- [Principle about state]
- [Where state should live]
- [How state should flow]

## Testing Requirements

### Coverage Targets

| Type        | Target    | Current  |
| ----------- | --------- | -------- |
| Unit        | 80%       | [X]%     |
| Integration | 60%       | [X]%     |
| E2E         | Key flows | [status] |

### Test Patterns

- Use DSL functions for readability
- Follow Arrange-Act-Assert structure
- One assertion concept per test
- Test behavior, not implementation

### Required Tests

- [ ] All public API functions
- [ ] All error handling paths
- [ ] All edge cases identified in specs

## Security Guidelines

### Authentication/Authorization

- [Requirement]
- [Pattern to follow]

### Data Handling

- NEVER: Store secrets in code
- NEVER: Log sensitive data
- ALWAYS: Validate external input
- ALWAYS: Use parameterized queries

### Secrets Management

- Location: [Where secrets go]
- Format: [How to reference]
- Rotation: [Policy]

## Performance Standards

### Response Time Targets

| Operation  | Target  | Critical Path? |
| ---------- | ------- | -------------- |
| API call   | < 200ms | Yes            |
| Page load  | < 2s    | Yes            |
| Background | < 30s   | No             |

### Resource Limits

- Memory: [Limit]
- CPU: [Limit]
- Bundle size: [Limit]

## Documentation Requirements

### Code Comments

- Document "why", not "what"
- Required for: complex logic, workarounds, non-obvious decisions
- Not required for: self-explanatory code

### API Documentation

- All public functions must have JSDoc/docstrings
- Include: description, parameters, return value, errors

### Architecture Decision Records

When making significant decisions, create ADR in `.specify/memory/decisions/`.

## Quality Gates

These checks MUST pass before code is considered complete:

```bash
# Automated checks
npm run lint        # Zero errors
npm run typecheck   # Zero errors
npm test            # All pass
npm run build       # Successful

# Manual checks
- [ ] Code review approved
- [ ] Tests cover new functionality
- [ ] Documentation updated
```

## Violations and Exceptions

### How to Handle Violations

1. **Accidental**: Fix before committing
2. **Intentional**: Document exception with ADR
3. **Systemic**: Propose constitution amendment

### Exception Format

When violating a principle intentionally:

```typescript
// CONSTITUTION EXCEPTION: P3 - [Principle Name]
// Reason: [Why violation is necessary]
// ADR: .specify/memory/decisions/NNN-exception.md
// TODO: [Plan to resolve, if any]
```

## Version History

| Version | Date   | Changes              | Author |
| ------- | ------ | -------------------- | ------ |
| 1.0     | [date] | Initial constitution | Claude |

````

---

## Step 5: Create Decision Record Template

Ensure `.specify/memory/decisions/` exists and has template:

```markdown
# .specify/memory/decisions/000-template.md

---
id: NNN
title: '[Decision Title]'
status: [proposed|accepted|deprecated|superseded]
date: [ISO date]
deciders: [who made this decision]
---

# [Decision Title]

## Context

[What is the issue we're addressing?]

## Decision

[What is the change we're making?]

## Consequences

### Positive

- [Benefit 1]
- [Benefit 2]

### Negative

- [Drawback 1]
- [Drawback 2]

### Neutral

- [Side effect]

## Alternatives Considered

### Alternative 1: [Name]

- Pros: [benefits]
- Cons: [drawbacks]
- Why rejected: [reason]

### Alternative 2: [Name]

...

## Related Decisions

- [Link to related ADR]
````

---

## Step 6: Validate Constitution

After creating/updating, validate:

### Consistency Check

- [ ] All principles are actionable (not vague)
- [ ] No contradictory principles
- [ ] Examples provided for clarity
- [ ] Enforcement method defined

### Codebase Alignment Check

```
Task: subagent_type="codebase-analyzer", model="sonnet"
Prompt: "Check if the codebase follows these constitution principles:
[List key principles]
Report any violations or areas needing attention."
```

### Completeness Check

- [ ] Coding standards defined
- [ ] Architecture principles defined
- [ ] Testing requirements defined
- [ ] Security guidelines defined
- [ ] Quality gates defined

---

## Step 7: Report Completion

```
================================================================
  CONSTITUTION [CREATED/UPDATED]: [Project Name]
================================================================

  Location: .specify/memory/constitution.md

  Sections:
  - Core Principles: [N] defined
  - Coding Standards: [Complete/Partial]
  - Architecture: [Complete/Partial]
  - Testing: [Complete/Partial]
  - Security: [Complete/Partial]
  - Quality Gates: [N] checks

  Validation:
  - Consistency: [Pass/Issues found]
  - Codebase alignment: [X]% following principles
  - Completeness: [X]/[Total] sections

  Next Steps:
  1. Review with team
  2. Address any violations found
  3. Add to onboarding documentation
  4. Reference in /3_gofer_plan for alignment checks

================================================================
```

---

## Integration with Pipeline

### During Planning (/3_gofer_plan)

```markdown
## Constitution Check

- [x] P1: [Principle] - Plan aligns
- [x] P2: [Principle] - Plan aligns
- [ ] P3: [Principle] - Exception needed (see ADR-NNN)
```

### During Implementation (/5_gofer_implement)

Before each task, verify implementation follows constitution.

### During Validation (/6_gofer_validate)

```markdown
## Constitution Compliance

| Principle | Status    | Notes             |
| --------- | --------- | ----------------- |
| P1        | Pass      | -                 |
| P2        | Pass      | -                 |
| P3        | Exception | ADR-NNN documents |
```

---

## Updating Constitution

When learnings emerge from feature work:

1. Run `/gofer_constitution` with update flag
2. Add new principles or modify existing
3. Create ADR for significant changes
4. Update version history
5. Notify team of changes

---

## Observability Logging

```bash
.specify/scripts/bash/log-stage.sh gofer_constitution --complete --tokens [N] --compactions [N]
```

---

## Key Rules

- Constitution is **authoritative** - all work must align
- Principles must be **actionable** - not vague aspirations
- **Exceptions require ADRs** - no silent violations
- **Version control** constitution changes
- Constitution informs **all pipeline stages**
