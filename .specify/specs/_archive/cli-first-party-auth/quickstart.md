# Quickstart: Validate CLI First-Party Browser Auth

## Command Surface

```bash
node dist/index.js login --help
node dist/index.js login --client-id abc123
```

Expected:

- help output shows no `--client-id`
- passing `--client-id` fails with Commander unknown-option output

## Build and Test

```bash
npm run build
npm run lint
npm run typecheck
npm test
```

Expected:

- build, lint, typecheck, and tests all succeed

## Browser Login Coverage

The automated login tests simulate:

- successful browser callback and token exchange
- token exchange failure handling
- token persistence after successful login

Run directly:

```bash
npm test -- --run tests/integration/login.test.ts
```

## Contract Audit Coverage

Run directly:

```bash
npm test -- --run tests/integration/verify-calls.test.ts
```

Expected:

- authenticated read-only contract probes pass with mocked endpoints
- unauthenticated runs fail the auth check and skip protected routes
