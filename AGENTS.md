# AGENTS.md

## Project Overview

- **Project**: eai-cli
- **Language**: TypeScript
- **Package Manager**: npm

## Commands

- **Build**: `npm run build`
- **Lint**: `npm run lint`

## Project Structure

Standard Node.js project layout. Source in `src/`, tests alongside or in `tests/`.

## Code Style

### TypeScript Conventions

- Use strict mode (`"strict": true` in tsconfig.json)
- Use ESM imports (`import`/`export`), never `require()`
- Add explicit return types to all public functions
- Prefer `unknown` over `any`; use proper type narrowing
- Use `readonly` for properties that should not be reassigned
- Prefer interfaces over type aliases for object shapes

## Testing

- Write tests for new functionality before marking tasks complete
- Run the full test suite before committing

## Git Workflow

- Use conventional commit messages (feat:, fix:, chore:, docs:)
- Create feature branches for new work
- Run tests and linting before committing

## Boundaries

- Do not modify files outside the project scope without approval
- Do not commit secrets, API keys, or credentials
- Do not add dependencies without justification

## Core Principles

### Workflow Principles

1. **Plan First**
   - Enter plan mode for ANY non-trivial task (3+ steps or architectural
     decisions)
   - If something goes sideways, STOP and re-plan immediately — don't keep
     pushing
   - Use plan mode for verification steps, not just building
   - Write detailed specs upfront to reduce ambiguity

2. **Use Subagents**
   - Use subagents liberally to keep main context window clean
   - Offload research, exploration, and parallel analysis to subagents
   - For complex problems, throw more compute at it via subagents
   - One task per subagent for focused execution

3. **Self-Improvement**
   - After ANY correction from the user: update lessons file with the pattern
   - Write rules for yourself that prevent the same mistake
   - Ruthlessly iterate on these lessons until mistake rate drops
   - Review lessons at session start for relevant project

4. **Verify Before Done**
   - Never mark a task complete without proving it works
   - Never state anything that you do not know is correct, do not make
     assumptions, and always cite the latest on the internet or from information
     you have
   - Diff behavior between main and your changes when relevant
   - Ask yourself: "Would a staff engineer approve this?"
   - Run tests, check logs, demonstrate correctness

5. **Demand Elegance**
   - For non-trivial changes: pause and ask "is there a more elegant way?"
   - If a fix feels hacky: "Knowing everything I know now, implement the elegant
     solution"
   - Skip this for simple, obvious fixes — don't over-engineer
   - Challenge your own work before presenting it

6. **Autonomous Bug Fixing**
   - When given a bug report: just fix it. Don't ask for hand-holding
   - Point at logs, errors, failing tests — then resolve them
   - Zero context switching required from the user
   - Go fix failing CI tests without being told how

### Task Management

1. **Plan First**: Write plan with checkable items before starting
2. **Verify Plan**: Check in before starting implementation
3. **Track Progress**: Mark items complete as you go
4. **Explain Changes**: High-level summary at each step
5. **Document Results**: Add review section to task tracking
6. **Capture Lessons**: Update lessons file after corrections

### Core Principles

- **Simplicity First**: Make every change as simple as possible. Impact minimal
  code.
- **No Laziness**: Find root causes. No temporary fixes. Senior developer
  standards.
- **Minimal Impact**: Changes should only touch what's necessary. Avoid
  introducing bugs.
