# Feature Specification: [FEATURE NAME]

**Feature Branch**: `[###-feature-name]` **Created**: [DATE] **Status**: Draft
**Input**: User description: "$ARGUMENTS"

<!--
  This template is filled in by /2_gofer_specify (or legacy /2_gofer_specify).
  Recommended: Use /0_gofer_start to auto-chain the entire pipeline.
  Location: .specify/specs/[###-feature-name]/spec.md
-->

## Executive Summary

[Three to five plain-language bullets covering the user problem, target outcome,
highest-priority journey, success measure, and any decision still needed.]

## Branding And Presentation Requirements

For app delivery or stakeholder-heavy work, state whether company, client,
consulting-firm, co-branded, or neutral presentation is required. Link to
`.specify/memory/brand-profile.json` when available and identify any pending
brand approvals, logo constraints, confidentiality labels, or deck requirements.
If branding is not in scope, state `N/A`.

## Goal Ledger Alignment

Keep `.specify/specs/[###-feature-name]/goal-ledger.json` aligned with this
specification so downstream stages can detect objective drift and reopen the
right mini-loop automatically.

| Goal ID | Outcome   | Metric / Target   | Linked Stories | Linked Requirements |
| ------- | --------- | ----------------- | -------------- | ------------------- |
| G1      | [Outcome] | [Metric / target] | [US1]          | [FR-001, SC-001]    |

## User Scenarios & Testing _(mandatory)_

<!--
  IMPORTANT: User stories should be PRIORITIZED as user journeys ordered by importance.
  Each user story/journey must be INDEPENDENTLY TESTABLE - meaning if you implement just ONE of them,
  you should still have a viable MVP (Minimum Viable Product) that delivers value.

  Assign priorities (P1, P2, P3, etc.) to each story, where P1 is the most critical.
  Think of each story as a standalone slice of functionality that can be:
  - Developed independently
  - Tested independently
  - Deployed independently
  - Demonstrated to users independently
-->

### User Story 1 - [Brief Title] (Priority: P1)

[Describe this user journey in plain language]

**Why this priority**: [Explain the value and why it has this priority level]

**Independent Test**: [Describe how this can be tested independently - e.g.,
"Can be fully tested by [specific action] and delivers [specific value]"]

**Acceptance Scenarios**:

1. **Given** [initial state], **When** [action], **Then** [expected outcome]
2. **Given** [initial state], **When** [action], **Then** [expected outcome]

---

### User Story 2 - [Brief Title] (Priority: P2)

[Describe this user journey in plain language]

**Why this priority**: [Explain the value and why it has this priority level]

**Independent Test**: [Describe how this can be tested independently]

**Acceptance Scenarios**:

1. **Given** [initial state], **When** [action], **Then** [expected outcome]

---

### User Story 3 - [Brief Title] (Priority: P3)

[Describe this user journey in plain language]

**Why this priority**: [Explain the value and why it has this priority level]

**Independent Test**: [Describe how this can be tested independently]

**Acceptance Scenarios**:

1. **Given** [initial state], **When** [action], **Then** [expected outcome]

---

[Add more user stories as needed, each with an assigned priority]

### Edge Cases

<!--
  ACTION REQUIRED: The content in this section represents placeholders.
  Fill them out with the right edge cases.
-->

- What happens when [boundary condition]?
- How does system handle [error scenario]?

## Requirements _(mandatory)_

<!--
  ACTION REQUIRED: The content in this section represents placeholders.
  Fill them out with the right functional requirements.
-->

### Functional Requirements

- **FR-001**: System MUST [specific capability, e.g., "allow users to create
  accounts"]
- **FR-002**: System MUST [specific capability, e.g., "validate email
  addresses"]
- **FR-003**: Users MUST be able to [key interaction, e.g., "reset their
  password"]
- **FR-004**: System MUST [data requirement, e.g., "persist user preferences"]
- **FR-005**: System MUST [behavior, e.g., "log all security events"]

_Example of marking unclear requirements:_

- **FR-006**: System MUST authenticate users via [NEEDS CLARIFICATION: auth
  method not specified - email/password, SSO, OAuth?]
- **FR-007**: System MUST retain user data for [NEEDS CLARIFICATION: retention
  period not specified]

### Key Entities _(include if feature involves data)_

- **[Entity 1]**: [What it represents, key attributes without implementation]
- **[Entity 2]**: [What it represents, relationships to other entities]

## Application Classification & Journey

- **Mode**: [application delivery | non-app work]
- **Shared numbered stages preserved**: yes
- **Journey requirement**: [four-step AI-augmented journey | not applicable]
- **App stack policy**: [EAI Platform including app template first, Azure second
  | approved non-EAI exception | not applicable]

## Authentication Access Decision _(when authentication enters scope)_

Use `.specify/references/platform/eai-auth-access.md`. Ask the business owner
who may use the app before changing auth code.

- **Access scope**: [workspace-only (default) | platform-authenticated with
  explicit approval | not applicable yet]
- **Owner confirmation and rationale**: [answer and date; unanswered must not
  widen access]
- **Target workspace**: [safe reference; not the shared CIAM directory ID]
- **App permissions and data isolation**: [server-side rules; wider sign-in does
  not grant workspace data access]
- **Sign-in method**: [EAI sign-in | client SSO through EAI; confirmed
  separately]
- **SSO readiness**: [verified setup route and entitlement | blocked | not
  applicable]
- **Account continuity and recovery**: [membership preservation, rollback,
  emergency sign-in; no secrets]
- **Acceptance evidence**: [member, non-member, anonymous, cross-tenant,
  revoked, and unavailable membership checks]

## Capability Maturity & Validation Scope

Record only capabilities that matter to this feature. Use one state:
`not_applicable`, `planned`, `implemented`, `verified`, or `blocked`.

| Capability               | State   | Why it applies now | Evidence required now                                                | Trigger to re-open |
| ------------------------ | ------- | ------------------ | -------------------------------------------------------------------- | ------------------ |
| Local user journey       | [state] | [reason]           | [test or review]                                                     | [change]           |
| Browser preview          | [state] | [reason]           | [HTTP check and screenshot]                                          | [change]           |
| Authentication           | [state] | [reason]           | [provider, callback, sign-in, session, protected API, denied access] | [change]           |
| EAI Platform integration | [state] | [reason]           | [preflight and template evidence]                                    | [change]           |
| Deployment               | [state] | [reason]           | [deployment and smoke evidence]                                      | [change]           |

Do not mark a planned capability as failed. When a user changes scope, update
this table, `plan.md`, `tasks.md`, `traceability.md`, and validation scope
before work continues. Explain the effect in plain language.

## UI Preview & Show-And-Tell Loop _(application delivery only)_

- **First MVP preview**: [what must be shown first]
- **Profile choice**: [external / internal / hybrid]
- **Package lane**: [public-package / internal-app / hybrid-adapter / app-local]
- **Coupling status**: [source-platform-coupled / source-platform-decoupled /
  hybrid-adapter]
- **Public-readiness target**: [required / deferred / not applicable]
- **EAI App Template constraints**: [which selected blocks/patterns must be
  reused]
- **Block catalog evidence**: [`eai blocks list`, `eai blocks describe <id>`,
  selected block IDs, and any custom-block exception]
- **Resource bindings**: [`eai resources schema` fields/actions/events used by
  selected blocks]
- **Storybook story IDs**: [story IDs for reusable/ported blocks, or reviewed
  exception]
- **Theme override points**: [tokens, slots, CSS variables, data/action hooks]
- **Block porting and source-platform decoupling**: [reuse/port/custom decision
  and adapter/resource-schema boundary]
- **Branding scope**: [logos/styling in scope or not]
- **Preview validation requirement**: [screenshot, local render proof,
  Playwright-style checks]
- **Show-and-tell requirement**: [what must be shown, how quickly, and what
  artifact records user feedback]

## EnterpriseAI Service Fit _(application delivery only)_

- **Capability selection must happen**: after the first visible UI direction and
  before plan/tasks are considered complete
- **Evidence sources**: [`eai --describe`, `eai whoami`, `eai tenant select`,
  `eai resources schema`, `eai verify calls --format json`, or approved
  equivalent]
- **Decision states**: [accessible now | purchasable but unavailable now |
  unavailable without new platform work]
- **Non-EAI stack handling**: [not used | integration target | migration
  reference | approved exception with owner/expiry]

## Success Criteria _(mandatory)_

<!--
  ACTION REQUIRED: Define measurable success criteria.
  These must be technology-agnostic and measurable.
-->

### Measurable Outcomes

- **SC-001**: [Measurable metric, e.g., "Users can complete account creation in
  under 2 minutes"]
- **SC-002**: [Measurable metric, e.g., "System handles 1000 concurrent users
  without degradation"]
- **SC-003**: [User satisfaction metric, e.g., "90% of users successfully
  complete primary task on first attempt"]
- **SC-004**: [Business metric, e.g., "Reduce support tickets related to [X] by
  50%"]
