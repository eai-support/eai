---
applyTo: '**/*.ts,**/*.tsx'
---

# TypeScript Development Instructions

You are working on Gofer, a TypeScript project using:

- TypeScript 5.7.2 with strict mode
- Node.js 18+ (ES2022 modules)
- VSCode Extension API
- vscode-languageserver 9.0.1

## Code Quality Standards

1. **Type Safety**
   - Never use `any` type - use `unknown` and narrow with type guards
   - Always provide explicit return types for functions
   - Use interface over type for object shapes when possible
   - Prefer union types over enums for string literals

2. **Imports**
   - Use ES6 imports (not `require()`)
   - Use `.js` extension in imports for ESM compatibility
   - Group imports: external → project → relative

3. **Async/Await**
   - Always use async/await over raw Promises
   - Handle errors with try/catch, not `.catch()`
   - Use `Promise.all()` for parallel operations

4. **Documentation**
   - Add JSDoc comments for public APIs
   - Document parameters and return types
   - Include @throws for functions that can throw

## File Structure

- Keep files under 300 lines
- One class/component per file
- Export from index files for modules

## Testing

- Write tests before implementation (TDD)
- Minimum 80% code coverage
- Use descriptive test names: `should [action] when [condition]`
