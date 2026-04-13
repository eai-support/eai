### Rust Conventions

- Follow ownership rules; prefer borrowing over cloning
- Use `Result<T, E>` for recoverable errors, `panic!` only for unrecoverable
  bugs
- Run `cargo fmt` before committing and `cargo clippy` for lint checks
- Derive common traits (`Debug`, `Clone`, `PartialEq`) where appropriate
- Use `?` operator for error propagation
- Organize code into modules with clear public APIs
