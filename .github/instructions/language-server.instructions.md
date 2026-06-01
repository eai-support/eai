---
applyTo: 'language-server/**/*'
---

# Language Server Development Instructions

You are working on the Gofer Language Server.

## Architecture

The Language Server provides dual protocol support:

1. **LSP (Language Server Protocol)** - Communication with VSCode extension
2. **MCP (Model Context Protocol)** - Communication with AI assistants

## Key Files

- **Server Entry**: `language-server/src/server.ts`
- **MCP Tools**: `language-server/src/mcp/toolHandler.ts`
- **Spec Loader**: `language-server/src/utils/goferLoader.ts`

## MCP Tools (6 Total)

| Tool                       | Purpose                             |
| -------------------------- | ----------------------------------- |
| `gofer_get_specs`          | List all specs and tasks            |
| `gofer_get_next_task`      | Get next task based on dependencies |
| `gofer_execute_task`       | Mark task in-progress, get context  |
| `gofer_update_task_status` | Mark task completed/failed          |
| `gofer_validate_code`      | Check against constitution          |
| `gofer_run_tests`          | Execute Playwright tests            |

## Adding New MCP Tools

1. Define tool in `server.ts` tool capabilities
2. Implement handler in `mcp/toolHandler.ts`
3. Register in MCP tool list
4. Test via Claude Code or Copilot

## LSP Capabilities

- textDocument/completion - Spec suggestions
- textDocument/hover - Spec details
- Custom methods for spec operations

## Dependencies

- vscode-languageserver 9.0.1
- @anthropic-ai/sdk 0.35.0 (for validation)
