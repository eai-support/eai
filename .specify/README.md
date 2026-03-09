# Gofer - Specification Directory

This folder contains all project specifications for AI-driven feature development.

## Structure

- **memory/** - Constitution, decisions, and project principles
- **specs/** - Feature specifications (numbered: 001-feature-name/)
- **templates/** - Templates for specs, plans, and tasks
- **scripts/** - Helper scripts for workflow automation
- **logs/** - Execution logs (council usage, etc.)

## Quick Start

### Using VSCode Extension

1. Open Command Palette (`Cmd/Ctrl+Shift+P`)
2. Run: **"Gofer: Create New Specification"**
3. Follow the prompts to create your feature spec

### Using Claude Code (Recommended)

Run the unified Gofer pipeline with a single command:

```
/0_business_scenario Add user authentication with OAuth2 and JWT
```

This automatically chains through all stages:
1. **Research** → Explores codebase and technology
2. **Specify** → Creates spec.md from requirements
3. **Plan** → Generates architecture and design
4. **Tasks** → Breaks down into executable tasks
5. **Implement** → Executes tasks phase by phase
6. **Validate** → Verifies against spec and constitution

## Unified Gofer Pipeline

| Stage | Command | Output |
|-------|---------|--------|
| 1. Research | `/1_gofer_research` | research.md |
| 2. Specify | `/2_gofer_specify` | spec.md |
| 3. Plan | `/3_gofer_plan` | plan.md, data-model.md, contracts/ |
| 4. Tasks | `/4_gofer_tasks` | tasks.md, issues.md |
| 5. Implement | `/5_gofer_implement` | Source code |
| 6. Validate | `/6_gofer_validate` | validation-report.md |

All artifacts are stored in: `.specify/specs/{feature}/`

## Constitution

Define your project principles in `memory/constitution.md`:
- Coding standards and patterns
- Technology choices
- Security requirements
- Testing policies

AI agents validate code against the constitution before implementation.

## Learn More

- **Full Documentation**: https://github.com/eai-tools/gofer
- **AI Agent Guidelines**: See AGENTS.md in your project root
- **Gofer Extension**: View specs and progress in VSCode sidebar
