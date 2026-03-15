#!/usr/bin/env node

/**
 * Build llms-full.txt — concatenates all documentation pages into a single
 * markdown file for AI coding agents.
 *
 * Usage: npx tsx docs/scripts/build-llms-full.ts
 * Output: docs/public/llms-full.txt
 */

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative, basename } from 'node:path';

const DOCS_DIR = join(import.meta.dirname, '..', 'src', 'content', 'docs');
const OUTPUT = join(import.meta.dirname, '..', 'public', 'llms-full.txt');

async function collectMdxFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectMdxFiles(fullPath));
    } else if (entry.name.endsWith('.mdx') || entry.name.endsWith('.md')) {
      if (!entry.name.startsWith('_')) {
        files.push(fullPath);
      }
    }
  }

  return files.sort();
}

function extractTitle(content: string): string {
  const match = content.match(/^title:\s*["']?(.+?)["']?\s*$/m);
  return match?.[1] || 'Untitled';
}

function stripFrontmatter(content: string): string {
  const fmMatch = content.match(/^---\n[\s\S]*?\n---\n/);
  if (fmMatch) {
    return content.slice(fmMatch[0].length).trim();
  }
  return content.trim();
}

function stripMdxComponents(content: string): string {
  // Remove import statements
  content = content.replace(/^import\s+.*$/gm, '');
  // Remove JSX component tags (keep content between them)
  content = content.replace(/<[A-Z][a-zA-Z]*[^>]*>/g, '');
  content = content.replace(/<\/[A-Z][a-zA-Z]*>/g, '');
  // Clean up excessive blank lines
  content = content.replace(/\n{3,}/g, '\n\n');
  return content.trim();
}

async function main(): Promise<void> {
  const files = await collectMdxFiles(DOCS_DIR);
  const sections: string[] = [];

  sections.push('# EAI CLI — Complete Documentation');
  sections.push('');
  sections.push('> This file contains the full EAI CLI documentation for AI coding agents.');
  sections.push(`> Generated: ${new Date().toISOString()}`);
  sections.push(`> Pages: ${files.length}`);
  sections.push('');

  for (const file of files) {
    const relPath = relative(DOCS_DIR, file);
    const content = await readFile(file, 'utf-8');
    const title = extractTitle(content);
    const body = stripMdxComponents(stripFrontmatter(content));

    sections.push(`<!-- Source: ${relPath} -->`);
    sections.push(`# ${title}`);
    sections.push('');
    sections.push(body);
    sections.push('');
    sections.push('---');
    sections.push('');
  }

  await writeFile(OUTPUT, sections.join('\n'), 'utf-8');
}

main().catch(console.error);
