# Contributing

Thanks for helping improve the EAI CLI. This repository is public, so every
issue, pull request, branch name, commit, workflow log, and attachment should be
safe to share externally.

## Development Setup

```bash
git clone https://github.com/eai-tools/eai.git
cd eai
npm install
npm run build
```

Useful checks:

```bash
npm run lint
npm run typecheck
npm run test
npm run docs:release-assets:check
```

Before proposing release-related changes, also run:

```bash
npm run release:check
```

## Pull Requests

- Open an issue first for substantial behavior, API, release, or security
  changes.
- Keep changes focused and explain the user-facing impact.
- Add or update tests for behavior changes.
- Update docs and generated release-facing docs when command output or public
  API contracts change.
- Run the checks above and paste the results in the pull request.
- Do not include secrets, customer data, private tenant identifiers, personal
  filesystem paths, or private workspace notes.

## Gofer Assets

The committed `.specify` directory contains reusable Gofer command scripts and
templates. Generated Gofer feature specs, memory files, logs, checkpoints, and
runtime state are intentionally ignored and must stay local.

## Releases

Maintainers release from a clean `main` checkout with:

```bash
./release.sh <patch|minor|major> "Release message"
```

The release script validates the package, regenerates release-facing docs and
the static registry, pushes the tag, waits for GitHub Actions, and verifies the
GitHub Pages registry.

## License

By contributing, you agree that your contributions are licensed under the
Apache License, Version 2.0.
