---
name: 8_gofer_branding
description: "Brand Gofer templates and stakeholder documents for a company or consulting-firm look and feel."
title: "Gofer Branding"
category: utility
surfaces:
  - claude
  - claude-mirror
  - copilot
  - vscode
  - codex
  - gemini
  - github-prompts
  - agents-skills
  - system-skills
aliases: [gofer:branding, gofer:brand-templates]
---
---
description:
  Create or update a repo-owned brand profile and apply it to Gofer document,
  deck, and stakeholder templates.
---

# Gofer Branding

## Application Classification And EAI Preflight

Before any EAI CLI, login, tenant, template, or app-enrollment action:

1. Classify the request as **EAI app delivery** or **non-application work** using
   the signals in `.specify/commands/0_gofer_start.md`.
2. If the request is EAI app delivery or ambiguous, continue directly into the
   EAI app delivery path. Do not ask for confirmation just because app delivery
   is inferred.
3. If the request is clearly non-application work, confirm once before taking
   the non-app path:
   - **"This looks like non-app work, so I will skip EAI tenant/app setup and
     continue the Gofer research/docs path. Is that right?"**
4. If the user confirms non-app, record the decision in the feature discovery or
   context bundle, do not run `eai whoami`, `eai tenant select`, `eai init`, or
   `/gofer:eai-first-run`, and continue the appropriate non-app pipeline path.
5. If the user says it is app work, switch to EAI app delivery and run EAI app
   preflight.
6. For EAI app delivery, treat durable delivery as EAI Platform delivery by
   default, with Azure second and every other stack only by explicit exception.
7. For EAI app delivery, run `eai whoami` and confirm the EAI CLI is installed,
   the user is logged in, and an active tenant is visible.
8. If app-delivery readiness is missing, stop and run `/gofer:eai-first-run` or
   ask the user to approve login/setup before continuing.
9. For EAI app delivery, do not continue into research, specification, planning,
   tasks, implementation, or validation until
   `.specify/specs/{feature}/eai-preflight.md` records login, tenant, template,
   app-readiness, and next-action evidence.
10. Do not write tokens, secrets, private tenant IDs, or local `.env` values into
    Gofer artifacts; record only product-safe readiness status and evidence.

## Token And Cost Policy
<!-- gofer:token-cost-policy:start -->

Before spawning agents, calling tools, or loading large files:

1. Treat `.specify/memory/gofer-model-policy.yaml` as the repo-owned source of truth for simple, medium, hard, and arbiter model routing. If it is missing, run `/gofer:bootstrap-workspace` before continuing.
2. Use the cheapest capable model first.
   - Claude: Haiku for scouting/extraction; Sonnet for normal implementation, synthesis, validation, and security; Opus for high-risk arbitration or release-critical failures.
   - Codex/OpenAI: GPT mini for simple coding; GPT nano only for locate/classify/summarize/mechanical work; GPT-5.3-Codex or flagship GPT for tool-heavy coding, architecture, and release-critical validation.
   - Gemini: Flash-Lite for cheap large-context scan/summarize; Flash for default research synthesis; Pro for large-context architecture or high-risk arbitration.
   - Copilot: prefer Auto for simple and default work; ask the user before choosing a paid/high-tier picker model for hard security, architecture, or release gates.
3. Keep raw tool output out of the main conversation context. Save stable findings to `.specify/specs/{feature}/context-bundle.md`, then work from summaries.
4. Use provider prompt/context caching only for stable, non-secret prefixes: Gofer scaffold, AGENTS/CLAUDE/Copilot instructions, constitution, repo map, stage contracts, and validation rubric.
5. Before continuing after large research, planning, implementation, or validation bursts, checkpoint the durable artifacts and compact/clear/resume context when the host supports it.
6. Escalate model tier only when a cheaper pass is low-confidence, contradictory, security-sensitive, or blocking release quality.
<!-- gofer:token-cost-policy:end -->

## Business-Friendly Progress Contract
<!-- gofer:business-progress:start -->

Default user-facing updates must be concise, business-level, and easy to scan.
Keep the technical work rigorous in artifacts, tests, logs, and code, but do
not lead with implementation jargon unless the user asks for it.

Use ASD-STE100 Simplified Technical English as the target writing standard for
all Gofer-authored chat, documents, commands, summaries, PR notes, error
guidance, and validation artifacts. ASD-STE100 is copyright and a trademark of
ASD; do not bundle the protected ASD dictionary and do not claim ASD
certification.

1. Explain progress as what is being connected, changed, checked, or fixed and
   why it matters to the business outcome.
2. Use the running build map: create or update
   `.specify/specs/{feature}/build-map.md` from
   `.specify/templates/build-map-template.md` for application delivery, and
   refer to its plain-language areas in progress updates.
3. When there is a problem, translate it into business impact, current status,
   next action, and what input or approval is needed. Keep raw stack traces,
   command logs, IDs, and acronyms out of chat unless asked.
