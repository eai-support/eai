# Brownfield Analysis: {Feature Name}

## Constraints & Limitations

| Constraint Type | Description | Impact on Implementation |
|-----------------|-------------|--------------------------|
| Framework | | |
| Database | | |
| API Compatibility | | |
| Performance | | |

## Technical Debt to Avoid

| Pattern | Found In | Why Avoid | Use Instead |
|---------|----------|-----------|-------------|
| | | | |

## Areas Requiring Extra Caution

- **[Area 1]**: [Why it's fragile and what to watch for]
- **[Area 2]**: [Known issues or gotchas]

## Integration Requirements

| Existing Service | Integration Method | Notes |
|------------------|-------------------|-------|
| | | |

## Downstream Dependencies

Code that depends on areas we're modifying:

- `path/to/dependent.ts:45` - [What it depends on]
- `path/to/consumer.ts:123` - [What it expects]

## Checklist

Before modifying existing code:

- [ ] Understand current behavior (read and trace code flow)
- [ ] Document what must NOT change (protected boundaries)
- [ ] Identify downstream dependencies
- [ ] Add characterization tests if modifying complex logic
- [ ] Plan rollback strategy for risky changes
