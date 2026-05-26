---
feature: 001-cli-consolidation
created: 2026-03-09T11:00:00Z
status: complete
sources:
  - docs/research.md (10 developer scenarios, competitive analysis, CLI design)
  - trialportal/.specify/specs/_archive/vertical-delivery-pipeline/ (Platform SDK, skills, CLAUDE.md)
  - trialportal/.specify/specs/_archive/vertical-template-platform-alignment-final/ (template cleanup, validated)
  - trialportal/.specify/specs/_archive/001-vertical-builder-v1/ (Object Type seeding via orchestrate)
  - trialportal/.specify/specs/_archive/vertical-onboarding-architecture/ (migration patterns for existing verticals)
  - trialportal/.specify/specs/nextsteps/spec.md (master roadmap)
---

# Research: CLI Consolidation & Org Migration

## What This Consolidates

9 feature specs from the trialportal repo, distilled to what matters for the CLI:

| Spec | Key Takeaway for CLI |
|------|---------------------|
| vertical-delivery-pipeline | Platform SDK in `packages/platform-sdk/`, 8 Claude Code skills, CLAUDE.md as contract, SSE streaming proxy, seeding utility |
| vertical-template-platform-alignment-final | Template repo is clean (889 lines deleted, DAISY refs removed, 100/100 validated) |
| 001-vertical-builder-v1 | Object Type seeding via `/v3/orchestrate` with `target_backend: "payload"` — the same flow CLI's `eai types seed` uses |
| vertical-onboarding-architecture | Migration patterns for existing verticals (CouncilDash, ad-compliance, demo-iom, civica-crm) |
| nextsteps | NS3 = vertical onboarding (59 tasks), NS5 = Platform SDK validation |
| docs/research.md | 10 developer scenarios, competitive CLI analysis, IP protection strategy |

## Org Migration

The Vertical-Template repo has moved from `enterpriseaigroup` to `eai-tools`:
- **Old**: previous EnterpriseAI vertical template repo URL
- **New**: `https://github.com/eai-tools/eai-app-template`

All CLI references to `enterpriseaigroup` that relate to the template must update to `eai-tools`.

## Current CLI State (v0.1.0)

17 source files, 14 commands, fully functional. Builds and runs. Tested against Vertical-Template (`eai doctor`, `eai types validate` both work).

### Known Issues

1. **Template URL hardcoded to old org** — `init.ts:17` references `enterpriseaigroup`
2. **GitHub org hardcoded to old org** — `init.ts:18` references `enterpriseaigroup`
3. **Object Types scaffold is minimal** — missing rich field type catalog and examples
4. **`.env.local` generation is basic** — missing Platform SDK env vars (`TENANT_KEYS`, etc.)
5. **Deploy workflow is basic** — doesn't include `build:object-types` step properly
6. **No CLAUDE.md generated** — init should generate a project-specific CLAUDE.md
7. **No Platform SDK reference** — CLI doesn't help with hook generation or data access patterns
8. **`eai types define` is a stub** — just prints "coming soon"
9. **Package name wrong** — uses `@enterpriseaigroup/cli`, should be `@eai-tools/cli`

## What the Vertical-Template Now Contains

After the vertical-delivery-pipeline and alignment-final specs were completed:

```
Vertical-Template/
├── packages/platform-sdk/          # Typed wrappers for PublicAPI
│   └── src/
│       ├── client.ts               # EAIPlatformClient factory
│       ├── types.ts                # Resource, Chat, Orchestration types
│       └── modules/                # resources, chat, documents, users, auth, orchestrate
├── src/
│   ├── eai.config/
│   │   ├── default.ts              # defineConfig() example
│   │   ├── object-types.ts         # 3 example types (Application, Document, Notification)
│   │   └── index.ts                # Config registry
│   ├── hooks/
│   │   ├── useResources.ts         # Generic CRUD hook
│   │   ├── useChat.ts              # Chat streaming hook
│   │   └── useDocuments.ts         # Document upload hook
│   ├── lib/platform/
│   │   ├── seed-object-types.ts    # Seeding utility
│   │   └── verify-platform.ts      # Connectivity checker
│   ├── app/api/eai/[[...rest]]/    # BFF proxy
│   └── app/api/eai/stream/         # SSE streaming proxy
├── scripts/
│   └── generate-object-types-json.mjs  # TS → JSON build step
├── .github/workflows/deploy-demo.yml   # Deployment workflow
└── CLAUDE.md                       # Platform contract documentation
```

## Key Design Decisions (Carried Forward)

1. **CLI calls PublicAPI directly** — no BFF proxy, uses Bearer token from device code flow
2. **IP protection by abstraction** — developers see resources/types/tenants, not orchestrator/OPA/JSONB
3. **TypeScript-first** — object-types.ts, eai.config.ts, not YAML/JSON
4. **Same commands, different targets** — `--env dev|staging|prod`
5. **Model C (Hybrid)** — real platform for data ops, local for UI dev
