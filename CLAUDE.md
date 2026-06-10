# CLAUDE.md

See @AGENTS.md for project conventions, commands, and code style.

## Workflow

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

## Release Notes

- Treat `./release.sh` as the canonical release entrypoint
- Keep `release.sh`, `.github/workflows/release.yml`, `.github/workflows/docs.yml`,
  `src/commands/update.ts`, `src/lib/update-check.ts`, and `README.md` in sync
- Validate release work with `npm run release:check`
- Keep `ci/eai-cli-tests` green for CLI auth, tenant, schema, error envelope,
  PublicAPI, and preview-lifecycle behavior. It is the repo-owned SRP evidence
  for the EAI CLI surface.
- Keep deployed CLI canaries in `eai-testing-dev` read-only for prod; preview
  lifecycle checks must stay explicit and cleanup-backed.
- Refresh `docs-site/static/llms.txt`, `docs-site/static/llms-full.txt`, and `docs-site/static/cli-help.txt` as part of every release
- GitHub Pages static registry is the release and update channel, and it must
  keep matching the current tag
- Preferred install setup is `npm config set @eai-tools:registry https://eai-tools.github.io/eai/registry/ --location=user`
- Install or update the CLI with `npm install -g @eai-tools/cli`
- `eai update` upgrades the installed CLI package only; it does not rewrite project repos
- Use `eai gofer refresh --check` to preview safe Gofer-managed file updates in an existing repo
- Use `eai doctor --check-updates` to report CLI, Gofer, and template drift
- Use `eai template check` to preview app-template and UI drift before copying changes manually

## Gofer Pipeline

Gofer pipeline commands (run via `/` prefix in Claude Code):

| Command                | Purpose                             |
| ---------------------- | ----------------------------------- |
| `/0_business_scenario` | Start the full pipeline from triage |
| `/1_gofer_research`    | Deep codebase research              |
| `/2_gofer_specify`     | Create feature specification        |
| `/3_gofer_plan`        | Technical architecture plan         |
| `/4_gofer_tasks`       | Task breakdown                      |
| `/5_gofer_implement`   | Execute implementation              |
| `/6_gofer_validate`    | Engineering quality validation      |
| `/7_gofer_save`        | Save session checkpoint             |
| `/8_gofer_resume`      | Resume from checkpoint              |
