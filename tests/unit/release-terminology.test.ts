import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  inspectLine,
  isAllowedOccurrence,
}: {
  readonly inspectLine: (
    relativePath: string,
    line: string,
    lineNumber: number,
  ) => string | undefined;
  readonly isAllowedOccurrence: (relativePath: string, line: string) => boolean;
} = require('../../scripts/verify-release-terminology.cjs');

describe('release terminology boundary', () => {
  const historicalPair = "  'OPAMeasure\\u0000opameasure',";

  it('allows only the exact audited historical identifier declaration', () => {
    expect(
      isAllowedOccurrence('src/lib/object-type-identifiers.ts', historicalPair),
    ).toBe(true);
    expect(
      inspectLine('src/lib/object-type-identifiers.ts', historicalPair, 11),
    ).toBeUndefined();
  });

  it('does not turn the exception into a general terminology bypass', () => {
    expect(inspectLine('src/lib/other.ts', historicalPair, 3)).toBe(
      `src/lib/other.ts:3:${historicalPair}`,
    );
    expect(
      inspectLine(
        'src/lib/object-type-identifiers.ts',
        "  'OPAMeasure\\u0000opa-measure',",
        11,
      ),
    ).toContain('OPAMeasure');
    expect(inspectLine('src/lib/client.ts', 'const client = new OPAClient();', 7)).toBe(
      'src/lib/client.ts:7:const client = new OPAClient();',
    );
  });
});
