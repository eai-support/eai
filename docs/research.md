# EAI Developer Experience & CLI Research

## Context

A vertical developer from a partner company needs to build custom applications on the EAI platform. Today this requires manual coordination: cloning a template, understanding undocumented API contracts, guessing at configuration, and relying on the Trial Portal for provisioning. We need a CLI (`eai`) that makes the "golden path" the path of least resistance — while protecting our IP (the storage architecture, OPA policies, OBO token chain, single-table JSONB design, dual-vector search internals).

This document synthesizes: (1) 10 developer scenarios, (2) current gaps, (3) competitive analysis of 10 platform CLIs, (4) CLI design, and (5) IP protection strategy.

---

## Part 1: Ten Developer Scenarios

### Scenario 1: Government Case Management (Council Planning Portal)
**Developer**: Full-stack JS dev at a government contractor
**Vertical**: Planning permit workflow — citizens submit applications, staff review/approve
**Object Types**: Application, Inspection, Certificate, Compliance, Document
**Needs**: Multi-role auth (citizen vs staff), document upload/classification, AI chat for permit guidance, PDF generation
**Pain today**: No idea how to define Object Types with actions/side-effects. No way to test locally against ResourceAPI. Tenant hierarchy (council → department) unclear.

### Scenario 2: Healthcare Patient Intake
**Developer**: React dev at a health-tech startup
**Vertical**: Patient intake and triage — patients fill forms, nurses route to specialists
**Object Types**: Patient, Encounter, Referral, Document, Assessment
**Needs**: Strict RBAC (patient sees own data, nurse sees ward, admin sees all), HIPAA-grade audit trail, real-time chat with AI triage
**Pain today**: No documentation on how OPA roles enforce data isolation. How do actions like "escalate" with `requiredRole: 'tenant-staff'` actually work? How to test role-based access locally?

### Scenario 3: Retail Inventory & Compliance
**Developer**: Backend-heavy dev at a retail chain
**Vertical**: Product compliance tracking — suppliers submit certificates, compliance team audits
**Object Types**: Product, Supplier, Certificate, AuditLog, ComplianceCheck
**Needs**: Cross-type queries (products linked to expired certificates), bulk import, scheduled actions
**Pain today**: QueryRequest with joins is undocumented in the template. How to do `from: 'Product', link_type: 'certificates', to: 'Certificate'` with a `where` filter on expiry date? No examples.

### Scenario 4: Education Course Management
**Developer**: Junior dev at an EdTech company, first time using the platform
**Vertical**: Online course management — instructors create courses, students enroll
**Object Types**: Course, Enrollment, Assignment, Submission, Grade
**Needs**: Simple CRUD, file uploads for assignments, AI-powered grading suggestions
**Pain today**: Onboarding takes days. Clone template → stare at 30+ files → don't know where to start. `.env.example` has placeholder values that don't work. No `eai init` wizard to guide setup.

### Scenario 5: Financial Services KYC
**Developer**: Security-conscious dev at a fintech
**Vertical**: Know Your Customer — identity verification, document validation, risk scoring
**Object Types**: Customer, IdentityDocument, VerificationResult, RiskAssessment, AuditTrail
**Needs**: Immutable audit logs, document OCR/classification, multi-step workflow actions, encryption at rest
**Pain today**: How does `getHistory()` work? Are history records immutable? How does the `json` property type handle nested structures? No schema validation examples.

### Scenario 6: Non-Profit Beneficiary Tracking (IOM-style)
**Developer**: Dev at an NGO with dual user bases
**Vertical**: Migration matching — beneficiaries track pathways, caseworkers manage cases
**Object Types**: 11 types across 2 tenant scopes (beneficiary portal + employee portal)
**Needs**: Dual-tenant auth, cross-tenant resource references, AI pathway matching, i18n
**Pain today**: This IS demo-iom. Pain was: Platform SDK contracts were wrong, no deployment workflow in template, dual-auth not supported by template, object-types.json seeding for multi-tenant was undocumented.

### Scenario 7: Real Estate Property Management
**Developer**: Full-stack dev at a property management company
**Vertical**: Tenant (rental) management — landlords list properties, tenants submit maintenance requests
**Object Types**: Property, Unit, Lease, MaintenanceRequest, Payment, Inspection
**Needs**: Relationship-heavy data model (Property → Unit → Lease → Tenant), scheduled inspections, document management for leases
**Pain today**: How do bi-directional links work? If I create a link from Property to Unit, does the reverse link exist automatically? (Answer: No, must be explicit.) No documentation on cardinality enforcement.

