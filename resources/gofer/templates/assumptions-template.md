---
feature: '{{feature-name}}'
created: '{{ISO-timestamp}}'
last-reviewed: '{{ISO-timestamp}}'
status: active
---

# Assumptions Register: {{feature-name}}

## Overview

This document tracks all assumptions made during the development of
{{feature-name}}. Assumptions are identified during problem validation,
research, specification, and implementation. Each assumption is tracked through
its lifecycle.

## Status Legend

| Status           | Meaning                                    | Action Required        |
| ---------------- | ------------------------------------------ | ---------------------- |
| VALIDATED        | Confirmed true through evidence            | None                   |
| UNVALIDATED      | Assumed true, not yet checked              | Verify before launch   |
| DISPROVEN        | Found to be false                          | Spec revision needed   |
| PARTIALLY_VALID  | True under some conditions only            | Scope adjustment       |

## Critical Assumptions (High Risk)

These assumptions, if wrong, would significantly impact the solution:

| ID  | Assumption | Type       | Status      | Evidence           | Impact if Wrong      |
| --- | ---------- | ---------- | ----------- | ------------------ | -------------------- |
| A1  | {{text}}   | Business   | UNVALIDATED | {{source-or-none}} | {{impact-statement}} |
| A2  | {{text}}   | Technical  | UNVALIDATED | {{source-or-none}} | {{impact-statement}} |

## Business Assumptions

| ID   | Assumption | Status      | Evidence | Added During      |
| ---- | ---------- | ----------- | -------- | ----------------- |
| BA1  | {{text}}   | UNVALIDATED | —        | Problem Validation|
| BA2  | {{text}}   | UNVALIDATED | —        | Discovery         |

## Technical Assumptions

| ID   | Assumption | Status      | Evidence | Added During |
| ---- | ---------- | ----------- | -------- | ------------ |
| TA1  | {{text}}   | UNVALIDATED | —        | Research     |
| TA2  | {{text}}   | UNVALIDATED | —        | Planning     |

## User Behavior Assumptions

| ID   | Assumption | Status      | Evidence | Added During   |
| ---- | ---------- | ----------- | -------- | -------------- |
| UA1  | {{text}}   | UNVALIDATED | —        | Discovery      |

## Data Assumptions

| ID   | Assumption | Status      | Evidence | Added During |
| ---- | ---------- | ----------- | -------- | ------------ |
| DA1  | {{text}}   | UNVALIDATED | —        | Research     |

## Regulatory Assumptions

| ID   | Assumption | Status      | Evidence | Added During      |
| ---- | ---------- | ----------- | -------- | ----------------- |
| RA1  | {{text}}   | UNVALIDATED | —        | Problem Validation|

## Disproven Assumptions (Action Log)

| ID  | Assumption | Disproven When | Evidence Against     | Affected Specs    | Corrective Action    | Status    |
| --- | ---------- | -------------- | -------------------- | ----------------- | -------------------- | --------- |
| —   | —          | —              | —                    | —                 | —                    | —         |

## Validation Schedule

| Assumption ID | Verify By     | Method                  | Owner       |
| ------------- | ------------- | ----------------------- | ----------- |
| A1            | Before coding | {{verification-method}} | {{who}}     |
| A2            | During testing| {{verification-method}} | {{who}}     |

## Review History

| Date           | Reviewer | Changes Made              |
| -------------- | -------- | ------------------------- |
| {{ISO-date}}   | Claude   | Initial assumption capture|
