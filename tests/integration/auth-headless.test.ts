/**
 * Headless-auth affordance: with EAI_ACCESS_TOKEN set to a valid JWT,
 * loadTokens() returns a synthesized session (oid + expiresAt decoded from
 * the token) so authenticated commands work without a browser login or an
 * on-disk token file. Companion to EAI_PROFILE_DIR / EAI_API_URL /
 * EAI_STABLE_EXIT_CODES — the headless test affordances for cross-service
 * runners.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadTokens } from '../../src/lib/auth.js';

/** Build an unsigned-but-structurally-valid JWT for tests. */
function makeJwt(payload: Record<string, unknown>): string {
  const seg = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  return `${seg({ alg: 'none', typ: 'JWT' })}.${seg(payload)}.unsigned`;
}

describe('loadTokens — EAI_ACCESS_TOKEN headless auth', () => {
  const originalToken = process.env.EAI_ACCESS_TOKEN;
  const originalProfileDir = process.env.EAI_PROFILE_DIR;
  let profileDir = '';

  beforeEach(async () => {
    // Isolate from the developer's real ~/.eai by pointing the CLI state
    // dir at an empty temp dir (EAI_PROFILE_DIR is a PR #51 affordance).
    profileDir = await mkdtemp(join(tmpdir(), 'eai-auth-headless-'));
    process.env.EAI_PROFILE_DIR = profileDir;
    delete process.env.EAI_ACCESS_TOKEN;
  });

  afterEach(async () => {
    if (originalToken === undefined) delete process.env.EAI_ACCESS_TOKEN;
    else process.env.EAI_ACCESS_TOKEN = originalToken;
    if (originalProfileDir === undefined) delete process.env.EAI_PROFILE_DIR;
    else process.env.EAI_PROFILE_DIR = originalProfileDir;
    await rm(profileDir, { recursive: true, force: true });
  });

  it('synthesizes a session from a JWT with oid + exp', async () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    process.env.EAI_ACCESS_TOKEN = makeJwt({ oid: 'user-oid-123', exp });

    const tokens = await loadTokens();

    expect(tokens).not.toBeNull();
    expect(tokens?.oid).toBe('user-oid-123');
    expect(tokens?.accessToken).toBe(process.env.EAI_ACCESS_TOKEN);
    expect(tokens?.expiresAt).toBe(exp * 1000);
  });

  it('falls back to the sub claim when oid is absent', async () => {
    process.env.EAI_ACCESS_TOKEN = makeJwt({ sub: 'subject-456' });

    const tokens = await loadTokens();

    expect(tokens?.oid).toBe('subject-456');
  });

  it('returns null for a JWT with no oid or sub identity claim', async () => {
    process.env.EAI_ACCESS_TOKEN = makeJwt({ scope: 'read', exp: Math.floor(Date.now() / 1000) + 3600 });

    const tokens = await loadTokens();

    expect(tokens).toBeNull();
  });

  it('returns null for a non-JWT opaque token when no token file exists', async () => {
    process.env.EAI_ACCESS_TOKEN = 'an-opaque-non-jwt-token';

    const tokens = await loadTokens();

    expect(tokens).toBeNull();
  });

  it('returns null when EAI_ACCESS_TOKEN is unset and no token file exists', async () => {
    const tokens = await loadTokens();

    expect(tokens).toBeNull();
  });
});