### Scenario 8: Manufacturing Quality Control
**Developer**: IoT/data dev at a manufacturer
**Vertical**: QC workflow — sensors flag anomalies, inspectors investigate, managers approve/reject
**Object Types**: ProductionLine, Batch, QualityCheck, Defect, CorrectiveAction
**Needs**: High-volume writes (sensor data), batch operations, real-time alerts, dashboard analytics
**Pain today**: No batch/bulk endpoints in ResourceAPI. No webhook/event system for real-time notifications. How to handle 1000+ resources per minute? What are ResourceAPI's throughput limits?

### Scenario 9: Legal Document Review
**Developer**: Dev at a LegalTech firm
**Vertical**: Contract review — upload contracts, AI extracts clauses, lawyers annotate
**Object Types**: Contract, Clause, Annotation, ReviewTask, ComplianceFlag
**Needs**: Heavy AI integration (document classification, RAG for case law, clause extraction), large file support, real-time collaboration
**Pain today**: Document classification workflow is opaque. What's the difference between `classify`, `classifyByUrl`, `ragIndex`, and `index`? When to use which? How does the AI chat use documents as context?

### Scenario 10: Supply Chain Logistics
**Developer**: Team of 3 devs at a logistics company, building their first EAI vertical
**Vertical**: Shipment tracking — carriers update status, dispatchers manage routes, customers view delivery
**Object Types**: Shipment, Route, Carrier, Warehouse, DeliveryProof
**Needs**: Multi-team collaboration on one vertical, CI/CD pipeline, staging environment, load testing
**Pain today**: No CI/CD template (deploy-demo.yml missing from template). No staging/preview environments. No guidance on team collaboration patterns. No way to run integration tests against a shared dev environment.

---

## Part 2: Current State Analysis

### What the Vertical-Template Provides Today

