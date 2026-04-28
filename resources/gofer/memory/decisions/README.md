# Architectural Decision Records (ADRs)

This directory contains Architectural Decision Records (ADRs) that document
significant design decisions made during feature implementation.

## Purpose

ADRs capture the context, decision, and consequences of architectural choices.
They serve as:

1. **Historical record** - Why decisions were made
2. **Onboarding resource** - Help new contributors understand the codebase
3. **Conflict resolution** - Authoritative reference for disputed approaches
4. **Learning repository** - Avoid repeating past mistakes

## File Naming Convention

```
NNN-short-topic-description.md
```

Where:

- `NNN` is a sequential 3-digit number (001, 002, 003...)
- `short-topic-description` is a lowercase, hyphenated summary

Examples:

- `001-authentication-strategy.md`
- `002-database-migration-approach.md`
- `003-api-versioning-scheme.md`

## Template

Each ADR should follow this structure:

```markdown
---
id: NNN
title: [Decision Title]
status: [proposed | accepted | deprecated | superseded]
date: [ISO date]
feature: [Feature Name or "project-wide"]
supersedes: [ID of superseded ADR, if any]
superseded_by: [ID of new ADR, if this one is superseded]
---

# [Decision Title]

## Context

[What is the issue that we're seeing that is motivating this decision or
change?]

## Decision

[What is the change that we're proposing and/or doing?]

## Consequences

### Positive

- [What becomes easier or possible as a result of this change?]

### Negative

- [What becomes more difficult or impossible as a result of this change?]

## Alternatives Considered

1. **[Alternative 1]**
   - Description: [Brief description]
   - Rejected because: [Reason]

2. **[Alternative 2]**
   - Description: [Brief description]
   - Rejected because: [Reason]

## References

- [Links to related documents, issues, or discussions]
```

## Status Values

| Status       | Meaning                                        |
| ------------ | ---------------------------------------------- |
| `proposed`   | Under discussion, not yet accepted             |
| `accepted`   | Decision is in effect                          |
| `deprecated` | No longer recommended, but may still be in use |
| `superseded` | Replaced by a newer decision                   |

## When to Create an ADR

Create an ADR when:

- Choosing between multiple valid architectural approaches
- Making a decision that affects multiple components or features
- Establishing a new pattern or convention for the codebase
- Introducing a new technology or dependency
- Changing an existing architectural decision
- Making a tradeoff with significant consequences

Do NOT create an ADR for:

- Trivial implementation details
- Feature-specific decisions (document in feature's research.md instead)
- Temporary workarounds (use inline comments)
- Decisions already covered by existing conventions in CLAUDE.md

## Reviewing Decisions

Before implementing a feature, review existing ADRs to ensure:

1. Your approach aligns with accepted decisions
2. You're not unknowingly contradicting established patterns
3. Any conflicts are explicitly acknowledged and justified

## Updating Decisions

When a decision needs to change:

1. Do NOT modify the original ADR
2. Create a new ADR with status `accepted`
3. Update the old ADR's status to `superseded`
4. Add `superseded_by` reference to the old ADR
5. Add `supersedes` reference to the new ADR

This preserves the historical record and reasoning.
