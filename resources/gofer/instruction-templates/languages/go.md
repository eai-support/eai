### Go Conventions

- Always handle errors explicitly; never ignore returned errors
- Use `gofmt` / `goimports` for formatting
- Follow Go naming: exported = `PascalCase`, unexported = `camelCase`
- Keep packages small and focused; avoid circular imports
- Use `context.Context` as the first parameter for functions that do I/O
- Prefer table-driven tests
