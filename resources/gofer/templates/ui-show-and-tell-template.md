---
feature: '{{feature-name}}'
created: '{{ISO-timestamp}}'
workflowProfile: enterpriseai
status: active
---

# UI Show-and-Tell: {{feature-name}}

## Purpose

This file records what Gofer showed the user, how quickly it was shown, what
feedback came back, and what changed next. It is not release approval.

## Latest Preview

- **Preview reference**: {{preview-ref}}
- **Latest opened preview URL**: {{preview-url}}
- **Latest `gofer-ui-preview.mjs` run**: {{preview-helper-run-or-log-row}}
- **Screenshot / browser evidence**: {{screenshot-or-browser-evidence}}
- **Shown at**: {{timestamp}}
- **Shown by**: {{agent-or-user}}

## Show-and-Tell Loop

| Time              | Change Shown       | URL             | Screenshot / Browser Evidence | User Feedback           | Change Made Next        | Open UX Issues  |
| ----------------- | ------------------ | --------------- | ----------------------------- | ----------------------- | ----------------------- | --------------- |
| {{ISO-timestamp}} | {{change-summary}} | {{preview-url}} | {{evidence-path-or-note}}     | {{feedback-or-pending}} | {{next-change-or-none}} | {{open-issues}} |

## Design Constraints Being Preserved

- **EAI App Template baseline preserved**: {{yes-no}}
- **Selected profile choice**: {{external-internal-hybrid}}
- **Selected package lane**:
  {{public-package-internal-app-hybrid-adapter-app-local}}
- **Selected coupling status**:
  {{source-platform-coupled-source-platform-decoupled-hybrid-adapter}}
- **Storybook story IDs**: {{storybook-story-ids-or-exceptions}}
- **Theme override points**: {{theme-override-points}}
- **Create-new exceptions shown to user**: {{exceptions-or-none}}
- **Branding/logo scope shown**: {{branding-scope}}
- **Public-readiness target**: {{required-deferred-not-applicable}}

## Notes

- {{note}}
