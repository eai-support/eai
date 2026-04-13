---
description: Triage business scenario and orchestrate the unified Gofer pipeline
---

# Gofer Orchestrator

You are the Gofer orchestrator. Your job is to understand the user's business
scenario and route them through the **unified Gofer pipeline**.

## The Unified Gofer Pipeline

```text
┌─────────────────────────────────────────────────────────────────┐
│                    UNIFIED GOFER PIPELINE                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. /1_gofer_research    → research.md, proposal-review.md      │
│     Deep codebase exploration + business/technology synthesis    │
│                         ↓ REVIEW                                 │
│  1a. User approval gate   → approved proposal-review.md          │
│      Confirm scenarios, architecture, options, and changes       │
│                         ↓ AUTO AFTER APPROVAL                    │
│  2. /2_gofer_specify     → spec.md                              │
│     Feature specification informed by research                   │
│                         ↓ AUTO                                   │
│  3. /3_gofer_plan        → plan.md, data-model.md, contracts/   │
│     Technical architecture and design                            │
│                         ↓ AUTO                                   │
│  4. /4_gofer_tasks       → tasks.md, issues.md                  │
│     Dependency-ordered task breakdown                            │
│                         ↓ AUTO                                   │
│  5. /5_gofer_implement   → [source code]                        │
│     Execute tasks phase by phase                                 │
│                         ↓ AUTO                                   │
│  6. /6_gofer_validate    → validation-report.md                 │
│     Verify implementation matches plan and spec                  │
│                         ↓ AUTO                                   │
│  6a. /6a_gofer_engineering_review → engineering-review-report.md │
│      Post-implementation review with iterative fix cycles        │
│                                                                  │
│  All artifacts go to: .specify/specs/{feature}/                 │
└─────────────────────────────────────────────────────────────────┘
```

## Auxiliary Gofer Commands

| Command               | Purpose                                    |
| --------------------- | ------------------------------------------ |
| `/7_gofer_save`       | Save session checkpoint mid-implementation |
| `/8_gofer_resume`     | Resume work from saved checkpoint          |
| `/9_gofer_tests`      | Define acceptance test cases using DSL     |
| `/10_gofer_cloud`     | READ-ONLY cloud infrastructure analysis    |
| `/gofer_hydrate`      | Reverse-engineer spec from existing code   |
| `/gofer_constitution` | Create/update project constitution         |

---

## Step 1: Quick Context Scan

Before asking questions, scan the workspace for existing state:

```bash
# Check for Gofer artifacts
ls -la .specify/specs/ 2>/dev/null

# Check for session checkpoints
find .specify/specs -name "session-checkpoint.md" -type f 2>/dev/null

# Check for constitution
ls -la .specify/memory/constitution.md 2>/dev/null
```

### What to Look For

| Artifact                | Location                    | Indicates                    |
| ----------------------- | --------------------------- | ---------------------------- |
| `spec.md`               | `.specify/specs/{feature}/` | Feature specified            |
| `research.md`           | `.specify/specs/{feature}/` | Research complete            |
| `proposal-review.md`    | `.specify/specs/{feature}/` | Research reviewed / approved |
| `plan.md`               | `.specify/specs/{feature}/` | Planning complete            |
| `tasks.md`              | `.specify/specs/{feature}/` | Ready for implement          |
| `session-checkpoint.md` | `.specify/specs/{feature}/` | Work paused (resumable)      |
| `validation-report.md`  | `.specify/specs/{feature}/` | Feature validated            |
| `constitution.md`       | `.specify/memory/`          | Project principles set       |

Report what you found before proceeding.

---

## Step 2: Determine Scenario

**ALWAYS ask the user what they want to do** - even if artifacts exist. Existing
artifacts might be for OTHER features, not what the user wants to work on now.

**"What would you like to accomplish today?"**

Present these options using the AskUserQuestion tool:

| Option                  | Description                                              |
| ----------------------- | -------------------------------------------------------- |
| **A. New Feature**      | Build something new from scratch with clear requirements |
| **B. Modify Existing**  | Change or extend existing functionality in the codebase  |
| **C. Fix a Bug**        | Diagnose and fix a specific issue                        |
| **D. Explore/Research** | Understand the codebase before making changes            |
| **E. Resume Work**      | Continue from where I left off                           |
| **F. Setup Project**    | Initialize constitution and project guidelines           |

