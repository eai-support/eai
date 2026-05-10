#!/usr/bin/env node

/**
 * Generate docs-site/static/llms-full.txt by concatenating archived documentation content
 */

const fs = require('fs');
const path = require('path');

const DOCS_DIR = path.join(__dirname, '../.tech-docs/legacy-src/docs/src/content/docs');
const OUTPUT_FILE = path.join(__dirname, '../docs-site/static/llms-full.txt');

// Define the order of sections
const SECTION_ORDER = [
  { title: 'Getting Started', pattern: /^getting-started\// },
  { title: 'Guides', pattern: /^guides\// },
  { title: 'Concepts', pattern: /^concepts\// },
  { title: 'Reference', pattern: /^reference\// },
  { title: 'Examples', pattern: /^examples\// },
  { title: 'Scenarios', pattern: /^scenarios\// },
];

// Sub-ordering within getting-started
const GETTING_STARTED_ORDER = [
  'installation',
  'quickstart',
  'authentication',
  'first-vertical',
];

// Sub-ordering within guides
const GUIDES_ORDER = [
  'object-types',
  'resources',
  'environment',
  'deployment',
  'ai-features',
  'multi-tenant',
  'security',
  'troubleshooting',
];

// Sub-ordering within concepts
const CONCEPTS_ORDER = [
  'platform-overview',
  'verticals',
  'architecture',
  'data-model',
  'security-model',
];

// Sub-ordering within reference/commands
const COMMANDS_ORDER = [
  'init',
  'login',
  'env',
  'types',
  'resources',
  'tenant',
  'chat',
  'docs',
  'deploy',
  'verify',
  'whoami',
  'dev',
];

/**
 * Simple frontmatter parser without dependencies
 */
function parseFrontmatter(content) {
  const frontmatterRegex = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;
  const match = content.match(frontmatterRegex);

  if (!match) {
    return { data: {}, content };
  }

  const frontmatter = match[1];
  const markdownContent = match[2];

  // Parse title from frontmatter
  const titleMatch = frontmatter.match(/^title:\s*(.+)$/m);
  const title = titleMatch ? titleMatch[1].trim().replace(/^['"]|['"]$/g, '') : '';

  return { data: { title }, content: markdownContent };
}

/**
 * Strip frontmatter, MDX components, and Astro/MDX imports from content
 */
function stripFrontmatterAndImports(content) {
  const { content: markdownContent } = parseFrontmatter(content);

  // Remove import statements
  let cleaned = markdownContent
    .replace(/^import\s+.*?from\s+['"].*?['"];?\s*$/gm, '');

  // Remove MDX components (single-line and multi-line)
  // Remove opening tags like <Card>, <CardGrid>, <Aside>, etc.
  cleaned = cleaned.replace(/<\/?(?:Card|CardGrid|LinkCard|Aside|Steps|Tabs|TabItem)[^>]*>/g, '');

  // Clean up excessive blank lines
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

  return cleaned.trim();
}

/**
 * Get all MDX files recursively
 */
function getAllMdxFiles(dir, basePath = '') {
  const files = [];
  const items = fs.readdirSync(dir);

  for (const item of items) {
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);
    const relativePath = path.join(basePath, item);

    if (stat.isDirectory()) {
      files.push(...getAllMdxFiles(fullPath, relativePath));
    } else if (item.endsWith('.mdx') || item.endsWith('.md')) {
      files.push(relativePath);
    }
  }

  return files;
}

/**
 * Extract title from frontmatter
 */
function extractTitle(filePath) {
  const content = fs.readFileSync(path.join(DOCS_DIR, filePath), 'utf-8');
  const { data } = parseFrontmatter(content);
  return data.title || path.basename(filePath, path.extname(filePath));
}

/**
 * Sort files based on predefined order
 */
function sortFiles(files) {
  const sorted = [];
  const filesBySection = {};

  // Group files by section
  for (const section of SECTION_ORDER) {
    filesBySection[section.title] = [];
  }
  filesBySection['Other'] = [];

  for (const file of files) {
    // Skip index file (will be handled first)
    if (file === 'index.mdx') continue;

    let placed = false;
    for (const section of SECTION_ORDER) {
      if (section.pattern.test(file)) {
        filesBySection[section.title].push(file);
        placed = true;
        break;
      }
    }
    if (!placed) {
      filesBySection['Other'].push(file);
    }
  }

  // Sort within each section
  filesBySection['Getting Started'].sort((a, b) => {
    const aName = path.basename(a, '.mdx');
    const bName = path.basename(b, '.mdx');
    const aIndex = GETTING_STARTED_ORDER.indexOf(aName);
    const bIndex = GETTING_STARTED_ORDER.indexOf(bName);
    if (aIndex === -1 && bIndex === -1) return 0;
    if (aIndex === -1) return 1;
    if (bIndex === -1) return -1;
    return aIndex - bIndex;
  });

  filesBySection['Guides'].sort((a, b) => {
    const aName = path.basename(a, '.mdx');
    const bName = path.basename(b, '.mdx');
    const aIndex = GUIDES_ORDER.indexOf(aName);
    const bIndex = GUIDES_ORDER.indexOf(bName);
    if (aIndex === -1 && bIndex === -1) return 0;
    if (aIndex === -1) return 1;
    if (bIndex === -1) return -1;
    return aIndex - bIndex;
  });

  filesBySection['Concepts'].sort((a, b) => {
    const aName = path.basename(a, '.mdx');
    const bName = path.basename(b, '.mdx');
    const aIndex = CONCEPTS_ORDER.indexOf(aName);
    const bIndex = CONCEPTS_ORDER.indexOf(bName);
    if (aIndex === -1 && bIndex === -1) return 0;
    if (aIndex === -1) return 1;
    if (bIndex === -1) return -1;
    return aIndex - bIndex;
  });

  // Sort commands in reference
  const referenceFiles = filesBySection['Reference'];
  const commandFiles = referenceFiles.filter(f => f.includes('reference/commands/'));
  const otherRefFiles = referenceFiles.filter(f => !f.includes('reference/commands/'));

  commandFiles.sort((a, b) => {
    const aName = path.basename(a, '.mdx');
    const bName = path.basename(b, '.mdx');
    const aIndex = COMMANDS_ORDER.indexOf(aName);
    const bIndex = COMMANDS_ORDER.indexOf(bName);
    if (aIndex === -1 && bIndex === -1) return 0;
    if (aIndex === -1) return 1;
    if (bIndex === -1) return -1;
    return aIndex - bIndex;
  });

  filesBySection['Reference'] = [...commandFiles, ...otherRefFiles];

  // Sort examples and scenarios alphabetically
  filesBySection['Examples'].sort();
  filesBySection['Scenarios'].sort();

  // Build final sorted list
  if (files.includes('index.mdx')) {
    sorted.push('index.mdx');
  }

  for (const section of SECTION_ORDER) {
    sorted.push(...filesBySection[section.title]);
  }
  sorted.push(...filesBySection['Other']);

  return sorted;
}

/**
 * Main generation function
 */
function generateLlmsFull() {
  console.log('Generating llms-full.txt...');

  const allFiles = getAllMdxFiles(DOCS_DIR);
  const sortedFiles = sortFiles(allFiles);

  let output = `# EAI CLI — Full Documentation
> Complete documentation for the EAI CLI, the command-line interface for the Enterprise AI Platform.
> This file contains all documentation pages concatenated for AI agent consumption.

Generated: ${new Date().toISOString()}

`;

  let count = 0;
  for (const file of sortedFiles) {
    const filePath = path.join(DOCS_DIR, file);
    const content = fs.readFileSync(filePath, 'utf-8');
    const title = extractTitle(file);
    const cleanContent = stripFrontmatterAndImports(content);

    // Skip if content is empty
    if (!cleanContent.trim()) continue;

    output += `---\n\n# ${title}\n\n${cleanContent}\n\n`;
    count++;
  }

  fs.writeFileSync(OUTPUT_FILE, output, 'utf-8');

  console.log(`✔ Generated ${OUTPUT_FILE}`);
  console.log(`  ${count} pages concatenated`);
  console.log(`  ${Math.round(output.length / 1024)} KB`);
}

// Run if called directly
if (require.main === module) {
  generateLlmsFull();
}

module.exports = { generateLlmsFull };
