---
template: capability-heatmap
version: 1.0
preamble_min_words: 30
preamble_max_words: 200
---

# Capability Heatmap — {{FEATURE_NAME}}

<!-- preamble: ≥30 ≤200 words plain-language explanation of capability impact -->

This heatmap places each business capability the feature touches on two axes:
how mature the capability is today (x-axis) and how strategically valuable it is
to the organization (y-axis). Capabilities in the upper-right are mature and
high-value, suitable for optimization. Upper-left capabilities are strategically
important but lack maturity, indicating investment opportunity. Lower-right are
mature but low-value, candidates for deprecation. Lower-left are quick wins. Use
this view to align stakeholders on which capabilities deserve enhancement,
replacement, or rationalization through this feature. Each entry below the chart
records whether the capability is being touched, replaced, or extended, plus
context on why the placement is justified. Capability owners should be able to
read this without consulting the implementation plan and reach the same
conclusion about priority order.

## Quadrant Chart

```mermaid
quadrantChart
    title Capability Maturity vs Strategic Value
    x-axis Low Maturity --> High Maturity
    y-axis Low Value --> High Value
    quadrant-1 Strategic Investment
    quadrant-2 Optimize
    quadrant-3 Deprecate
    quadrant-4 Quick Wins
    {{CAPABILITY_1}}: [{{X1}}, {{Y1}}]
    {{CAPABILITY_2}}: [{{X2}}, {{Y2}}]
    {{CAPABILITY_3}}: [{{X3}}, {{Y3}}]
```

## Capabilities Table

| Capability       | Action       | Current Maturity | Strategic Value | Notes       |
| ---------------- | ------------ | ---------------- | --------------- | ----------- |
| {{CAPABILITY_1}} | {{ACTION_1}} | {{MATURITY_1}}   | {{VALUE_1}}     | {{NOTES_1}} |
| {{CAPABILITY_2}} | {{ACTION_2}} | {{MATURITY_2}}   | {{VALUE_2}}     | {{NOTES_2}} |
| {{CAPABILITY_3}} | {{ACTION_3}} | {{MATURITY_3}}   | {{VALUE_3}}     | {{NOTES_3}} |

## Action Legend

- **touch** — capability is consulted or read by the feature but not changed
- **extend** — capability gains new behaviour while existing behaviour is
  preserved
- **replace** — capability's existing behaviour is superseded by the feature
