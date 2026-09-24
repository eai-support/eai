---
feature: 342-governed-documentation-experience
plan: plan.md
status: in-progress
created: 2026-09-23
author: Enterprise AI
updated: 2026-09-24
---

# Tasks

Completed work is linked to merged pull requests. A checked task has merged
source and its stated local/CI validation; live Test evidence remains T008.

- [~] T001 Define cited-answer and no-answer contracts. Source contract is merged; Test contract proof remains T008.
- [x] T002 Create a versioned evaluation corpus and evaluator command. PR #347.
- [x] T003 Add Website rate limiting and privacy-safe telemetry. Website PRs #376 and #379.
- [x] T004 Add consented feedback and authorised Payload reporting. PR #346 and Website PR #378.
- [~] T005 Add Docs filters, recovery, and accessibility validation. UX is merged in PR #344; automated accessibility evidence remains T008.
- [x] T007 Add public read-only Docs MCP with allowlist tests. Website PR #380; live Test proof remains T008.
- [~] T008 Validate citations, latency, refusal, privacy, accessibility, and visuals in Test.
- [~] T009 Use same-origin hosted chat and canonical citation paths. Docs PR #356.
- [~] T010 Make deployed Docs assistant smoke mandatory for Dev, Test, and Prod. Website PR #381.
- [ ] T011 Merge generated Docs into the Website repository, deploy Dev and Test,
  then record live browser evidence before production promotion.
