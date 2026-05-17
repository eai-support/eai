---
date: 2026-03-09T12:00:00Z
researcher: Claude
feature: 'CLI Packaging & World-Class Documentation Site'
status: complete
---

# Research: CLI Packaging & World-Class Documentation Site

## Feature Summary

Build a comprehensive packaging and distribution system for the EAI CLI, plus a world-class documentation site with 50+ developer scenarios across multiple coding languages. The documentation site should be the best CLI documentation site on the internet, explaining how to use the CLI and EnterpriseAI platform to build vertical business processes in a secure enterprise environment.

### Deliverables

1. **CLI Packaging & Distribution** — npm publishing, GitHub Releases, cross-platform installers
2. **Documentation Site** — World-class docs with guides, tutorials, API reference, interactive examples
3. **50 Developer Scenarios** — Industry verticals across healthcare, finance, government, retail, etc.
4. **Multi-Language Examples** — TypeScript, Python, C#, Java, Go, Rust showing CLI integration
5. **Organization Updates** — All references updated from old orgs to `eai-tools`
6. **Vertical Template Integration** — Updated references to `https://github.com/eai-tools/eai-app-template`

---

## Codebase Analysis

### Current State

The CLI is **fully implemented** with 12 command groups (30+ subcommands) covering scaffolding, auth, environment, types, resources, tenants, chat, docs, deploy, and diagnostics. Built with TypeScript (strict mode, ESM), Commander.js, chalk, ora, inquirer.

### Where to Implement

| Component | Location | Purpose |
|-----------|----------|---------|
| Package config | `package.json` | Add publishConfig, repository, homepage, bugs, license |
| CLI entry point | `src/index.ts` | Version management, update notifications |
| GitHub workflows | `.github/workflows/` | CI/CD, release automation, npm publish |
| Documentation site | `docs/` (new) | Docusaurus/Starlight site source |
| Developer scenarios | `docs/scenarios/` (new) | 50 scenario guides |
| Multi-lang examples | `docs/examples/` (new) | Language-specific examples |
| Homebrew tap | Separate repo or formula | macOS/Linux distribution |
| Org references | Multiple files | Update to eai-tools |

### Organization References Requiring Update

**CRITICAL (Affects Functionality):**

| File | Line(s) | Current Value | Should Be |
|------|---------|---------------|-----------|
| `src/lib/config.ts` | 96-97 | `@enterpriseaigroup/platform-sdk`, `@enterpriseaigroup/core` | `@eai-tools/platform-sdk`, `@eai-tools/core` |
| `src/commands/verify.ts` | 252 | `@enterpriseaigroup/platform-sdk` (node_modules check) | `@eai-tools/platform-sdk` |
| `src/commands/verify.ts` | 258 | `@enterpriseaigroup/platform-sdk` (error message) | `@eai-tools/platform-sdk` |
| `src/commands/init.ts` | 618 | `@enterpriseaigroup/platform-sdk` (generated CLAUDE.md example) | `@eai-tools/platform-sdk` |

**ALREADY CORRECT:**
- `package.json:2` — `@eai-tools/cli` ✓
- `README.md:10,16` — `@eai-tools/cli`, `eai-tools/eai` ✓
- `src/commands/init.ts:17-18` — `eai-tools/eai-app-template`, `eai-tools` ✓
- `.specify/README.md:62` — `eai-tools/eai-gofer` ✓

**AUTO-GENERATED (will regenerate):**
- `package-lock.json:2,8` — Still shows old name, regenerates on `npm install`

### Existing Patterns to Follow

#### Pattern 1: Command Registration

Found in: `src/index.ts:36-49`

```typescript
program.addCommand(initCommand);
program.addCommand(devCommand);
program.addCommand(loginCommand);
// Each command defined in src/commands/{name}.ts
```

#### Pattern 2: Output Formatting

Found in: `src/lib/output.ts:7-53`

Consistent use of symbols (✓ ✗ ⚠ →), chalk colors, ora spinners, and table formatting across all commands.

#### Pattern 3: API Client

Found in: `src/lib/api.ts:10-259`

`PlatformAPIClient` class with Bearer token auth, methods for orchestrate, resources, chat, documents, tenants, and users.

### Critical Gaps for Publishing

1. **No GitHub workflows** — No CI/CD, no release automation, no npm publish
2. **No publishConfig** — Missing npm registry config
3. **No repository/homepage/bugs fields** — Missing standard npm metadata
4. **License set to UNLICENSED** — Prevents public npm publish
5. **Version hardcoded in two places** — package.json and index.ts
6. **No templates directory** — Listed in "files" but doesn't exist
7. **No pre-publish validation** — No scripts to verify build/lint/test before publish
8. **No changelog** — No CHANGELOG.md or automated changelog generation