4. If the user asks for technical depth, provide it on request and point to the
   durable artifact that contains the evidence.
5. Prefer a compact update shape:
   - `Working on`: the build-map area or stakeholder outcome
   - `Why it matters`: user/business impact
   - `Status`: done, checking, fixing, blocked, or needs decision
6. Use one action per instruction.
7. Keep instructions to 20 words or fewer where possible.
8. Use active voice unless the actor is unknown or not important.
9. Use simple verb forms: simple present, simple past, simple future,
   infinitive, or imperative.
10. Define acronyms on first use and use approved project terms.
11. Avoid idioms, marketing adjectives, vague praise, and hedging.
12. Use vertical lists for complex information and one topic per paragraph.
13. For errors, state what happened, why it matters, what to do next, and the
    exact safe command when one exists.
14. Do not remove technical validation, security checks, EAI preflights, tests,
   or loop evidence. This contract changes presentation, not engineering
   standards.
15. Before each user-facing reply, check that it leads with the business effect,
    uses concise simple language, and includes only useful technical detail.
16. If any check fails, rewrite the reply before sending it.
<!-- gofer:business-progress:end -->

## App Preview Runner Contract
<!-- gofer:app-preview-runner:start -->

For EAI app delivery, every UI preview must use the repo runner when it exists.

1. Use `./run.sh dev 3001` on macOS, Linux, and GitHub Codespaces.
2. Use `run.bat dev 3001` on Windows.
3. Use a different port only when the feature notes record the reason.
4. The runner must stop any process on the selected port before it restarts the app.
5. Do not use direct `npm run dev`, `next dev`, or package-manager preview commands when `run.sh`, `run.bat`, or `run.ps1` exists.
6. After every UI-facing change, run:
   - `node .specify/scripts/node/gofer-ui-preview.mjs --feature-dir {FEATURE_DIR} --command "./run.sh dev 3001" --open auto --screenshot --change "<change summary>"`
7. On Windows, use:
   - `node .specify/scripts/node/gofer-ui-preview.mjs --feature-dir {FEATURE_DIR} --command "run.bat dev 3001" --open auto --screenshot --change "<change summary>"`
8. If the runner is missing in an EAI app template repo, refresh the template before preview work continues.
<!-- gofer:app-preview-runner:end -->

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty).

---

## Purpose

Use this helper when a company, enterprise customer, consulting firm, or
delivery team wants Gofer outputs to look and read like their standard branded
materials.

This command updates repo-owned branding guidance and templates. It does not
change feature scope, acceptance criteria, architecture decisions, or validation
evidence.

---

## Safety Rules

1. Do not copy private brand guides, logos, screenshots, client names, tenant
   IDs, or internal marks into a public Gofer bundle.
2. In the public `eai-gofer` repo, ship only neutral placeholders and reusable
   template tokens.
3. In an initialized application repo, write company-specific values only to
   repo-local files the user approves.
4. If a logo or brand guide path is missing, mark it `pending` instead of
   inventing one.
5. If the user asks for a client or partner logo, ask for the approved asset
   path and usage permission before adding it.

---

## Brand Profile Contract

Create or update:

```text
.specify/memory/brand-profile.json
```

If the file is missing, start from:

```text
.specify/templates/brand/brand-profile-template.json
```

The profile MUST capture:

```json
{
  "organizationName": "",
  "documentAudience": "executive|technical|risk|delivery|mixed",
  "brandMode": "company|client|consulting-firm|co-branded|neutral",
  "logo": {
    "primaryPath": "",
    "secondaryPath": "",
    "usage": "header|cover|footer|none",
    "status": "approved|pending|not-applicable"
  },
  "colors": {
    "primary": "#000000",
    "secondary": "#ffffff",
    "accent": "#0f766e",
    "background": "#ffffff",
    "text": "#111827"
  },
  "typography": {
    "headingFont": "",
    "bodyFont": "",
    "monoFont": "",
    "baseSize": "11pt",
    "h1Size": "28pt",
    "h2Size": "18pt",
    "lineHeight": "1.35"
  },
  "layout": {
    "pageSize": "A4|Letter|16:9",
    "margins": "standard|compact|spacious",
    "headerText": "",
    "footerText": "",
    "confidentialityLabel": ""
  },
  "visualStyle": {
    "diagramTheme": "neutral|executive|technical|minimal",
    "mermaidTheme": "base|neutral|forest|dark",
    "marpThemePath": ".specify/templates/brand/marp-theme-template.css"
  },
  "review": {
    "owner": "",
    "approvedBy": "",
    "approvedAt": "",
    "sourceEvidence": []
  }
}
```

---

## Inputs To Discover

Search first, then ask only for missing decisions that block useful output:

- Existing brand files: `brand.json`, `brand.yaml`, `brand.md`, `brand-guide.*`,
  `style-guide.*`, `assets/brand/`, `docs/brand/`, `public/logo.*`.
