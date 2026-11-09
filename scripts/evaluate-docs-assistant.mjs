#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const featureDir = path.resolve('.specify/specs/342-governed-documentation-experience');
const corpusPath = process.env.EAI_DOCS_EVALUATION_CORPUS || path.join(featureDir, 'evaluation-corpus.jsonl');
const endpoint = process.env.EAI_DOCS_ASSISTANT_API_URL;
const outputPath = process.env.EAI_DOCS_EVALUATION_OUTPUT || path.join(featureDir, 'evidence', 'evaluation-receipt.json');

if (!endpoint) throw new Error('Set EAI_DOCS_ASSISTANT_API_URL to the Website public chat endpoint.');

const corpusText = await readFile(corpusPath, 'utf8');
const rows = corpusText.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
const results = [];

for (const row of rows) {
  const startedAt = performance.now();
  let response;
  let payload;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: row.question, surface: 'docs' }),
    });
    payload = await response.json();
  } catch (error) {
    results.push({ id: row.id, elapsedMs: Math.round(performance.now() - startedAt), networkError: String(error) });
    continue;
  }

  const citations = Array.isArray(payload.sources) ? payload.sources.map((source) => source.url).filter(Boolean) : [];
  const allowed = new Set(row.approvedSourceUrls || []);
  const validCitations = citations.filter((url) => allowed.has(url));
  const noAnswer = /could not find|no answer|not available/i.test(String(payload.message || ''));
  results.push({
    id: row.id,
    status: response.status,
    elapsedMs: Math.round(performance.now() - startedAt),
    citations,
    validCitationCount: validCitations.length,
    expectedOutcome: row.expectedOutcome,
    noAnswer,
  });
}

const answerable = results.filter((result) => result.expectedOutcome === 'cited-answer');
const negative = results.filter((result) => result.expectedOutcome !== 'cited-answer');
const allCitations = results.reduce((count, result) => count + result.citations.length, 0);
const validCitations = results.reduce((count, result) => count + result.validCitationCount, 0);
const sortedLatency = results.map((result) => result.elapsedMs).sort((a, b) => a - b);
const p95 = sortedLatency[Math.max(0, Math.ceil(sortedLatency.length * 0.95) - 1)] || 0;
const receipt = {
  schemaVersion: 1,
  evaluatedAt: new Date().toISOString(),
  endpoint,
  corpusSha256: createHash('sha256').update(corpusText).digest('hex'),
  metrics: {
    citationPrecision: allCitations ? validCitations / allCitations : 0,
    citedAnswerCoverage: answerable.length ? answerable.filter((result) => result.validCitationCount > 0).length / answerable.length : 0,
    refusalCorrectness: negative.length ? negative.filter((result) => result.noAnswer).length / negative.length : 0,
    p95LatencyMs: p95,
  },
  results,
};

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(receipt, null, 2)}\n`);
console.log(outputPath);
