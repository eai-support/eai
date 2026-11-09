---
feature: '{{feature-name}}'
created: '{{ISO-timestamp}}'
workflowProfile: enterpriseai
---

# UI Review Log: {{feature-name}}

## Fast Preview Contract

Every UI-facing change must add a row here before the agent reports the change
as complete. Prefer the repo-owned helper and repo runner:

```bash
node .specify/scripts/node/gofer-ui-preview.mjs --feature-dir {{feature-dir}} --command "./run.sh dev 3001" --open auto --screenshot --change "{{change-summary}}"
```

On Windows:

```bat
node .specify/scripts/node/gofer-ui-preview.mjs --feature-dir {{feature-dir}} --command "run.bat dev 3001" --open auto --screenshot --change "{{change-summary}}"
```

Use `--url {{preview-url}}` only when a server is already running. Do not use
direct `npm run dev` commands when `run.sh`, `run.bat`, or `run.ps1` exists.

| Time              | Change Trigger     | Command             | URL             | Browser Target        | Screenshot                   | Package Lane | Coupling Status     | Storybook Story IDs | Theme Override Points | Self-Review     | Stakeholder Feedback | User Feedback Applied | Open Issues |
| ----------------- | ------------------ | ------------------- | --------------- | --------------------- | ---------------------------- | ------------ | ------------------- | ------------------- | --------------------- | --------------- | -------------------- | --------------------- | ----------- |
| {{ISO-timestamp}} | {{change-summary}} | {{preview-command}} | {{preview-url}} | Integrated / External | {{screenshot-or-playwright}} | {{lane}}     | {{coupling-status}} | {{story-ids}}       | {{theme-overrides}}   | {{self-review}} | {{feedback}}         | {{applied}}           | {{open}}    |