- Company name, consulting firm name, client name, and co-branding preference.
- Logo paths and which logo is approved for cover, header, and footer usage.
- Primary, secondary, accent, background, and text colors.
- Heading, body, monospace fonts, and fallback fonts.
- Header/footer text, confidentiality label, copyright, and prepared-by line.
- Preferred artifact formats: Markdown, PDF, Marp deck, HTML, or VS Code
  preview.
- Audience defaults for Business Owner, CTO/Architecture, CISO/Risk, and
  Delivery documents.

If the user gives a plain-language request such as "make it look like a Big 4
consulting deck", create a tasteful neutral consulting-firm profile and clearly
state that no third-party brand identity is being copied.

---

## Template Targets

Apply the brand profile to template guidance for:

- `.specify/templates/stakeholder-comms-template.md`
- `.specify/templates/working-backwards-prfaq-template.md`
- `.specify/templates/business-owner-summary-template.md`
- `.specify/templates/cto-architecture-summary-template.md`
- `.specify/templates/ciso-security-summary-template.md`
- `.specify/templates/stakeholder-review-index-template.md`
- `.specify/templates/spec-template.md`
- `.specify/templates/plan-template.md`
- `.specify/templates/research-template.md`
- `.specify/templates/brand/marp-theme-template.css`

For feature-local documents, apply the profile to existing artifacts under:

```text
.specify/specs/{feature}/
```

Use headings, frontmatter, document preambles, Mermaid theme hints, Marp theme
references, footer/confidentiality text, and logo placeholders. Do not rewrite
approved technical content just to change tone.

---

## Execution Steps

### 1. Resolve Scope

Determine whether the user wants:

- **Global repo branding**: update `.specify/memory/brand-profile.json` and
  reusable templates.
- **Feature branding**: update one feature pack in `.specify/specs/{feature}/`.
- **Preview only**: show proposed changes without writing files.

If unclear, default to global repo branding plus no feature-content rewrite.

### 2. Build Or Update Brand Profile

1. Read existing `.specify/memory/brand-profile.json` if present.
2. Read `.specify/templates/brand/brand-profile-template.json`.
3. Merge discovered values with user-provided values.
4. Preserve existing approved values unless the user explicitly changes them.
5. Write `.specify/memory/brand-profile.json` only after reporting what will
   change.

### 3. Apply Template Guidance

Update templates so future generated documents know how to use the brand
profile:

- Add `brand-profile.json` as a source input where stakeholder-facing outputs
  are generated.
- Add a short `Branding And Presentation` section where missing.
- Reference the Marp theme for deck-like summaries.
- Keep Mermaid and markdown-table fallbacks readable in monochrome print.
- Keep every document's executive summary first.

### 4. Validate

Run these checks where applicable:

```bash
node -e "JSON.parse(require('fs').readFileSync('.specify/memory/brand-profile.json','utf8'))"
rg -n "api[_-]?key|secret|token|tenant|password" .specify/memory/brand-profile.json .specify/templates/brand
```

If Marp is available and a deck was changed:

```bash
npx marp --version
npx marp path/to/deck.md --preview=false --allow-local-files
```

Validation fails if:

- `brand-profile.json` is invalid JSON.
- Private credentials or tenant-specific secrets appear in the brand profile.
- A logo path is referenced as approved but does not exist.
- A generated stakeholder document lacks an executive summary.
- A diagram/deck becomes unreadable without the brand assets.

### 5. Report

End with:

```text
BRANDING UPDATED
Scope: global|feature|preview
Brand profile: .specify/memory/brand-profile.json
Templates touched: [list]
Pending approvals: [logos/fonts/colors/confidentiality text]
Validation: PASS|FAIL
Next suggested command: /7a_stakeholder_comms or /6_gofer_validate
```

---

## Decline Behavior

If the user does not want to provide brand details, keep the neutral Gofer brand
tokens and write only the generic profile. Do not block the core Gofer pipeline
because branding is incomplete.

## Local Settings Cleanup Contract
<!-- gofer:local-settings-cleanup:start -->

After any Gofer install, update, release refresh, or workspace bootstrap:

1. Archive stale Gofer command and skill entries before continuing.
2. Prefer the repo helper:
   - `node .specify/scripts/node/gofer-local-settings-cleanup.mjs --workspace . --apply --json`
3. If the repo helper is missing, use the stable plugin bundle helper:
   - macOS/Linux: `node ~/plugins/eai-gofer/.specify/scripts/node/gofer-local-settings-cleanup.mjs --workspace . --apply --json`
   - Windows: `node %USERPROFILE%\plugins\eai-gofer\.specify\scripts\node\gofer-local-settings-cleanup.mjs --workspace . --apply --json`
4. This cleanup covers old Claude, Codex, Copilot, Gemini, Grok, VS Code, desktop, and CLI command surfaces.
5. Do not remove the current public `eai` entrypoint.
6. Ask the user to refresh or restart the host command picker only after cleanup completes.
<!-- gofer:local-settings-cleanup:end -->