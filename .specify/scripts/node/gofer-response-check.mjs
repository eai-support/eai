#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function checkResponse(text, { kind = 'progress', previous = '', technical = false } = {}) {
  const findings = [];
  if (typeof text !== 'string' || !text.trim()) findings.push('EMPTY_REPLY');
  const prose = String(text ?? '').replace(/```[\s\S]*?```/g, '');
  const words = prose.trim().split(/\s+/).filter(Boolean);
  if (!technical) {
    if (/```/.test(text)) findings.push('TECHNICAL_BLOCK_IN_BUSINESS_REPLY');
    if (words.length > (kind === 'progress' ? 90 : 250)) findings.push('TOO_LONG');
    const jargon = /\b(fixture(?:s| pool)?|CRUD|tenant-boundary proof|matched serial-versus-parallel benchmark|OBO|idempotent|serializer)\b/gi;
    if (jargon.test(prose)) findings.push('EXPLAIN_IN_BUSINESS_WORDS');
    if (/\b(?:npm|gh|curl|node)\s+(?:run|api|install|\.specify)/.test(prose)) findings.push('MOVE_COMMAND_TO_EVIDENCE');
    if (prose.split(/(?<=[.!?])\s+/).some(s => s.split(/\s+/).length > 35)) findings.push('SPLIT_LONG_SENTENCE');
  }
  const normalize = value => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (kind === 'progress' && previous && normalize(previous) === normalize(prose)) findings.push('REPEATED_UPDATE');
  return { status: findings.length ? 'fail' : 'pass', findings, wordCount: words.length,
    scope: 'Mechanical writing checks only; meaning, accuracy, and host delivery still need review.' };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('Usage: gofer-response-check.mjs --input <draft-file> [--kind progress|answer] [--previous <file>] [--technical]');
    return;
  }
  const values = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--technical') values.technical = true;
    else if (['--input', '--kind', '--previous'].includes(args[i]) && args[i + 1] && !args[i + 1].startsWith('--')) values[args[i].slice(2)] = args[++i];
    else throw new Error('Unknown or missing argument');
  }
  if (!values.input || (values.kind && !['progress', 'answer'].includes(values.kind))) throw new Error('Input file and a valid reply kind are required');
  const result = checkResponse(await readFile(values.input, 'utf8'), {
    ...values, previous: values.previous ? await readFile(values.previous, 'utf8') : '',
  });
  console.log(JSON.stringify(result, null, 2));
  if (result.status === 'fail') process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => { console.error('Response check failed. Check the arguments and local input files.'); process.exitCode = 1; });
}
