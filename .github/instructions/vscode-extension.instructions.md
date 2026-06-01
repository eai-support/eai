---
applyTo: 'extension/**/*'
---

# VSCode Extension Development Instructions

You are working on the Gofer VSCode extension.

## Key Architecture

- **Extension entry**: `extension/src/extension.ts`
- **LSP Client**: `extension/src/lspClient.ts` - Connects to Language Server
- **MCP Config**: `extension/src/mcpConfig.ts` - Creates `.vscode/mcp.json`
- **Spec Parser**: `extension/src/goferParser.ts` - Parses GitHub Gofer format

## VSCode APIs to Use

- `vscode.workspace` for file operations
- `vscode.window` for UI (notifications, input, quick picks)
- `vscode.commands` for registering commands
- `vscode.TreeDataProvider` for tree views

## Important Patterns

1. **Activation Events**
   - Extension activates on workspace open with `.specify/` folder
   - Use `workspaceContains` activation events

2. **Command Registration**
   - All commands prefixed with `gofer.`
   - Register in `extension.ts` activate()
   - Dispose properly in deactivate()

3. **Resource Bundling**
   - Bundled resources in `extension/resources/`
   - Copy to workspace during initialization
   - Use webpack for production bundling

4. **Settings**
   - Contribute through `package.json` contributes.configuration
   - Access via `vscode.workspace.getConfiguration('gofer')`

## Testing

- Use @vscode/test-electron for integration tests
- Mock vscode APIs for unit tests
