---
template: risk-heatmap
version: 1.0
preamble_min_words: 30
preamble_max_words: 200
---

# Risk Heatmap — {{FEATURE_NAME}}

<!-- preamble: ≥30 ≤200 words plain-language explanation of risk posture -->

This heatmap plots identified risks on two axes: how likely each risk is to
occur (x-axis) and the impact severity if it does (y-axis). Risks in the
upper-right quadrant — high likelihood and high impact — demand immediate
mitigation; they are the project's critical risks. Upper-left risks (low
likelihood, high impact) need contingency plans. Lower-right risks (high
likelihood, low impact) can often be accepted but monitored. Lower-left risks
are typically acceptable as-is. The narrative below the chart summarizes the top
quadrant and the active mitigation actions for each. The mitigation table
records who owns each mitigation and the trigger condition that would escalate
the risk. Pass-1 of the pipeline populates this from spec NFR/Out-of-Scope
sections; pass-2 replaces the top quadrant with the validation council's
findings.

## Quadrant Chart

```mermaid
quadrantChart
    title Risk Heatmap (Likelihood x Impact)
    x-axis Low Likelihood --> High Likelihood
    y-axis Low Impact --> High Impact
    quadrant-1 Critical Risk
    quadrant-2 Monitor Closely
    quadrant-3 Accept
    quadrant-4 Mitigate Soon
    {{RISK_1}}: [{{X1}}, {{Y1}}]
    {{RISK_2}}: [{{X2}}, {{Y2}}]
    {{RISK_3}}: [{{X3}}, {{Y3}}]
```

## Top-Quadrant Summary

{{SUMMARY}}

## Mitigations

| Risk       | Likelihood       | Impact       | Mitigation       | Owner       |
| ---------- | ---------------- | ------------ | ---------------- | ----------- |
| {{RISK_1}} | {{LIKELIHOOD_1}} | {{IMPACT_1}} | {{MITIGATION_1}} | {{OWNER_1}} |
| {{RISK_2}} | {{LIKELIHOOD_2}} | {{IMPACT_2}} | {{MITIGATION_2}} | {{OWNER_2}} |
| {{RISK_3}} | {{LIKELIHOOD_3}} | {{IMPACT_3}} | {{MITIGATION_3}} | {{OWNER_3}} |
