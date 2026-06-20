#!/usr/bin/env node

const FORBIDDEN_PUBLIC_TERMS = [
  ['Config', 'urator'].join(''),
  ['Payload', 'CMS'].join(''),
  ['O', 'PA'].join(''),
  ['Re', 'go'].join(''),
  ['AI', 'Core'].join(''),
  ['Hy', 'PE'].join(''),
  'api.ae.',
  'dev-api.',
  'test-api.',
];

function allStrings(value) {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(allStrings);
  if (value && typeof value === 'object') {
    return Object.values(value).flatMap(allStrings);
  }
  return [];
}

function validate(entries) {
  const issues = [];
  const codes = new Set();
  const reasons = new Set();

  for (const entry of entries) {
    if (codes.has(entry.code)) issues.push(`Duplicate code: ${entry.code}`);
    codes.add(entry.code);

    if (reasons.has(entry.reasonCode)) issues.push(`Duplicate reasonCode: ${entry.reasonCode}`);
    reasons.add(entry.reasonCode);

    if (!entry.publicSafe || !entry.safety?.publicSafe) {
      issues.push(`${entry.code} must be public safe`);
    }
    if (!entry.why?.length) {
      issues.push(`${entry.code} must explain why the error might happen`);
    }
    if (!entry.retry?.stopWhen?.length) {
      issues.push(`${entry.code} must include stop conditions`);
    }
    if (!entry.escalation?.include?.length) {
      issues.push(`${entry.code} must include escalation evidence`);
    }
    if (!(entry.diagnostics?.length || entry.fixes?.length)) {
      issues.push(`${entry.code} must include diagnostics or fixes`);
    }

    const text = allStrings(entry).join('\n');
    for (const term of FORBIDDEN_PUBLIC_TERMS) {
      if (text.includes(term)) {
        issues.push(`${entry.code} contains forbidden public term: ${term}`);
      }
    }
  }

  return issues;
}

async function main() {
  const { listErrorGuidance } = await import('../dist/lib/error-guidance/catalog.js');
  const entries = listErrorGuidance();
  const issues = validate(entries);
  if (issues.length > 0) {
    console.error('Error guidance validation failed:');
    for (const issue of issues) {
      console.error(`- ${issue}`);
    }
    process.exit(1);
  }

  console.log(`✓ Error guidance catalog is valid (${entries.length} entries)`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

