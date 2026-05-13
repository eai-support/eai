import { describe, expect, test } from 'vitest';
import {
  extractEnterprisePackageVersions,
  hashJson,
  parseScopedRegistry,
} from '../../scripts/sync-linked-sources.js';

describe('extractEnterprisePackageVersions', () => {
  test('keeps only @enterpriseaigroup packages with stable ordering', () => {
    const packages = extractEnterprisePackageVersions({
      packages: {
        'node_modules/lodash': { version: '4.17.21' },
        'node_modules/@enterpriseaigroup/demo': {
          version: '1.0.57',
          resolved: 'https://example.test/demo-1.0.57.tgz',
        },
        'node_modules/@enterpriseaigroup/core': {
          version: '1.0.68',
          resolved: 'https://example.test/core-1.0.68.tgz',
        },
      },
    });

    expect(packages).toEqual({
      '@enterpriseaigroup/core': {
        version: '1.0.68',
        resolved: 'https://example.test/core-1.0.68.tgz',
      },
      '@enterpriseaigroup/demo': {
        version: '1.0.57',
        resolved: 'https://example.test/demo-1.0.57.tgz',
      },
    });
  });
});

describe('parseScopedRegistry', () => {
  test('reads the scoped registry from npmrc content', () => {
    expect(parseScopedRegistry(`
      # comment
      @enterpriseaigroup:registry=https://enterpriseaigroup.github.io/enterpriseai-packages/registry
    `)).toBe('https://enterpriseaigroup.github.io/enterpriseai-packages/registry');
  });

  test('returns null when the scope is not configured', () => {
    expect(parseScopedRegistry('registry=https://registry.npmjs.org/')).toBeNull();
  });
});

describe('hashJson', () => {
  test('is stable for identical payloads', () => {
    const payload = {
      '@enterpriseaigroup/core': { version: '1.0.68', resolved: null },
      '@enterpriseaigroup/demo': { version: '1.0.57', resolved: null },
    };

    expect(hashJson(payload)).toBe(hashJson(payload));
  });
});
