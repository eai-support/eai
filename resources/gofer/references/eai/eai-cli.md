# EAI CLI Reference (Local Fallback)

Use this local reference when external EAI CLI documentation cannot be reached.

## Version pinning rule

- Detect installed `eai-cli` version.
- Record **major.minor** in generated plan/tasks artifacts.
- Use command syntax compatible with that pinned major.minor.

## Command guidance contract

- Include at least one scaffolding/task command using EAI CLI.
- Include at least one deployment command using EAI CLI.
- Add a user-visible notice when local fallback references are used.
