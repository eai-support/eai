/**
 * Locks in the `exitCodeFor` category contract per the JSON-envelope ↔
 * subprocess-status agreement requirement:
 *
 *   - default (EAI_STABLE_EXIT_CODES unset) → always exit 1
 *   - EAI_STABLE_EXIT_CODES=1 → category bucket within the 0-255 POSIX range
 *
 * If E3xx returns e.g. 305, `process.exit(305)` truncates to 305 mod 256 = 49
 * at the OS level, so the JSON envelope (`exitCode: 305`) and `$?` (49) would
 * disagree. Category mapping keeps them aligned.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { ErrorCode, exitCodeFor, formatErrorJSON } from '../../src/lib/error-codes.js';

describe('exitCodeFor — stable exit code contract', () => {
  const originalStableFlag = process.env.EAI_STABLE_EXIT_CODES;

  beforeEach(() => {
    delete process.env.EAI_STABLE_EXIT_CODES;
  });

  afterEach(() => {
    if (originalStableFlag === undefined) {
      delete process.env.EAI_STABLE_EXIT_CODES;
    } else {
      process.env.EAI_STABLE_EXIT_CODES = originalStableFlag;
    }
  });

  describe('default mode (legacy parity)', () => {
    it('returns 1 for every error code when EAI_STABLE_EXIT_CODES is unset', () => {
      for (const code of Object.values(ErrorCode)) {
        expect(exitCodeFor(code), `default ${code}`).toBe(1);
      }
    });

    it('returns 1 even when EAI_STABLE_EXIT_CODES is set to a non-"1" value', () => {
      process.env.EAI_STABLE_EXIT_CODES = '0';
      expect(exitCodeFor(ErrorCode.E101)).toBe(1);
      process.env.EAI_STABLE_EXIT_CODES = 'true';
      expect(exitCodeFor(ErrorCode.E201)).toBe(1);
    });
  });

  describe('EAI_STABLE_EXIT_CODES=1 — category buckets', () => {
    beforeEach(() => {
      process.env.EAI_STABLE_EXIT_CODES = '1';
    });

    it('maps E0xx (project/config) to 1', () => {
      expect(exitCodeFor(ErrorCode.E001)).toBe(1);
      expect(exitCodeFor(ErrorCode.E005)).toBe(1);
      expect(exitCodeFor(ErrorCode.E006)).toBe(1);
    });

    it('maps E1xx (auth) to 101', () => {
      expect(exitCodeFor(ErrorCode.E101)).toBe(101);
      expect(exitCodeFor(ErrorCode.E102)).toBe(101);
      expect(exitCodeFor(ErrorCode.E103)).toBe(101);
      expect(exitCodeFor(ErrorCode.E104)).toBe(101);
    });

    it('maps E2xx (platform) to 201', () => {
      expect(exitCodeFor(ErrorCode.E201)).toBe(201);
      expect(exitCodeFor(ErrorCode.E202)).toBe(201);
      expect(exitCodeFor(ErrorCode.E203)).toBe(201);
      expect(exitCodeFor(ErrorCode.E204)).toBe(201);
      expect(exitCodeFor(ErrorCode.E205)).toBe(201);
    });

    it('maps E3xx (validation) to 121 — under the 128+ signal range', () => {
      expect(exitCodeFor(ErrorCode.E301)).toBe(121);
      expect(exitCodeFor(ErrorCode.E302)).toBe(121);
      expect(exitCodeFor(ErrorCode.E303)).toBe(121);
      expect(exitCodeFor(ErrorCode.E304)).toBe(121);
      expect(exitCodeFor(ErrorCode.E305)).toBe(121);
    });

    it('every returned code fits in the POSIX 8-bit exit-status range', () => {
      for (const code of Object.values(ErrorCode)) {
        const exit = exitCodeFor(code);
        expect(exit, `${code} → ${exit}`).toBeGreaterThanOrEqual(0);
        expect(exit, `${code} → ${exit}`).toBeLessThanOrEqual(255);
      }
    });
  });

  describe('JSON envelope agreement', () => {
    beforeEach(() => {
      process.env.EAI_STABLE_EXIT_CODES = '1';
    });

    it('JSON envelope exitCode matches what process.exit() will actually surface', () => {
      // The OS truncates exit status to low 8 bits. Asserting both that the
      // envelope reports the bucketed code AND that the bucketed code already
      // fits in 8 bits is what guarantees the contract.
      for (const code of Object.values(ErrorCode)) {
        const envelope = formatErrorJSON(code) as { error: { exitCode: number; code: string } };
        const expected = exitCodeFor(code);
        expect(envelope.error.exitCode, `JSON envelope for ${code}`).toBe(expected);
        expect(envelope.error.exitCode & 0xff, `mod-256 truncation for ${code}`).toBe(expected);
        expect(envelope.error.code, `JSON envelope precise code for ${code}`).toBe(code);
      }
    });
  });
});
