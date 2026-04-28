---
id: '000'
title: Use Architectural Decision Records for Design Decisions
status: accepted
date: '2025-01-11'
feature: project-wide
---

# Use Architectural Decision Records for Design Decisions

## Context

As Gofer evolves, design decisions are made during feature implementation.
Without a systematic way to record these decisions:

- Future contributors don't understand why things are built a certain way
- The same debates are repeated across features
- Inconsistent approaches emerge in different parts of the codebase
- Knowledge is lost when context windows are cleared or sessions end

## Decision

We will use Architectural Decision Records (ADRs) stored in
`.specify/memory/decisions/` to document significant design decisions.

Each ADR follows a standard template with:

- Frontmatter metadata (id, title, status, date, feature)
- Context explaining the problem
- Decision describing the solution
- Consequences listing positive and negative outcomes
- Alternatives considered with reasons for rejection

## Consequences

### Positive

- Decisions are discoverable and searchable
- New contributors can understand historical context
- Consistent approach across all features
- Enables learning from past decisions
- Integrates with Gofer pipeline validation step

### Negative

- Adds overhead to document decisions
- May create too many records if threshold is too low
- Requires maintenance as decisions become outdated

## Alternatives Considered

1. **Inline code comments**
   - Description: Document decisions in the code itself
   - Rejected because: Hard to discover, doesn't capture alternatives considered

2. **Feature-specific research.md only**
   - Description: Keep all decisions in feature research files
   - Rejected because: Project-wide decisions need a central location

3. **CLAUDE.md only**
   - Description: Put all decisions in CLAUDE.md
   - Rejected because: Would make CLAUDE.md too large and unfocused

## References

- [ADR GitHub organization](https://adr.github.io/)
- Gofer pipeline validation step (6_gofer_validate.md)