---

## Technology Decisions

### Decision 1: Documentation Site Generator — Starlight (Astro)

- **Choice**: Starlight (Astro)
- **Rationale**:
  - Exceptionally fast (Astro's partial hydration, zero JS by default)
  - Built-in search (Pagefind — no external dependency like Algolia)
  - Built-in dark mode, i18n support, sidebar navigation
  - Expressive Code for multi-language tabbed code blocks (perfect for our multi-language examples)
  - First-class GitHub Pages deployment
  - SEO-optimized out of the box with sitemaps
  - Growing rapidly in 2025-2026 as the modern choice for documentation
  - Lighter than Docusaurus (React), faster than VitePress (Vue)
  - Perfect for CLI documentation with its clean, focused design
- **Alternatives considered**:
  - **Docusaurus**: More mature but heavier (React-based), slower builds. Best for large teams with existing React ecosystem
  - **VitePress**: Fast but Vue-based, smaller ecosystem for docs
  - **Mintlify**: Beautiful but hosted (vendor lock-in), paid service
  - **Nextra**: Good but tied to Next.js ecosystem
  - **GitBook**: Hosted, limited customization for CLI-specific needs

### Decision 2: CLI Distribution Strategy

- **Choice**: Multi-channel distribution
  - **Primary**: npm global package (`npm install -g @eai-tools/cli`)
  - **Secondary**: GitHub Releases with pre-built binaries
  - **macOS/Linux**: Homebrew tap (`brew install eai-tools/tap/eai`)
  - **Windows**: Standalone installer via GitHub Releases
  - **Standalone**: Consider Bun compile for single-binary distribution (future)
- **Rationale**: Developer target audience already has Node.js. npm is lowest friction. GitHub Releases provides fallback. Homebrew for macOS developers who prefer it.
- **Alternatives considered**:
  - Bun compile for standalone binary (interesting but adds build complexity, consider Phase 2)
  - Chocolatey/Scoop for Windows (lower priority, most Windows devs use npm)
  - Docker-based distribution (unnecessary for a CLI tool)

### Decision 3: Release Automation

- **Choice**: GitHub Actions with semantic-release or changesets
  - Automated versioning from conventional commits
  - Automated npm publish on tag push
  - Automated GitHub Release with changelog
  - Automated Homebrew formula update
- **Rationale**: Conventional commits already mandated in AGENTS.md. Semantic versioning provides clear upgrade path. Full automation reduces human error.
- **Alternatives considered**:
  - Manual releases (error-prone, doesn't scale)
  - release-it (simpler but less ecosystem integration)

### Decision 4: Documentation Information Architecture

- **Choice**: Task-oriented architecture (inspired by Stripe, Vercel, GitHub CLI)
  - **Getting Started** — 5-minute quickstart, installation, authentication
  - **Guides** — Task-oriented workflows ("Build a healthcare vertical", "Set up CI/CD")
  - **Scenarios** — 50 industry-specific developer scenarios with code examples
  - **Command Reference** — Auto-generated from source, every flag documented
  - **Platform Concepts** — Object Types, tenants, resources, auth, AI features
  - **Examples** — Multi-language code examples (TypeScript, Python, C#, Java, Go, Rust)
  - **API Reference** — Platform API surface documentation
- **Rationale**: Best CLI doc sites (Stripe, Vercel, GitHub CLI) organize by developer workflow, not alphabetical command lists. Progressive disclosure keeps beginners from being overwhelmed.

### Decision 5: Multi-Language Example Strategy

- **Choice**: Show how to call the CLI and integrate with platform APIs from multiple languages
  - **TypeScript/JavaScript** — Primary (native, uses Platform SDK)
  - **Python** — requests/httpx for API calls, subprocess for CLI
  - **C#/.NET** — HttpClient for API, Process for CLI
  - **Java** — HttpClient for API, ProcessBuilder for CLI
  - **Go** — net/http for API, exec.Command for CLI
  - **Rust** — reqwest for API, Command for CLI
  - **Shell/Bash** — curl for API, direct CLI usage
- **Rationale**: Enterprise developers work in diverse language ecosystems. Show that the platform is language-agnostic while the CLI is the universal entry point.

---

## Competitive Analysis: What Makes Great CLI Docs

### Best Patterns from Top CLI Documentation Sites

| Pattern | Source | Application to EAI |
|---------|--------|---------------------|
| **Task-oriented IA** | Stripe CLI | Organize by workflow ("Build a vertical") not by command name |
| **Multi-tab code examples** | Vercel CLI | Show npm/yarn/pnpm/brew install options |
| **Sticky TOC** | Supabase CLI | Right-side navigation for long pages |
| **Workflow-based grouping** | Fly.io (flyctl) | Group commands by developer workflow phase |
| **Interactive API explorer** | ReadMe.com | Let developers try API calls from the docs |
| **Copy buttons on code blocks** | All modern docs | One-click code copying |
| **Expected output display** | Stripe CLI | Show terminal output alongside commands |
| **Progressive disclosure** | GitHub CLI | Start simple, link to advanced topics |
| **Search with autocomplete** | All top docs | Pagefind provides this in Starlight |
| **Color-coded alerts** | Vercel CLI | Info (blue), warning (yellow), danger (red) callouts |

### Documentation Anti-Patterns to Avoid

- Alphabetical command listings as primary navigation (use workflows instead)
- Missing expected output for commands
- No copy buttons on code blocks
- Requiring users to read entire pages before finding what they need
- Undocumented flags or options
- Stale examples that don't match current CLI version
- No search functionality
- Deep nesting (max 3 clicks from homepage)

---

## 50 Developer Scenarios — Categories

### Distribution Across 10 Industries (5 scenarios each)

| Industry | Focus Areas |
|----------|-------------|
| **Healthcare** | Patient intake, HIPAA compliance, clinical workflows, telehealth, pharmacy |
| **Finance** | KYC, transaction monitoring, loan processing, insurance claims, portfolio management |
| **Government** | Case management, planning permits, citizen services, compliance, inspections |
| **Retail** | Inventory management, compliance tracking, customer loyalty, supply chain, e-commerce |
| **Education** | Course management, student enrollment, grading, learning analytics, accreditation |
| **Real Estate** | Property management, lease tracking, maintenance, inspections, tenant portal |
| **Manufacturing** | Quality control, production tracking, defect management, supply chain, IoT |
| **Legal** | Document review, contract analysis, case management, compliance, billing |
| **Non-Profit** | Beneficiary tracking, case management, donor management, grant tracking, impact measurement |
| **Logistics** | Shipment tracking, route optimization, warehouse management, fleet management, last-mile delivery |

### Scenario Template Structure

Each scenario should include:
1. **Context** — Who is the developer, what company, what problem
2. **Object Types** — Data model for this vertical (3-8 types)
3. **Workflow** — Step-by-step CLI commands to build the vertical
4. **Code Examples** — Multi-language examples for key operations
5. **Architecture** — How the vertical connects to the platform
6. **Best Practices** — Security, performance, deployment considerations

---

## Multi-Language Example Strategy

### Example: Creating a Resource

Each language shows the same operation — creating a Patient resource in a healthcare vertical:

**CLI (universal)**:
```bash
eai resources create Patient --data '{"name": "Jane Doe", "dob": "1990-01-15"}'
```

**TypeScript (Platform SDK)**:
```typescript
const client = new PlatformAPIClient(baseUrl, tenantId);
const patient = await client.createResource('Patient', {
  name: 'Jane Doe',
  dob: '1990-01-15'
});
```

**Python**:
```python
response = requests.post(
    f'{base_url}/v3/resources/{tenant_id}/Patient',
    headers={'Authorization': f'Bearer {token}'},
    json={'data': {'name': 'Jane Doe', 'dob': '1990-01-15'}}
)
```

**C#, Java, Go, Rust** — Similar patterns with language-idiomatic HTTP clients.

---

## Packaging Implementation Details

### npm Package Configuration

```json
{
  "name": "@eai-tools/cli",
  "version": "0.2.0",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/eai-tools/eai.git"
  },
  "homepage": "https://eai-tools.github.io/eai",
  "bugs": {
    "url": "https://github.com/eai-tools/eai/issues"
  },
  "publishConfig": {
    "access": "public"
  }
}
```

### GitHub Actions Workflows Needed

1. **CI** (`ci.yml`) — Build, lint, typecheck on every PR
2. **Release** (`release.yml`) — On tag push: build, test, publish to npm, create GitHub Release
3. **Docs** (`docs.yml`) — Build and deploy docs to GitHub Pages on push to main
4. **Homebrew** — Update formula on new release

### Homebrew Tap

Create `eai-tools/homebrew-tap` repository with formula:
```ruby
class Eai < Formula
  desc "Enterprise AI Platform CLI"
  homepage "https://eai-tools.github.io/eai"
  url "https://registry.npmjs.org/@eai-tools/cli/-/cli-#{version}.tgz"
  depends_on "node@20"
  # ...
end
```

---

## Documentation Site Structure

```
docs/
├── astro.config.mjs          # Starlight configuration
├── package.json               # Docs dependencies
├── src/
│   ├── content/
│   │   └── docs/
│   │       ├── index.mdx                    # Landing page
│   │       ├── getting-started/
│   │       │   ├── installation.mdx         # Install guide (npm, brew, binary)
│   │       │   ├── quickstart.mdx           # 5-minute tutorial
│   │       │   ├── authentication.mdx       # Login and auth setup
│   │       │   └── first-vertical.mdx       # Build your first vertical
│   │       ├── guides/
│   │       │   ├── object-types.mdx         # Defining data models
│   │       │   ├── resources.mdx            # CRUD operations
│   │       │   ├── environment.mdx          # Environment management
│   │       │   ├── deployment.mdx           # CI/CD and deployment
│   │       │   ├── ai-features.mdx          # Chat, documents, RAG
│   │       │   ├── multi-tenant.mdx         # Tenant architecture
│   │       │   ├── security.mdx             # Auth, roles, permissions
│   │       │   └── troubleshooting.mdx      # Common issues and fixes
│   │       ├── scenarios/
│   │       │   ├── healthcare/              # 5 healthcare scenarios
│   │       │   ├── finance/                 # 5 finance scenarios
│   │       │   ├── government/              # 5 government scenarios
│   │       │   ├── retail/                  # 5 retail scenarios
│   │       │   ├── education/               # 5 education scenarios
│   │       │   ├── real-estate/             # 5 real estate scenarios
│   │       │   ├── manufacturing/           # 5 manufacturing scenarios
│   │       │   ├── legal/                   # 5 legal scenarios
│   │       │   ├── non-profit/              # 5 non-profit scenarios
│   │       │   └── logistics/               # 5 logistics scenarios
│   │       ├── examples/
│   │       │   ├── typescript.mdx           # TypeScript/JS examples
│   │       │   ├── python.mdx               # Python examples
│   │       │   ├── csharp.mdx               # C# examples
│   │       │   ├── java.mdx                 # Java examples
│   │       │   ├── go.mdx                   # Go examples
│   │       │   ├── rust.mdx                 # Rust examples
│   │       │   └── shell.mdx                # Shell/curl examples
│   │       ├── reference/
│   │       │   ├── commands/                # Auto-generated command reference
│   │       │   ├── object-type-schema.mdx   # Object Type specification
│   │       │   ├── api-surface.mdx          # Platform API reference
│   │       │   ├── environment-vars.mdx     # All env vars documented
│   │       │   └── error-codes.mdx          # Error reference
│   │       └── concepts/
│   │           ├── platform-overview.mdx    # What is EnterpriseAI?
│   │           ├── verticals.mdx            # What are vertical applications?
│   │           ├── architecture.mdx         # Platform architecture
│   │           ├── data-model.mdx           # How data works
│   │           └── security-model.mdx       # Security and compliance
│   └── assets/                              # Images, diagrams
└── public/                                  # Static assets
```

### Key Documentation Features

- **Tabbed code blocks** — Show same operation in 7 languages
- **Copy buttons** — One-click code copying
- **Search** — Pagefind built-in search
- **Dark/light mode** — Automatic theme switching
- **Responsive** — Mobile-friendly
- **Versioned** — Support multiple CLI versions
- **SEO optimized** — Sitemaps, meta tags, structured data
- **Mermaid diagrams** — Architecture and flow diagrams
- **Callout blocks** — Tips, warnings, important notes
- **Interactive examples** — Terminal-style command output display

---

## Constraints & Considerations

1. **IP Protection**: Documentation must expose the public API surface without revealing internal implementation (single-table JSONB, OPA Rego policies, OBO token chain, etc.)
2. **Template Access**: The template repo at `https://github.com/eai-tools/eai-app-template` appears to be private/not yet published. Documentation should reference it but handle the case where it's not publicly accessible.
3. **Platform Dependencies**: Many CLI commands require a live EnterpriseAI platform instance. Documentation should clearly indicate which commands work offline vs. require connectivity.
4. **Enterprise Security**: Documentation site will be on GitHub Pages (public). Must not contain any secrets, internal URLs, or sensitive configuration.
5. **Node.js Requirement**: CLI requires Node.js 20+. Must be clearly documented for all installation methods.
6. **Multi-Language Examples**: Keep examples realistic but must not expose internal API details beyond the documented public surface.

---

## Open Questions

- [ ] Should the documentation site be deployed to `eai-tools.github.io/eai` (GitHub Pages) or a custom domain?
- [ ] Should the Homebrew tap be a separate repo (`eai-tools/homebrew-tap`) or part of this repo?
- [ ] What license should the CLI use? (Currently UNLICENSED — needs MIT or Apache-2.0 for npm publish)
- [ ] Should we include a CLI auto-update mechanism (like oclif plugin-update)?
- [ ] Are there specific platform API docs (OpenAPI spec) available for the API reference section?

---

## Recommendations

1. **Start with packaging** — Fix package.json metadata, add GitHub Actions CI/CD, enable npm publish. This unblocks distribution immediately.

2. **Use Starlight for docs** — It's the fastest, most modern documentation generator with built-in search, perfect for CLI docs with multi-language code blocks.

3. **Organize docs by workflow** — Following Stripe and Vercel's pattern: Getting Started → Guides → Scenarios → Reference. Not alphabetical command lists.

4. **Build 50 scenarios incrementally** — Start with the 10 scenarios already in `docs/research.md`, expand to 50 by adding 5 per industry vertical.

5. **Multi-language examples as a differentiator** — Most CLI docs only show one language. Showing 7 languages positions EAI as truly enterprise-grade and language-agnostic.

6. **Update org references first** — Quick win that prevents confusion. Only 4 source files need changes.

7. **GitHub Pages deployment** — Free, integrates with the existing GitHub workflow, provides `eai-tools.github.io/eai` URL automatically.

8. **Automate everything** — CI on PR, release on tag, docs on merge. Zero manual steps for publishing.

---

## Brownfield Analysis

### Constraints & Limitations

| Constraint Type | Description | Impact on Implementation |
|-----------------|-------------|--------------------------|
| Package Manager | npm with ESM modules | Must use `"type": "module"` compatible tools |
| Node.js | Requires >=20.0.0 | Homebrew formula must depend on node@20 |
| Build System | TypeScript with tsc | No bundler — dist/ contains individual .js files |
| Authentication | Entra CIAM device code | Can't be mocked easily in docs examples |
| CLI Framework | Commander.js 13.x | Command reference generation must parse Commander |

### Technical Debt to Avoid

| Pattern | Found In | Why Avoid | Use Instead |
|---------|----------|-----------|-------------|
| Hardcoded version | `src/index.ts:8` | Version drift with package.json | Read from package.json at runtime |
| UNLICENSED | `package.json` | Blocks npm publish | MIT or Apache-2.0 |
| Missing templates dir | `package.json:files` | npm warns on publish | Remove or create directory |

### Integration Requirements

| Existing Service | Integration Method | Notes |
|------------------|-------------------|-------|
| GitHub Actions | `.github/workflows/` | New workflow files, no existing ones |
| npm Registry | `npm publish` | Needs publishConfig, access token |
| GitHub Pages | Docs build artifact | Needs deployment workflow |
| Homebrew | Tap repository | Separate repo or formula in this repo |

### Downstream Dependencies

Code that depends on areas we're modifying:

- `src/index.ts:8` — Version string used in CLI help output
- `package.json:2` — Package name used by npm commands
- `src/commands/init.ts:17-18` — Template repo URL used during scaffolding
- `src/lib/config.ts:96-97` — Package names used for project detection

---

## Additional Requirements (User-Specified)

### Requirement 1: University Student Accessibility

Documentation must be beginner-friendly enough for university students to understand, while still being useful for senior developers.

**Strategy: Progressive Disclosure Architecture**

- **Level 1 (Beginner)**: 5-minute quickstart, visual diagrams, "what is a vertical application?", glossary of terms
- **Level 2 (Intermediate)**: Guided tutorials with step-by-step instructions, complete scenario walkthroughs
- **Level 3 (Advanced)**: Command reference, API surface documentation, multi-tenant patterns, CI/CD

**Implementation**:
- Every concept page starts with a plain-English explanation before showing code
- Collapsible "Learn More" sections for advanced topics
- Visual architecture diagrams (Mermaid) for every major concept
- A glossary page defining all platform terminology
- "Prerequisites" boxes at the top of each guide stating required knowledge
- Tabbed content: "Quick Version" vs "Detailed Walkthrough"

### Requirement 2: AI Agent Usability

Documentation must be structured for AI coding agents (Claude Code, Copilot, Cursor, Aider) to consume and use effectively.

**Strategy: Dual-Format Documentation**

1. **llms.txt Standard**: Create `/llms.txt` and `/llms-full.txt` at the docs site root
   - `/llms.txt` — Streamlined navigation of all documentation with key concepts
   - `/llms-full.txt` — Complete documentation in a single markdown file
   - Following the emerging standard adopted by Anthropic, Cloudflare, Vercel, Supabase

2. **Machine-Readable Structure**:
   - Clear hierarchical headings (no skipped levels)
   - Consistent terminology throughout (never use different words for same concept)
   - Each page stands alone with full context (no relying on navigation context)
   - Brief description above every code block explaining purpose
   - Comments within code explaining logic
   - Question-answer format where appropriate

3. **CLAUDE.md Integration**:
   - Generated CLAUDE.md files for every scaffolded project
   - Contains: tech stack, project structure, common commands, conventions
   - Under 200 lines, focused on universally applicable instructions
   - No secrets, no obvious framework knowledge, no excessive documentation

4. **AGENTS.md Support**:
   - AGENTS.md already exists in this repo
   - Ensure it stays current and provides value to all AI coding agents
   - Following the standard stewarded by the Agentic AI Foundation

### Requirement 3: IP Protection — Critical

**No internal implementation details may be exposed.** This is the most critical requirement. The documentation site and CLI output must never reveal:

- Single-table JSONB storage design
- OPA Rego policy implementation
- OBO (On-Behalf-Of) token exchange chain
- HyPE dual-vector search internals
- PostgreSQL Row-Level Security configuration
- PayloadCMS as the Configurator backend
- Orchestrator routing logic (`target_backend`, `payload`/`mid`/`resources`)
- Action executor internals
- Schema validator implementation

**Critical IP Exposures Found in Current Codebase:**

| Severity | Location | Exposure |
|----------|----------|----------|
| CRITICAL | `src/commands/init.ts:580-672` | Generated CLAUDE.md exposes full architecture (Configurator, ResourceAPI, AICore, OPA, JSONB) |
| CRITICAL | `docs/research.md` | 348-line document listing all internal IP |
| CRITICAL | `src/lib/api.ts:29-41` | `orchestrate()` method exposes `target_backend: 'payload' \| 'mid' \| 'resources'` |
| CRITICAL | `README.md:5,141` | Mentions OBO tokens, OPA policies, JSONB, orchestrator |
| HIGH | `src/commands/verify.ts:79-117` | Error messages show "Configurator", "ResourceAPI" service names |
| HIGH | `src/commands/types.ts` | Multiple "Configurator" references in user-facing text |
| HIGH | `src/commands/tenant.ts` | "manage tenants in Configurator" |
| HIGH | `src/commands/init.ts:441,481` | `storageBackend: 'postgresql'` in generated scaffold |
| MEDIUM | `src/lib/config.ts:67` | `storageBackend: 'postgresql' \| 'cosmosdb'` type exposes DB choices |
| MEDIUM | `src/index.ts:57` | Help text references Configurator |

**Required Naming Changes:**

| Current (Internal) | Proposed (Public) | Reasoning |
|-------------------|-------------------|-----------|
| `orchestrate` endpoint | Hide entirely (make method private) | Architecture exposure |
| `Configurator` | "platform" or omit entirely | Internal service name |
| `ResourceAPI` | "resource service" or "data API" | Internal service name |
| `AICore` | "AI service" or "AI engine" | Internal service name |
| `target_backend: 'payload'` | Hide in SDK internals | Reveals PayloadCMS |
| "Push to Configurator" | "Publish types" or "Deploy types" | Action-focused |
| `storageBackend: 'postgresql'` | Remove or use `'default'` | Reveals DB choice |
| OBO/OPA/JSONB mentions | Remove from all public docs | Core IP |

### Requirement 4: CLI Name — Opinion

**Current name**: `eai`

**Assessment**: The name `eai` is **good but could be better**.

**Pros of `eai`**:
- Short (3 characters) — easy to type
- Stands for "Enterprise AI" — meaningful abbreviation
- Already established in codebase
- npm scope `@eai-tools` is clean

**Concerns**:
- "eai" doesn't immediately evoke anything to a new user
- Could be confused with "EAI" (Enterprise Application Integration — an existing industry term from the 2000s)
- Typing: `e-a-i` requires three different fingers on three different hand positions

**Alternatives Considered**:

| Name | Pros | Cons |
|------|------|------|
| `eai` (keep) | Established, short, meaningful | EAI confusion, finger travel |
| `ent` | Shorter, "enterprise" | Too generic, Entrust/Enterprise confusion |
| `vai` | "Vertical AI" — descriptive, easy to type | Not established |
| `eaicli` | Explicit | Too long for frequent use |

**Recommendation**: **Keep `eai`**. It's short, established, and the scope of change to rename at this point is massive. The documentation site will establish the brand. `eai init`, `eai login`, `eai deploy` all read well.

### Requirement 5: Installation UX — Opinion

**Recommendation**: Multiple installation paths, ordered by friction:

1. **npm (Primary — zero friction for Node.js developers)**:
   ```bash
   npm install -g @eai-tools/cli
   ```
   Node.js 20+ is already required. This is the fastest path.

2. **npx (Zero install — try before you commit)**:
   ```bash
   npx @eai-tools/cli init my-vertical
   ```
   Perfect for first-time users, especially students.

3. **Homebrew (macOS/Linux developers who prefer brew)**:
   ```bash
   brew install eai-tools/tap/eai
   ```

4. **GitHub Releases (Binary download — no Node.js required)**:
   ```bash
   curl -fsSL https://eai-tools.github.io/eai/install.sh | sh
   ```
   For CI/CD environments and users who don't want Node.js.

5. **Clone & Build (Contributors)**:
   ```bash
   git clone https://github.com/eai-tools/eai.git && cd eai && npm install && npm run build && npm link
   ```

**Key UX Decision**: The `npx` path is crucial for university students and first-time users — they can try the CLI without committing to a global install.

---

## llms.txt Strategy

Create an `/llms.txt` file at the documentation site root following the emerging standard:

```markdown
# EAI CLI

> Enterprise AI Platform CLI for building vertical business applications.
> Scaffold, authenticate, configure, deploy, and manage verticals on the EAI platform.

## Documentation

- [Getting Started](https://eai-tools.github.io/eai/getting-started/quickstart/): 5-minute quickstart guide
- [Installation](https://eai-tools.github.io/eai/getting-started/installation/): Install via npm, brew, or binary
- [Authentication](https://eai-tools.github.io/eai/getting-started/authentication/): Login with Microsoft Entra
- [Command Reference](https://eai-tools.github.io/eai/reference/commands/): All CLI commands and flags
- [Object Types Guide](https://eai-tools.github.io/eai/guides/object-types/): Define your data model
- [Resources Guide](https://eai-tools.github.io/eai/guides/resources/): CRUD operations
- [Deployment Guide](https://eai-tools.github.io/eai/guides/deployment/): CI/CD and deployment
- [Scenarios](https://eai-tools.github.io/eai/scenarios/): 50 industry-specific developer scenarios

## Concepts

- Object Types: Declarative data model definitions with properties, links, actions
- Resources: Instances of Object Types stored on the platform
- Tenants: Organizational units for multi-tenant isolation
- Verticals: Domain-specific applications built on the EAI platform
```

Also create `/llms-full.txt` as a complete documentation export.

---

## 50 Developer Scenarios — Detailed Plan

### Scenario Structure (Each Scenario)

Each of the 50 scenarios follows this template:

```markdown
# Scenario: [Title]

## Who You Are
[1-2 sentences: developer role, company type, experience level]

## What You're Building
[1-2 sentences: the vertical application and its purpose]

## Object Types
[Table of 3-8 Object Types with properties, links, and actions]

## Step-by-Step with EAI CLI

### Step 1: Scaffold
\```bash
eai init [name]
\```

### Step 2: Define Object Types
\```typescript
// src/eai.config/object-types.ts
export const objectTypes = { ... };
\```

### Step 3: Validate & Seed
\```bash
eai types validate
eai types seed
\```

### Step 4: Build Your App
[Language-specific examples: TypeScript, Python, C#, etc.]

### Step 5: Deploy
\```bash
eai deploy setup
eai deploy trigger
\```

## Architecture
[Mermaid diagram showing data flow]

## Key Takeaways
[3-5 bullet points of lessons learned]
```

### All 50 Scenarios

#### Healthcare (5)
1. **Patient Intake & Triage** — React dev at health-tech startup, patient forms → nurse routing → specialist referral
2. **Clinical Trial Management** — Data engineer at pharma company, trial registration → participant tracking → adverse event reporting
3. **Telemedicine Platform** — Full-stack dev at telehealth startup, appointment scheduling → video consultation → prescription management
4. **Pharmacy Inventory** — Backend dev at pharmacy chain, drug inventory → prescription fulfillment → regulatory compliance
5. **Mental Health Assessment** — Junior dev at wellness app, assessment intake → therapist matching → progress tracking

#### Finance (5)
6. **KYC/Identity Verification** — Security-focused dev at fintech, identity documents → verification → risk scoring
7. **Loan Application Processing** — Full-stack dev at lending platform, application → underwriting → approval workflow
8. **Transaction Monitoring** — Backend dev at bank, transaction ingestion → pattern detection → alert management
9. **Insurance Claims** — Team of 3 at insurtech, claim submission → assessment → settlement
10. **Portfolio Management** — Quant dev at wealth manager, asset tracking → rebalancing → client reporting

#### Government (5)
11. **Planning Permit Portal** — Gov contractor dev, citizen application → staff review → permit issuance
12. **Citizen Service Requests** — Municipal dev, service request → routing → resolution tracking
13. **Regulatory Compliance** — Compliance dev at gov agency, policy tracking → audit scheduling → violation management
14. **Public Records Management** — Records clerk dev, document intake → classification → public access
15. **Grant Management** — Non-profit liaison dev, application → review → disbursement → reporting

#### Retail (5)
16. **Product Compliance Tracking** — Backend dev at retail chain, supplier certificates → audit → compliance status
17. **Customer Loyalty Program** — Marketing dev, customer enrollment → point tracking → reward redemption
18. **Inventory Management** — Warehouse dev, stock tracking → reorder automation → supplier management
19. **E-Commerce Returns** — Full-stack dev, return request → inspection → refund processing
20. **Supplier Onboarding** — Procurement dev, supplier registration → qualification → contract management

#### Education (5)
21. **Course Management System** — Junior EdTech dev, course creation → student enrollment → grading
22. **Student Admissions Portal** — University IT dev, application → review → admission decision
23. **Learning Analytics Dashboard** — Data-focused dev, learning activity → performance tracking → intervention alerts
24. **Accreditation Management** — Compliance dev, standards tracking → evidence collection → audit preparation
25. **Research Grant Tracking** — Academic admin dev, proposal → funding → milestone → reporting

#### Real Estate (5)
26. **Property Management Portal** — Full-stack dev, property listing → tenant management → maintenance
27. **Lease Management System** — Backend dev, lease creation → renewal tracking → payment management
28. **Maintenance Request Tracker** — Junior dev, request submission → assignment → completion tracking
29. **Property Inspection App** — Mobile dev, inspection scheduling → checklist execution → report generation
30. **Real Estate CRM** — Sales dev, lead tracking → showing scheduling → offer management

#### Manufacturing (5)
31. **Quality Control Workflow** — IoT dev at manufacturer, sensor data → inspection → corrective action
32. **Production Line Tracking** — Operations dev, batch tracking → stage progression → output recording
33. **Defect Management** — QA dev, defect reporting → root cause analysis → resolution
34. **Supply Chain Visibility** — Integration dev, supplier orders → shipment tracking → receiving
35. **Equipment Maintenance** — Facilities dev, preventive scheduling → work orders → parts inventory

#### Legal (5)
36. **Contract Review Platform** — LegalTech dev, contract upload → AI clause extraction → annotation
37. **Case Management System** — Legal ops dev, case creation → document management → timeline tracking
38. **Compliance Monitoring** — RegTech dev, regulation tracking → policy mapping → gap analysis
39. **E-Discovery Workflow** — Litigation support dev, document collection → review → production
40. **Billing & Time Tracking** — Practice mgmt dev, time entry → invoice generation → payment tracking

#### Non-Profit (5)
41. **Beneficiary Tracking** — NGO dev with dual portals, beneficiary registration → case management → pathway matching
42. **Donor Management** — Fundraising dev, donor registration → contribution tracking → acknowledgment
43. **Volunteer Coordination** — Community dev, volunteer signup → assignment → hours tracking
44. **Impact Measurement** — M&E dev, indicator tracking → data collection → report generation
45. **Grant Reporting** — Compliance dev, grant activities → milestone tracking → funder reporting

#### Logistics (5)
46. **Shipment Tracking** — Logistics dev, shipment creation → status updates → delivery confirmation
47. **Route Optimization** — Operations dev, route planning → driver assignment → real-time tracking
48. **Warehouse Management** — Warehouse dev, receiving → storage → picking → shipping
49. **Fleet Management** — Fleet ops dev, vehicle tracking → maintenance scheduling → fuel management
50. **Last-Mile Delivery** — Delivery platform dev, order assignment → driver tracking → proof of delivery

---

## Updated Recommendations (Incorporating New Requirements)

1. **IP Protection is P0** — Fix all IP exposures before publishing anything. The generated CLAUDE.md, README.md, and verify command error messages all leak architecture details.

2. **Dual-audience documentation** — Use progressive disclosure: beginner-friendly surface with advanced content expandable. University students start with quickstart; senior devs jump to reference.

3. **AI-agent-first** — Implement llms.txt, keep CLAUDE.md and AGENTS.md updated, use consistent terminology and hierarchical structure throughout. Every page must stand alone.

4. **Keep `eai` as CLI name** — It's established, short, and works well. Brand recognition builds through documentation quality, not name changes.

5. **npx support** — Critical for students and first-time users. Zero-install trial path.

6. **Sanitize before publishing** — Create `.npmignore` to exclude `docs/research.md`, `.specify/`, and other internal artifacts.

7. **Naming overhaul** — Replace all internal service names (Configurator, ResourceAPI, AICore) with neutral public terms throughout the codebase before documentation is written.

8. **Starlight + llms.txt** — Starlight for the documentation site with llms.txt/llms-full.txt auto-generated as part of the build process.