| Area | Status | Gap |
|------|--------|-----|
| Project structure | Good — clean Next.js 15 + App Router | Missing deploy-demo.yml workflow |
| Platform SDK | Good — typed wrappers for all endpoints | 3 contract bugs (now fixed in PR #3) |
| BFF proxy | Good — token injection, stream support | No local dev fallback |
| Auth | Good — Entra CIAM with JWT | Single-provider only (no dual-tenant) |
| Object Types | Good — TypeScript definitions + JSON generation | Seeding via API route only, no CLI |
| Config system | Good — defineConfig + tenant registry | Docs reference non-existent `tenants/` dir |
| Skills (Claude) | Partial — 2 of 8 implemented | 6 skills described but not implemented |
| Local dev | Broken — requires live PublicAPI | No mock/emulator mode |
| Deployment | Missing — no deploy-demo.yml | Must create manually |
| Testing | Minimal — Jest config only | No integration test patterns |
| Documentation | CLAUDE.md only | No developer portal or API reference |

### Critical Bugs Found

1. **`seed-object-types.ts`**: Constructs `EAIPlatformClient()` with no args — constructor requires `tenantId`
2. **`verify-platform.ts`**: Calls `response.ok` on parsed JSON (not a Response object)
3. **No `deploy-demo.yml`** in template — demo-iom had to create its own

### What's Missing for the 10 Scenarios

| Need | Current Support | Priority |
|------|----------------|----------|
| CLI scaffolding (`eai init`) | None | P0 |
| Local development against platform | None | P0 |
| Object Type seeding from CLI | API route only | P0 |
| Environment management | Manual `.env` | P1 |
| Deployment workflow template | Missing | P1 |
| API documentation portal | None | P1 |
| Multi-tenant auth template | Single-provider only | P1 |
| Integration testing patterns | None | P2 |
| Batch/bulk operations | Not in ResourceAPI | P2 |
| Webhook/event system | Not in platform | P3 |

---

## Part 3: Competitive Analysis (Key Insights)

### Best-in-Class Patterns from 10 Platform CLIs

| Pattern | Source | Relevance to EAI |
|---------|--------|-------------------|
| **`env pull`** — sync cloud config to local .env | Vercel | Bridges Azure App Config → local dev |
| **Database branching** — schema PRs with review | PlanetScale | Object Type versioning and review |
| **Full local stack** — Docker/emulators | Supabase, Firebase | Mock PublicAPI gateway for offline dev |
| **TypeScript-first definitions** — IntelliSense for config | Amplify Gen 2 | Already have this with `defineConfig()` |
| **Webhook forwarding** — `stripe listen --forward-to` | Stripe | Event forwarding for real-time testing |
| **TOML-driven config** — declarative, version-controlled | Shopify, Wrangler | `eai.config.toml` for deployment settings |
| **`--local`/`--remote` flags** — same command, different target | Wrangler | `eai seed --local` vs `eai seed --remote` |
| **Tunnel-based dev** — local code, cloud backend | Shopify | Connect local Next.js to live PublicAPI |
| **Personal sandboxes** — per-developer cloud env | Amplify Gen 2 | Per-developer tenant in Configurator |
| **Golden paths** — curated workflows, not mandates | Platform engineering best practices | Skills + CLI = golden path |

### Three Strategic Models for EAI

**Model A: Cloud-First (like Vercel/Amplify)**
- `eai dev` connects local Next.js to live PublicAPI via tunnel
- Env vars pulled from Azure App Config
- Seeding hits real Configurator
- Pros: Zero local setup, true parity
- Cons: Requires internet, cloud costs per developer

**Model B: Local Emulation (like Supabase/Firebase)**
- `eai dev` starts a mock gateway locally (Docker)
- Mock gateway implements `/v3/*` routes with in-memory storage
- Seeding stores Object Types locally
- Pros: Offline-capable, fast, no cloud dependency
- Cons: Parity gaps, maintenance overhead for mock

**Model C: Hybrid (like Stripe/Shopify) — RECOMMENDED**
- `eai dev` starts local Next.js with BFF proxy pointing to live PublicAPI
- `eai env pull` syncs config from Azure App Config to local `.env`
- `eai seed` pushes Object Types to real Configurator via PublicAPI
- `eai tunnel` (optional) creates Cloudflare tunnel for webhook testing
- Pros: Real platform, minimal local setup, works offline for UI
- Cons: Needs network for data operations

---

## Part 4: CLI Design — `eai`

### Design Principles

1. **The CLI is the documentation** — every command teaches the developer about the platform
2. **Protect IP by abstracting** — developers see `eai resources list`, not `POST /v3/orchestrate {target_backend: "payload"}`
3. **Golden path, not golden cage** — CLI does 80%, developers can eject to raw API calls
4. **TypeScript-first** — definitions, not YAML/JSON
5. **Same commands, different targets** — `--env dev|staging|prod` everywhere

### Command Tree

```
eai
├── init                          # Scaffold new vertical from template
├── dev                           # Start local development server
├── login                         # Authenticate with Entra CIAM
├── env
│   ├── pull                      # Sync cloud config → local .env
│   ├── push                      # Push local overrides → cloud (admin)
│   └── list                      # Show current environment variables
├── types
│   ├── define                    # Interactive Object Type builder
│   ├── validate                  # Validate object-types.ts against platform schema
│   ├── seed                      # Push Object Types to Configurator
│   ├── diff                      # Show diff between local and remote Object Types
│   └── pull                      # Pull remote Object Types → local TypeScript
├── tenant
│   ├── create                    # Create tenant in Configurator
│   ├── list                      # List tenants (scoped to parent)
│   └── info                      # Show tenant details + child hierarchy
├── resources
│   ├── list <type>               # List resources (paginated)
│   ├── get <type> <id>           # Get a single resource
│   ├── create <type>             # Create (opens $EDITOR or accepts --data)
│   ├── update <type> <id>        # Update (fetches current, opens diff)
│   ├── delete <type> <id>        # Delete
│   ├── query                     # Interactive cross-type query builder
│   └── schema                    # Show published Object Types for tenant
├── chat
│   ├── send <workflow> <stage>   # Send a single message
│   └── stream <workflow> <stage> # Stream a conversation (interactive terminal)
├── docs
│   ├── upload <file>             # Upload document
│   ├── classify <file>           # Classify document
│   └── index <id>                # Index for RAG
├── deploy
│   ├── setup                     # Generate deploy-demo.yml + GitHub secrets
│   ├── trigger                   # Trigger deployment workflow
│   └── status                    # Check deployment status
├── verify                        # Run platform connectivity checks
├── doctor                        # Diagnose common issues
└── whoami                        # Show auth status + tenant info
```

### Implementation: What the CLI Wraps (Hidden from Developer)

| CLI Command | What It Actually Does (HIDDEN) |
|-------------|-------------------------------|
| `eai types seed` | POST `/v3/orchestrate` with `target_backend: "payload"`, per-type upsert |
| `eai resources list` | GET `/v3/resources/{tenant}/{type}?page=&limit=` via BFF proxy |
| `eai chat stream` | POST `/v3/chat/stream/{tenant}/{workflow}/{stage}` with SSE parsing |
| `eai env pull` | `az appconfig kv list` + `az keyvault secret show` |
| `eai tenant create` | POST `/v3/orchestrate` with payload tenant creation |
| `eai deploy trigger` | `gh workflow run deploy-demo.yml` |

The developer never sees OBO tokens, orchestration requests, OPA policies, or RLS. They see resources, types, tenants, and chat.

---

## Part 5: IP Protection Strategy

### What We Expose (Public API Surface)

1. **Endpoint catalog**: `/v3/resources/*`, `/v3/chat/*`, `/v3/documents/*`, `/v3/orchestrate`
2. **Object Type schema format**: Property types, link types, actions, side effects
3. **Role hierarchy names**: `tenant-viewer`, `tenant-staff`, `tenant-admin` + what each can do
4. **Resource envelope**: `{ id, tenant_id, object_type, data, version, timestamps }`
5. **Pagination format**: `{ docs, totalDocs, page, limit, totalPages, hasNextPage, hasPrevPage }`
6. **Chat contract**: `{ message, conversation_id, params }` + SSE event types
7. **CLI commands and flags**: The interface, not the implementation

### What We Hide (Internal IP)

1. **Single-table JSONB design** — developers see typed resources, not the storage layer
2. **OPA Rego policies** — developers see the access matrix, not the policy source
3. **OBO token chain** — BFF proxy + PublicAPI handle this transparently
4. **Dual-vector HyPE search** — developers call `ragIndex()`, don't know about embedding strategy
5. **PostgreSQL RLS** — tenant isolation is invisible
6. **Object Type cache** — 5-min TTL with stale-on-error is transparent
7. **Orchestrator routing** — `target_backend` is abstracted behind typed SDK methods
8. **PayloadCMS as Configurator** — developers see "Object Types" and "Tenants", not PayloadCMS
9. **Action executor internals** — side effects are declared, execution is black-box
10. **Schema validator implementation** — type checking is transparent

### Documentation Architecture

```
Developer-Facing (Public)              Internal (Private)
─────────────────────────              ──────────────────
API Reference                          OPA Rego policies
  - Resource CRUD                      Single-table JSONB schema
  - Chat/Documents                     OBO token exchange flow
  - Object Type format                 ResourceAPI source code
Object Type Guide                      AICore dual-vector search
  - Field types                        PostgreSQL RLS setup
  - Actions & side effects             Action executor internals
  - Link types                         Object Type cache mechanics
Role & Permission Guide                Provider LLM routing
  - Role hierarchy                     Schema validator source
  - Access matrix                      PayloadCMS collection config
CLI Reference                          Configurator hooks/plugins
  - All commands + flags               Infrastructure Bicep templates
Getting Started Tutorial               Deployment pipeline internals
  - 15-minute quickstart
  - Build your first vertical
```

---

## Part 6: Implementation Roadmap

### Phase 1: Fix the Template (1-2 days)
- Fix `seed-object-types.ts` bug (no-args client)
- Fix `verify-platform.ts` bug (response.ok on JSON)
- Add `deploy-demo.yml` to template
- Fix CLAUDE.md references to non-existent `tenants/` directory
- Implement remaining 6 Claude Code skills

### Phase 2: Build `eai` CLI Core (DONE)
- `eai init` — interactive scaffolding with template selection
- `eai login` — Entra CIAM device code flow
- `eai env pull` — Azure App Config + Key Vault → `.env.local`
- `eai types seed` — Object Type upsert via PublicAPI
- `eai types validate` — local schema validation
- `eai verify` — platform connectivity check
- `eai doctor` — comprehensive diagnostics
- `eai whoami` — auth status display

### Phase 3: Build `eai` CLI Extended
- `eai types diff` — local vs remote comparison (DONE)
- `eai types pull` — remote → local TypeScript generation (DONE)
- `eai resources` — CRUD subcommands (DONE)
- `eai chat` — interactive chat testing (DONE)
- `eai deploy setup` — GitHub workflow + secrets (DONE)
- `eai deploy trigger` — workflow dispatch (DONE)
- `eai tenant create/list/info` (DONE)
- `eai types define` — interactive builder (TODO)

### Phase 4: Developer Portal
- Docusaurus site with guides
- Auto-generated API reference from OpenAPI spec
- Quickstart tutorial with `eai init` walkthrough

### Phase 5: Local Development Mode
- Mock gateway for offline development
- `eai dev --offline` with in-memory ResourceAPI mock
- Recorded fixtures for chat/document responses

---

## Gap Analysis: demo-iom Coverage

The CLI covers ~40-50% of what a complex vertical like demo-iom needs:

| Feature | CLI Coverage | Manual Work Needed |
|---------|-------------|-------------------|
| Project scaffold | 40% | Custom configs, i18n, test setup |
| Object Types seed/validate | 90% | Works with 11 types, 2 scopes |
| Env management | 60% | Multi-tenant variable patterns |
| Resource CRUD | 100% | Fully covered |
| Multi-tenant auth | 30% | Dual middleware, custom auth.ts |
| Custom BFF routes | 0% | 17+ domain-specific routes |
| Deployment | 40% | basePath, target-path customization |
| i18n | 0% | Complete gap |
| Testing | 0% | Complete gap |
| Config-driven UI | 20% | Store slices, layout definitions |

The CLI is the **platform operations layer** — types, resources, env, deploy. The **domain logic** (BFF routes, dual-tenant middleware, i18n, custom UI) is where the vertical developer adds value.
