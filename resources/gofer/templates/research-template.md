---
date: '[ISO timestamp]'
researcher: Claude
feature: '[Feature Name]'
status: complete
codebase_type: '[greenfield | brownfield]'
---

<!--
  This template is filled in by /1_gofer_research (or legacy /1_research_codebase).
  Recommended: Use /0_business_scenario to auto-chain the entire pipeline.
  Location: .specify/specs/[###-feature-name]/research.md
  Pair this with proposal-review.md before /2_gofer_specify runs.
-->

# Research: [Feature Name]

## Feature Summary

[Brief description of what we're building]

## Application Classification

- **Mode**: [application delivery | non-app work]
- **Shared numbered stages preserved**: [yes]
- **Why this classification applies**: [rationale]

## Business Scenario Analysis

### Scenario Options Considered

| Scenario   | User/Business Fit | Delivery Trade-off | Recommendation |
| ---------- | ----------------- | ------------------ | -------------- |
| [Option 1] | [Why it fits]     | [Cost/complexity]  | [Adopt/defer]  |
| [Option 2] | [Why it fits]     | [Cost/complexity]  | [Adopt/defer]  |

### Recommended Scenario

[Which scenario should move forward into specification and why]

## Codebase Analysis

### Where to Implement

| Component     | Location          | Purpose        |
| ------------- | ----------------- | -------------- |
| [Component 1] | `path/to/file.ts` | [What it does] |
| [Component 2] | `path/to/dir/`    | [What it does] |

### Existing Patterns to Follow

#### Pattern 1: [Name]

Found in: `path/to/example.ts:45-67`

```typescript
// Example code showing the pattern
```

Why relevant: [Explanation]

#### Pattern 2: [Name]

...

### Integration Points

1. **[Integration 1]**: How to connect with existing code
2. **[Integration 2]**: ...

### Related Code

- `path/file.ts:123` - [Description]
- `path/other.ts:45` - [Description]

## Technology Decisions

### Decision 1: [Topic]

- **Choice**: [What we'll use]
- **Rationale**: [Why]
- **Alternatives considered**: [What else]

### Decision 2: [Topic]

...

## UI-First App Delivery Research _(application delivery only)_

### Preview Strategy

- **Smallest useful MVP to show first**: [description]
- **Profile choice**: [external / internal / hybrid]
- **Package lane**: [public-package / internal-app / hybrid-adapter / app-local]
- **Coupling status**: [source-platform-coupled / source-platform-decoupled /
  hybrid-adapter]
- **Public-readiness target**: [required / deferred / not applicable]
- **EAI App Template constraints**: [approved blocks/patterns to reuse first]
- **Block catalog discovery**: [`eai --describe`, `eai blocks list`, candidate
  `eai blocks describe <id>` results, and `eai resources schema` evidence]
- **Selected block IDs**: [stable IDs, required resources, bindings, override
  points, Storybook story IDs, theme override points, package lane, coupling
  status, and custom-block exceptions]
- **Block porting plan**: [reuse as-is, port to package, or custom-block
  exception with owner and approval path]
- **source-platform decoupling plan**: [adapter/resource-schema boundary or
  approved restricted-source exception]
- **Branding inputs**: [logos, colors, voice, or "not in scope"]
- **Preview validation expectation**: [screenshot, local render proof,
  Playwright-style checks]

### Service-Fit Discovery Inputs

- **Capability discovery sources**: [`eai --describe`, `eai whoami`, `eai tenant
  select`, `eai resources schema`, `eai verify calls --format json`, or
  equivalent]
- **What must be decided after UI approval**: [service selection questions]
- **Non-app note**: [write "Not applicable" when this feature is non-app work]

## Recommended Architecture Direction

### Recommended Architecture

[Plain-language summary of the architecture direction this feature should use]

### Architecture Options Considered

| Option     | Why choose it | Why not choose it now |
| ---------- | ------------- | --------------------- |
| [Option 1] | [Benefit]     | [Trade-off]           |
| [Option 2] | [Benefit]     | [Trade-off]           |

## Constraints & Considerations

- [Constraint 1]: [Impact on implementation]
- [Constraint 2]: ...

---

## Brownfield Analysis

_(Include this section for existing codebases)_

### Constraints & Limitations

| Constraint Type   | Description                               | Impact on Implementation   |
| ----------------- | ----------------------------------------- | -------------------------- |
| Framework         | [e.g., React 17 - no concurrent features] | [How this limits approach] |
| Database          | [e.g., PostgreSQL 12, existing schema]    | [Schema constraints]       |
| API Compatibility | [e.g., Must maintain v1 endpoints]        | [Backward compat needs]    |
| Performance       | [e.g., Response time < 200ms]             | [Optimization needs]       |

### Technical Debt to Avoid

The following patterns are deprecated or problematic - do NOT use:

| Pattern       | Found In          | Why Avoid | Use Instead          |
| ------------- | ----------------- | --------- | -------------------- |
| [Old pattern] | `path/to/file.ts` | [Reason]  | [Preferred approach] |

### Areas Requiring Extra Caution

- **[Area 1]**: [Why it's fragile and what to watch for]
- **[Area 2]**: [Known issues or gotchas]

### Integration Requirements

| Existing Service | Integration Method | Notes                |
| ---------------- | ------------------ | -------------------- |
| [Service 1]      | [API/Import/Event] | [Auth, format, etc.] |

### Downstream Dependencies

Code that depends on areas we're modifying:

- `path/to/dependent.ts:45` - [What it depends on]
- `path/to/consumer.ts:123` - [What it expects]

### Brownfield Checklist

Before modifying existing code:

- [ ] Understand current behavior (read and trace code flow)
- [ ] Document what must NOT change (protected boundaries)
- [ ] Identify downstream dependencies
- [ ] Add characterization tests if modifying complex logic
- [ ] Plan rollback strategy for risky changes

---

## Open Questions

- [ ] [Question needing user input]
- [ ] [Another question]

## Recommendations

1. [Key recommendation for implementation]
2. [Another recommendation]
