---
feature: '{{feature-name}}'
created: '{{ISO-timestamp}}'
workflowProfile: enterpriseai
status: draft
---

# UI Preview Brief: {{feature-name}}

## Goal

- **Smallest useful MVP to show first**: {{mvp-slice}}
- **Primary users**: {{users}}
- **Workflow goal**: {{workflow-goal}}

## Preview Scope

| Area                                      | Requirement      |
| ----------------------------------------- | ---------------- |
| Must-have screens                         | {{screens}}      |
| Must-have interactions                    | {{interactions}} |
| Explicitly out of scope for first preview | {{out-of-scope}} |

## Fast Preview Runtime

- **Preview command**:
  {{preview-command-or-url, prefer ./run.sh dev 3001 or run.bat dev 3001}}
- **Primary preview URL**: {{preview-url}}
- **Browser target**: integrated browser when the host app supports it;
  otherwise open the system browser.
- **Runner rule**: use the repo runner when it exists. Do not use direct
  `npm run dev`, `next dev`, or package-manager preview commands when `run.sh`,
  `run.bat`, or `run.ps1` exists.
- **macOS / Linux / Codespaces runner**:

  ```bash
  ./run.sh dev 3001
  ```

- **Windows runner**:

  ```bat
  run.bat dev 3001
  ```

- **Change trigger**: after every UI-facing change to page layout, component
  choice, theme, copy, data binding, or interaction behavior, run:

  ```bash
  node .specify/scripts/node/gofer-ui-preview.mjs --feature-dir {{feature-dir}} --command "./run.sh dev 3001" --open auto --screenshot --change "{{change-summary}}"
  ```

- **Windows change trigger**:

  ```bat
  node .specify/scripts/node/gofer-ui-preview.mjs --feature-dir {{feature-dir}} --command "run.bat dev 3001" --open auto --screenshot --change "{{change-summary}}"
  ```

- **Existing server fallback**:

  ```bash
  node .specify/scripts/node/gofer-ui-preview.mjs --feature-dir {{feature-dir}} --url {{preview-url}} --open auto --screenshot --change "{{change-summary}}"
  ```

- **Ready-to-show definition**: local URL opened, screenshot captured or a clear
  Playwright/browser limitation recorded, self-review notes appended to
  `ui-review-log.md`, and known visual risks called out before asking the user
  for feedback.

## Package Profile

| Field                   | Decision                                                             |
| ----------------------- | -------------------------------------------------------------------- |
| Profile choice          | {{external-internal-hybrid}}                                         |
| Package lane            | {{public-package-internal-app-hybrid-adapter-app-local}}             |
| Coupling status         | {{source-platform-coupled-source-platform-decoupled-hybrid-adapter}} |
| Public-readiness target | {{required-deferred-not-applicable}}                                 |

## EAI App Template Constraints

| Constraint                    | Decision                                          |
| ----------------------------- | ------------------------------------------------- |
| Default layout / blocks       | {{selected-template-blocks}}                      |
| Block catalog evidence        | {{eai-blocks-list-and-describe-evidence}}         |
| Resource bindings             | {{eai-resources-schema-bindings}}                 |
| Storybook story IDs           | {{storybook-story-ids-or-exceptions}}             |
| Theme override points         | {{theme-presentation-copy-data-action-overrides}} |
| Allowed create-new exceptions | {{shown-exceptions-or-none}}                      |
| Accessibility baseline        | {{expectation}}                                   |

## Block Porting And source platform Decoupling

| Block ID     | Package Lane | Storybook Story ID | Coupling Status | Porting Decision                | Theme Override Points     | Custom-Block Exception  |
| ------------ | ------------ | ------------------ | --------------- | ------------------------------- | ------------------------- | ----------------------- |
| {{block-id}} | {{lane}}     | {{story-id-or-na}} | {{status}}      | Reuse / Port / Custom Exception | {{tokens-slots-css-vars}} | {{none-or-review-path}} |

## Branding Inputs

| Input                | Status              |
| -------------------- | ------------------- |
| Logo / marks         | {{provided-or-not}} |
| Colors / styling     | {{provided-or-not}} |
| Voice / copy tone    | {{provided-or-not}} |
| Corporate references | {{provided-or-not}} |

## Preview Validation Before Presentation

- [ ] Local render proof captured
- [ ] Screenshot or Playwright-style self-review captured
- [ ] Preview opened in an integrated or external browser with
      `gofer-ui-preview.mjs`
- [ ] `ui-review-log.md` records every UI-facing change since the previous user
      review
- [ ] Brief-to-preview mismatch list recorded
- [ ] Open visual risks called out before stakeholder review
