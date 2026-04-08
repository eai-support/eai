---
feature: cli-streamline-and-provision
iteration: 1
score: 40/100
generated: 2026-04-08T14:11:00Z
failed_categories: [functional_correctness, security_posture, integration_reality, error_path_coverage, code_hygiene]
---

# Remediation Report: CLI Streamline and Provision

## Iteration 1 of 3

**Score**: 40/100 **Status**: FAIL — Remediation Required

## Failed Categories

### Functional Correctness (0/20)

**Evidence**: `patchEnvFile` is the critical path for both `env pull` (preserves existing keys) and `eai provision entra` (writes credentials without clobbering). The fix was committed in `05ce374` but has zero behavioral test coverage. A regression to overwrite behavior passes all 55 tests.

**Required Actions**:
1. Add a test to `tests/integration/env.test.ts` that:
   - Creates a `.env.local` with `AUTH_SECRET=existing-secret` and `OTHER_KEY=keep-me`
   - Calls `patchEnvFile(root, { NEW_KEY: 'new-value' })`
   - Asserts `AUTH_SECRET`, `OTHER_KEY`, and `NEW_KEY` are all present in the result
2. Add a test for the `provision entra` → `patchEnvFile` path (see Integration section)
3. Add a test that runs `eai --describe` and asserts stdout is valid parseable JSON

**Files to modify**:
- `tests/integration/env.test.ts` — add patchEnvFile merge behavior test
- `tests/integration/` — add `provision.test.ts` (new file)

---

### Security Posture (0/10)

**Evidence**: `src/commands/login.ts:13-16` hardcodes live Azure CIAM identifiers:
```typescript
const DEFAULT_TENANT_NAME = 'eaidevmyentepriseai';
const DEFAULT_TENANT_ID   = '50808ce0-f31b-4fd0-9861-74b83b8c112a';
const DEFAULT_CLIENT_ID   = 'c3c10ee2-aeeb-4a64-8eea-5ca43a3252af';
```
These are pre-existing and not introduced by this branch, but they are present in the repo and flagged as Red.

**Required Actions**:
1. Replace hardcoded constants with environment variable reads:
   ```typescript
   const DEFAULT_TENANT_NAME = process.env.EAI_CIAM_TENANT_NAME ?? '';
   const DEFAULT_TENANT_ID   = process.env.EAI_CIAM_TENANT_ID ?? '';
   const DEFAULT_CLIENT_ID   = process.env.EAI_CIAM_CLIENT_ID ?? '';
   ```
2. Document the required env vars in the project README / docs
3. Provide development values via `.env.local` (not committed to source)

**Files to modify**:
- `src/commands/login.ts:13-16` — replace constants with env var reads

---

### Integration Reality (0/10)

**Evidence**: `eai provision entra` is the primary new feature of this branch. It has zero integration tests — no test exercises the command, the API call, or the file writes.

**Required Actions**:
1. Create `tests/integration/provision.test.ts` with at minimum:
   - Happy path: mock `/v3/provision/entra-app` returning `{clientId: 'cid-1', clientSecret: 'secret-1', existing: false}` → assert `.env.local` contains `ENTRA_CLIENT_ID=cid-1` and `ENTRA_CLIENT_SECRET=secret-1`
   - Existing registration path: mock returning `{clientId: 'cid-1', clientSecret: null, existing: true}` → assert existing `.env.local` keys are preserved, ENTRA_CLIENT_ID updated
   - HTTP 403 path: mock returning 403 → assert non-zero exit and error message
   - HTTP 404/501 path: mock returning 404 → assert non-zero exit with "not yet available" message

**Files to modify**:
- `tests/integration/provision.test.ts` — create new test file

---

### Error Path Coverage (0/10)

**Evidence**: `provision.ts` handles HTTP 403, 404/501, 409 with specific messages, but none of these branches have tests. If `provisionEntraApp()` throws with these statuses, the behavior is untested.

**Required Actions**:
1. Include HTTP error path tests in the new `provision.test.ts` (overlaps with Integration section above)
2. Use MSW to mock `POST https://<api>/v3/provision/entra-app` returning specific status codes

**Files to modify**:
- `tests/integration/provision.test.ts` — already covered by Integration actions above

---

### Code Hygiene (0/10)

**Evidence**: `src/lib/auth.ts:170-172` silently swallows token refresh failures:
```typescript
} catch (_err) {
  return null;
}
```
Users who hit an expired token with a broken refresh endpoint see no diagnostic. This is pre-existing but flagged by the rubric.

**Required Actions**:
1. Add a comment at minimum explaining the intentional swallow:
   ```typescript
   } catch {
     // Refresh failed (network error or server rejection) — caller treats user as unauthenticated
     return null;
   }
   ```
   Or surface a debug-level log if a logging utility is available.

**Files to modify**:
- `src/lib/auth.ts:170-172` — add explanatory comment or debug log

---

## Remediation Scope

The following pipeline stages should re-run focused on these areas:

- **Research**: Not needed
- **Plan**: Not needed
- **Implement**: Add missing tests (provision.test.ts, patchEnvFile merge test, --describe test), externalize CIAM constants, add refresh failure comment
- **Validate**: Re-run after fixes

## Previous Iterations

| Iteration | Score | Failed Categories | Date |
|-----------|-------|-------------------|------|
| 1 | 40/100 | Correctness, Security, Integration, Error Paths, Hygiene | 2026-04-08 |
