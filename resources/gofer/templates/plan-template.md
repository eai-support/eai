# Implementation Plan: [FEATURE]

**Branch**: `[###-feature-name]` | **Date**: [DATE] | **Spec**: [link]
**Input**: Feature specification from
`.specify/specs/[###-feature-name]/spec.md`

**Note**: This template is filled in by `/3_gofer_plan` (or legacy
`/3_gofer_plan`). Recommended: Use `/0_business_scenario` to auto-chain the
entire pipeline.

## Summary

[Extract from feature spec: primary requirement + technical approach from
research]

## Technical Context

<!--
  ACTION REQUIRED: Replace the content in this section with the technical details
  for the project. The structure here is presented in advisory capacity to guide
  the iteration process.
-->

**Language/Version**: [e.g., Python 3.11, Swift 5.9, Rust 1.75 or NEEDS
CLARIFICATION]  
**Primary Dependencies**: [e.g., FastAPI, UIKit, LLVM or NEEDS CLARIFICATION]  
**Storage**: [if applicable, e.g., PostgreSQL, CoreData, files or N/A]  
**Testing**: [e.g., pytest, XCTest, cargo test or NEEDS CLARIFICATION]  
**Target Platform**: [e.g., Linux server, iOS 15+, WASM or NEEDS CLARIFICATION]
**Project Type**: [single/web/mobile - determines source structure]  
**Performance Goals**: [domain-specific, e.g., 1000 req/s, 10k lines/sec, 60 fps
or NEEDS CLARIFICATION]  
**Constraints**: [domain-specific, e.g., <200ms p95, <100MB memory,
offline-capable or NEEDS CLARIFICATION]  
**Scale/Scope**: [domain-specific, e.g., 10k users, 1M LOC, 50 screens or NEEDS
CLARIFICATION]

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

[Gates determined based on constitution file]

## Project Structure

### Documentation (this feature)

```text
.specify/specs/[###-feature]/
├── spec.md              # Feature specification (/2_gofer_specify)
├── research.md          # Codebase research (/1_gofer_research)
├── journeys/
│   └── base-journey.md  # AI-augmented app journey when app delivery applies
├── plan.md              # This file (/3_gofer_plan)
├── data-model.md        # Data model design (/3_gofer_plan)
├── quickstart.md        # Quick start guide (/3_gofer_plan)
├── contracts/           # API contracts (/3_gofer_plan)
├── tasks.md             # Task breakdown (/4_gofer_tasks)
└── issues.md            # GitHub issues (/4_gofer_tasks)
```

### Source Code (repository root)

<!--
  ACTION REQUIRED: Replace the placeholder tree below with the concrete layout
  for this feature. Delete unused options and expand the chosen structure with
  real paths (e.g., apps/admin, packages/something). The delivered plan must
  not include Option labels.
-->

```text
# [REMOVE IF UNUSED] Option 1: Single project (DEFAULT)
src/
├── models/
├── services/
├── cli/
└── lib/

tests/
├── contract/
├── integration/
└── unit/

# [REMOVE IF UNUSED] Option 2: Web application (when "frontend" + "backend" detected)
backend/
├── src/
│   ├── models/
│   ├── services/
│   └── api/
└── tests/

frontend/
├── src/
│   ├── components/
│   ├── pages/
│   └── services/
└── tests/

# [REMOVE IF UNUSED] Option 3: Mobile + API (when "iOS/Android" detected)
api/
└── [same as backend above]

ios/ or android/
└── [platform-specific structure: feature modules, UI flows, platform tests]
```

**Structure Decision**: [Document the selected structure and reference the real
directories captured above]

## AI-Augmented App Journey

For application delivery, the plan must preserve the four-step-or-fewer
AI-augmented journey from `journeys/base-journey.md`. For non-app work, state
why no app journey is required.

| Step | Business Goal | AI Assistance | Architecture Implication | Validation |
| ---- | ------------- | ------------- | ------------------------ | ---------- |
| 1    | [goal]        | [assist]      | [component/API/data]     | [test]     |
| 2    | [goal]        | [assist]      | [component/API/data]     | [test]     |
| 3    | [goal]        | [assist]      | [component/API/data]     | [test]     |
| 4    | [goal]        | [assist]      | [component/API/data]     | [test]     |

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation                  | Why Needed         | Simpler Alternative Rejected Because |
| -------------------------- | ------------------ | ------------------------------------ |
| [e.g., 4th project]        | [current need]     | [why 3 projects insufficient]        |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient]  |

## EnterpriseAI Profile Metadata

> Populated by default for EnterpriseAI runs. Standard-profile runs leave this
> section empty only when the user explicitly opts out.

- **EAI CLI Version Pin**: `[major.minor, e.g. 2.0]` — the installed `eai-cli`
  version is recorded here at plan generation time. Deployment tasks reference
  this pin to prevent drift between local and CI environments.
- **Vertical Template Reference**: `[vertical-template tag or SHA]`
- **Deployment Repo Reference**: `[deployment-repo tag or SHA]`