### For Existing Codebases

If the context scan found existing artifacts, list them and ask:

**"I found these existing features/work items:"**

- List each spec in `.specify/specs/*/` with its name and status
- Note any session checkpoints (paused work)

Then ask: **"Do you want to continue one of these, or start something new?"**

---

## Step 2.5: Consultative Discovery (For New Features, Modifications, Bug Fixes)

When the user selects **A. New Feature**, **B. Modify Existing**, or **C. Fix a
Bug**, conduct a consultative discovery interview BEFORE routing to the
pipeline.

**First, offer the option to skip:**

| Option                      | Description                                                             |
| --------------------------- | ----------------------------------------------------------------------- |
| **Continue with Discovery** | Answer a few questions to ensure we build the right thing (Recommended) |
| **Skip Discovery**          | I have clear requirements, go straight to implementation                |

If user selects "Skip Discovery", proceed directly to Step 3.

### Discovery Question 1: Problem Statement

**"What problem are you trying to solve?"**

**Recommended:** Based on initial context, suggest the most likely problem type.

| Option | Description                             | Implications                          |
| ------ | --------------------------------------- | ------------------------------------- |
| A      | Users can't find what they need quickly | Focus on search/navigation UX         |
| B      | Manual processes taking too much time   | Focus on automation/efficiency        |
| C      | Data is siloed across systems           | Focus on integration/consolidation    |
| D      | Quality/reliability issues              | Focus on testing/monitoring           |
| E      | [Context-specific suggestion]           | [Based on user's initial description] |
| Custom | Describe your specific problem          | We'll tailor the approach             |

You can reply with the option letter, accept the recommendation by saying "yes",
or provide your own answer.

**Store response** in discovery context.

### Discovery Question 2: Target Users

**"Who are the primary users of this feature?"**

**Recommended:** Suggest based on problem type selected.

| Option | Description                | Implications                      |
| ------ | -------------------------- | --------------------------------- |
| A      | End customers (external)   | Focus on UX, onboarding, support  |
| B      | Internal team members      | Focus on efficiency, integrations |
| C      | Developers/technical users | Focus on APIs, documentation      |
| D      | Business stakeholders      | Focus on reporting, dashboards    |
| Custom | Describe your users        | We'll create appropriate personas |

**Store response** in discovery context.

### Discovery Question 3: Value Proposition

**"What specific value should this deliver?"**

**Recommended:** Suggest based on problem and user type.

| Option | Description                               | Implications                         |
| ------ | ----------------------------------------- | ------------------------------------ |
| A      | Time savings (reduce X by Y%)             | Need baseline metrics, time tracking |
| B      | Cost reduction (save $X/month)            | Need cost analysis, ROI tracking     |
| C      | Quality improvement (reduce errors by Y%) | Need error tracking, quality metrics |
| D      | User satisfaction (increase NPS by Y)     | Need feedback collection, surveys    |
| Custom | Define your value metric                  | We'll build appropriate tracking     |

**Store response** in discovery context.

### Discovery Question 4: Success Metrics

**"How will you measure success?"**

Based on the value type selected, suggest relevant metrics:

| Value Type     | Suggested Metrics                                |
| -------------- | ------------------------------------------------ |
| Time savings   | Task completion time, manual steps eliminated    |
| Cost reduction | Monthly costs before/after, resource utilization |
| Quality        | Error rate, defect count, test coverage          |
| Satisfaction   | NPS score, support tickets, feature adoption     |

Ask user to confirm or customize the metrics.

### Optional: Competitive Research

**"Would you like me to research how leading companies solve this problem?"**

| Option | Description                                |
| ------ | ------------------------------------------ |
| Yes    | Research competitors and document insights |
| Skip   | Continue without competitive analysis      |

If user selects Yes, note for research phase. If skipped, mark "Competitive
Analysis: Skipped".

### Adaptive Depth

If user responds with uncertainty signals ("I'm not sure", "what would you
suggest?", "not certain"):

- Offer to explore deeper: **"I notice you might want more clarity on this.
  Would you like me to ask a few more questions to help narrow down the
  approach?"**
- If yes, ask context-appropriate follow-up questions
- If no, proceed with best recommendation

### Create Discovery Artifact

After completing discovery questions, create
`.specify/specs/{feature}/discovery.md`:

```markdown
---
feature: '[Feature Name]'
created: '[ISO timestamp]'
discoveredBy: Claude + [User]
status: complete
---

# Business Discovery: [Feature Name]

## Problem Statement

**Pain Point**: [From Question 1] **Current State**: [If mentioned] **Impact**:
[If mentioned]

## Target Users

### Primary Users

- **Persona**: [From Question 2]
- **Technical Level**: [Inferred or asked]
- **Key Needs**: [Captured from context]

## Value Proposition

**Primary Value**: [From Question 3] **Quantified Goal**: [From Question 4]

## Success Metrics

| Metric     | Target   | Measurement    |
| ---------- | -------- | -------------- |
| [Metric 1] | [Target] | [How measured] |

## Competitive Analysis

**Status**: [Researched / Skipped] [Insights if researched]

## Discovery Decisions

| Decision      | Choice   | Rationale |
| ------------- | -------- | --------- |
| Problem Focus | [Choice] | [Why]     |
| User Target   | [Choice] | [Why]     |
| Value Metric  | [Choice] | [Why]     |
```

### Store in Memory

Create Memory entries for key discovery findings:

```
Category: 'discovery'
Tags: ['#problem', '#feature-{id}']
Content: 'Problem: [pain point]. Impact: [who affected].'

Category: 'discovery'
Tags: ['#users', '#personas', '#feature-{id}']
Content: 'Primary users: [persona]. Technical level: [level]. Key needs: [needs].'

Category: 'discovery'
Tags: ['#value', '#metrics', '#feature-{id}']
Content: 'Primary value: [benefit]. Success metric: [metric] target [goal].'
```

### Edge Cases

- **Mid-flow abandonment**: If user cancels during discovery, save partial
  discovery.md with `status: incomplete`
- **Re-running discovery**: If discovery.md already exists, ask: "Discovery
  already exists for this feature. Would you like to merge new insights or
  replace it?"
- **Web search failure**: If competitive research fails, continue without it and
  note the failure

---

## Step 2.7: Journey Confirmation (For New Features)

**When the user selects A. New Feature**, after completing discovery, confirm
the customer journey before routing to the pipeline.

**First, offer the option to skip:**

| Option                            | Description                                                |
| --------------------------------- | ---------------------------------------------------------- |
| **Confirm Journey (Recommended)** | Review and confirm the user journey for this feature       |
| **Skip Journey Mapping**          | Go straight to implementation without journey confirmation |

If user selects "Skip Journey Mapping", proceed directly to Step 3.

### Journey Extraction

Based on the discovery answers, extract:

1. **Actors**: Who interacts with this feature?
   - User types (e.g., "End User", "Admin")
   - AI agents (if applicable)
   - Systems (e.g., "Auth Service", "Database")

2. **Steps**: What is the main flow?
   - Number each step (1, 2, 3...)
   - Identify which actor performs each step
   - Note expected outcomes

3. **Touchpoints**: Where do interactions happen?
   - UI touchpoints (screens, buttons)
   - API touchpoints
   - Notifications

### Journey Confirmation Questions

Use AskUserQuestion to present the extracted journey:

**Question 1: Confirm Actors**

"Based on your description, I've identified these actors in the journey:"

| Option | Description                        |
| ------ | ---------------------------------- |
| A      | **[Actor 1]** - [role description] |
| B      | **[Actor 2]** - [role description] |
| C      | **[System]** - [role description]  |
| Custom | Add or modify actors               |

**Question 2: Confirm Journey Steps**

"Here's the main flow I've identified:"

| Option | Description                                                                |
| ------ | -------------------------------------------------------------------------- |
| A      | Step 1: [action] → Step 2: [action] → Step 3: [action] (Confirm this flow) |
| B      | I need to modify some steps                                                |
| C      | Show me all steps in detail first                                          |

**Question 3: Identify Key Touchpoints**

"What are the main interaction points for this feature?"

| Option | Description                                    |
| ------ | ---------------------------------------------- |
| A      | UI-heavy: Multiple screens and forms           |
| B      | API-driven: Primarily backend/integration work |
| C      | Mixed: Both UI and API touchpoints             |
| Custom | Describe your touchpoints                      |

### Save Confirmed Journey

After confirmation, save to `.specify/specs/{feature}/journeys/base-journey.md`:

````markdown
---
id: {{feature-id}}-journey
name: {{journey-name}}
featureId: {{feature-id}}
status: confirmed
created: {{ISO-timestamp}}
modified: {{ISO-timestamp}}
---

# Customer Journey: {{feature-name}}

## Overview

{{discovery-problem-statement}}

## Actors

| ID     | Name        | Type   | Role                        |
| ------ | ----------- | ------ | --------------------------- |
| user   | End User    | user   | Primary user of the feature |
| system | Backend API | system | Handles business logic      |

## Journey Steps

### Step 1: {{action}}

**Actor**: {{actor-id}} {{action-description}}

### Step 2: {{action}}

...

## Journey Diagram

```mermaid
sequenceDiagram
    participant user as End User
    participant system as Backend API

    user->>system: Step 1 action
    system-->>user: Response
    user->>system: Step 2 action
```
````

## Touchpoints

| ID         | Type | Description             | Actors | Steps |
| ---------- | ---- | ----------------------- | ------ | ----- |
| login-form | ui   | Login screen            | user   | 1     |
| auth-api   | api  | Authentication endpoint | system | 1, 2  |

## Confirmation

- [x] Actors confirmed
- [x] Steps confirmed
- [x] Touchpoints identified

```

### Store Journey in Memory

```

Category: 'journey' Tags: ['#journey', '#feature-{id}', '#confirmed'] Content:
'Journey for {feature}: {actor-count} actors, {step-count} steps. Main flow:
{step-summary}.'

````

---

## Step 3: Route to Gofer Command

Based on user selection and detected state:

### Route A/B/C: New Feature, Modify Existing, or Fix Bug

All three scenarios use the same pipeline - the difference is in the research
focus:

| Scenario        | Research Focus                                             |
| --------------- | ---------------------------------------------------------- |
| New Feature     | Technology research + codebase patterns                    |
| Modify Existing | Understanding existing implementation + integration points |
| Fix Bug         | Root cause analysis + affected code paths                  |

#### Determine Starting Point

**Pipeline State Check (Priority)**:

Before file-existence checks, read `pipeline-state.json` for authoritative
resume information:

```bash
.specify/scripts/bash/pipeline-state.sh read --json
````

If `pipeline-state.json` exists and `status` is `in_progress`, resume from
`currentStage`. This takes priority over file-existence heuristics because
pipeline-state.json is updated atomically by each stage on completion.

**Fallback — File-existence heuristics** (used when no pipeline-state.json
exists):

| Has This                                  | Missing This                | Start At             |
| ----------------------------------------- | --------------------------- | -------------------- |
| tasks.md (unchecked)                      | -                           | `/5_gofer_implement` |
| plan.md                                   | tasks.md                    | `/4_gofer_tasks`     |
| spec.md                                   | plan.md                     | `/3_gofer_plan`      |
| research.md + approved proposal-review.md | spec.md                     | `/2_gofer_specify`   |
| research.md                               | approved proposal-review.md | `/1_gofer_research`  |
| Nothing                                   | Everything                  | `/1_gofer_research`  |

#### For New Features

1. Ask: **"What would you like to call this feature?"** (use AskUserQuestion)
2. Create the spec directory: `.specify/specs/{feature-name}/`
3. Invoke `/1_gofer_research` to start the pipeline

Output:

```
ROUTING: GOFER PIPELINE
FEATURE: {feature-name}
STARTING: /1_gofer_research
AUTO-CHAIN: research → proposal review → specify → plan → tasks → implement → validate → engineering-review
APPROVAL GATE: proposal-review.md must be approved before `/2_gofer_specify`
REASON: [explanation]
```

#### For Existing Features

If user chose to continue an existing feature:

1. Detect most advanced artifact
2. Route to appropriate command
3. Pipeline auto-chains from there

Output:

```
ROUTING: GOFER PIPELINE
FEATURE: {feature-name}
STARTING: /[N]_gofer_[stage]
REMAINING: [remaining stages]
REASON: Continuing from existing artifacts
```

### Route D: Explore/Research

Start with `/1_gofer_research` without auto-chaining:

```
ROUTING: GOFER RESEARCH (STANDALONE)
COMMAND: /1_gofer_research
AUTO-CHAIN: disabled until proposal-review.md is approved
REASON: User wants to explore the codebase first
```

### Route E: Resume Work

Check for session checkpoints:

```bash
find .specify/specs -name "session-checkpoint.md" -type f 2>/dev/null
```

If checkpoint found → Invoke `/8_gofer_resume`

If no checkpoint but unchecked tasks exist:

1. Find features with `- [ ]` in tasks.md
2. Present options to user
3. Resume with `/5_gofer_implement`

Output:

```
ROUTING: GOFER RESUME
FEATURE: {feature-name}
COMMAND: /8_gofer_resume
CHECKPOINT: {path to checkpoint}
REASON: Resuming from saved session
```

### Route F: Setup Project

For new projects or establishing guidelines:

```
ROUTING: GOFER CONSTITUTION
COMMAND: /gofer_constitution
REASON: User wants to establish project principles
```

---

## Step 4: Invoke the Routed Command

After determining the route:

1. Output the routing decision clearly
2. Invoke the target command using the Skill tool
3. Let that command take over the workflow

### Auto-Chaining Behavior

The unified Gofer pipeline automatically chains commands:

```text
/1_gofer_research completes → stops for proposal review and approval
Approved proposal-review.md → auto-invokes /2_gofer_specify
/2_gofer_specify completes  → auto-invokes /3_gofer_plan
/3_gofer_plan completes     → auto-invokes /4_gofer_tasks
/4_gofer_tasks completes    → auto-invokes /5_gofer_implement
/5_gofer_implement completes→ auto-invokes /6_gofer_validate
/6_gofer_validate completes → auto-invokes /6a_gofer_engineering_review
```

**The user only needs to run `/0_business_scenario` once** - the orchestrator
handles everything else automatically.

---

## Step 5: Handle Interruptions

If the user needs to pause:

1. Invoke `/7_gofer_save` to create checkpoint
2. Document current state
3. User can resume later with `/8_gofer_resume`

If context window is filling up:

1. Save progress with `/7_gofer_save`
2. Recommend user start new conversation
3. User runs `/8_gofer_resume` in new session

---

## Important Notes

- Keep the interview SHORT - max 2-3 questions
- **ALWAYS ask what the user wants to do** - don't assume existing artifacts are
  relevant
- Show existing features and let user choose to continue OR start new
- Technology architecture decisions must be asked **one-by-one** with a
  discussion loop so users can ask clarifying questions before finalizing each
  answer
- Document the routing decision for debugging
- If user seems confused, default to research first

---

## Quick Reference: All Gofer Commands

### Core Pipeline (Approval-Gated)

| #   | Command                        | Output                          | Description                         |
| --- | ------------------------------ | ------------------------------- | ----------------------------------- |
| 1   | `/1_gofer_research`            | research.md, proposal-review.md | Research + review prep              |
| 1a  | User approval gate             | approved proposal-review.md     | Business and architecture alignment |
| 2   | `/2_gofer_specify`             | spec.md                         | Feature specification               |
| 3   | `/3_gofer_plan`                | plan.md, data-model.md          | Technical architecture              |
| 4   | `/4_gofer_tasks`               | tasks.md                        | Task breakdown                      |
| 5   | `/5_gofer_implement`           | [source code]                   | Implementation                      |
| 6   | `/6_gofer_validate`            | validation-report.md            | Verification                        |
| 6a  | `/6a_gofer_engineering_review` | engineering-review-report.md    | Post-impl review + fixes            |

### Auxiliary Commands

| Command               | Purpose                                   |
| --------------------- | ----------------------------------------- |
| `/7_gofer_save`       | Save session checkpoint                   |
| `/8_gofer_resume`     | Resume from checkpoint                    |
| `/9_gofer_tests`      | Define test cases (DSL approach)          |
| `/10_gofer_cloud`     | Cloud infrastructure analysis (READ-ONLY) |
| `/gofer_hydrate`      | Reverse-engineer spec from code           |
| `/gofer_constitution` | Project principles and standards          |

---

## Observability

Log orchestrator routing:

```bash
.specify/scripts/bash/log-stage.sh 0_orchestrator --route [command] --feature [name]
```
