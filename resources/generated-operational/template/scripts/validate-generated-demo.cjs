#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({
  module: 'CommonJS',
  moduleResolution: 'node',
});
process.env.TS_NODE_TRANSPILE_ONLY = 'true';
require('ts-node/register');

const {
  resolveGeneratedDemoRuntime,
} = require('../src/lib/generated-demo/runtime-contract.ts');
const artifact = require('../src/eai.config/generated-demo.json');
if (artifact === null) {
  console.log('generated demo is unconfigured');
  process.exit(0);
}

const expectedAppKey =
  process.env.EAI_PRODUCT_SLUG ||
  process.env.EAI_APP_KEY ||
  artifact?.appDefinition?.appKey;
const resolved = resolveGeneratedDemoRuntime(artifact, expectedAppKey);
if (resolved.status !== 'ready') {
  console.error(
    'generated demo artifact failed validation:',
    resolved.errors?.join('; ') || 'unconfigured',
  );
  process.exit(1);
}

const allowedCoreComponents = new Set([
  'Button',
  'ButtonGroup',
  'ButtonGroupSeparator',
  'Input',
  'Label',
  'Checkbox',
  'Textarea',
  'Badge',
  'Select',
  'SelectContent',
  'SelectGroup',
  'SelectItem',
  'SelectLabel',
  'SelectTrigger',
  'SelectValue',
  'Switch',
  'Dialog',
  'DialogContent',
  'DialogDescription',
  'DialogFooter',
  'DialogHeader',
  'DialogTitle',
  'DialogTrigger',
  'Table',
  'TableBody',
  'TableCaption',
  'TableCell',
  'TableFooter',
  'TableHead',
  'TableHeader',
  'TableRow',
  'Tabs',
  'TabsContent',
  'TabsList',
  'TabsTrigger',
  'Card',
  'CardContent',
  'CardDescription',
  'CardFooter',
  'CardHeader',
  'CardTitle',
  'Alert',
  'AlertDescription',
  'AlertTitle',
  'Progress',
  'Avatar',
  'AvatarFallback',
  'AvatarImage',
  'Separator',
  'RadioGroup',
  'RadioGroupItem',
  'cn',
]);
const forbiddenIdentifiers = new Set([
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'EventSource',
  'navigator',
  'location',
  'window',
  'document',
  'globalThis',
  'localStorage',
  'sessionStorage',
  'eval',
  'Function',
  'require',
  'process',
  'Buffer',
  'Worker',
  'SharedWorker',
  'Image',
  'self',
  'top',
  'parent',
  'frames',
  'opener',
  'history',
  'navigation',
  'URL',
  'Blob',
  'FileReader',
]);
const forbiddenElements = new Set([
  'script',
  'iframe',
  'object',
  'embed',
  'link',
  'meta',
  'base',
  'a',
  'area',
  'form',
  'portal',
]);
const forbiddenBrowserProperties = new Set([
  'location', 'href', 'ownerDocument', 'defaultView', 'document', 'window',
  'top', 'parent', 'opener', 'frames', 'history', 'navigation', 'baseURI',
  'documentURI', 'open', 'assign', 'replace', 'postMessage', 'sendBeacon',
  'createElement', 'createElementNS', 'cloneElement', 'createPortal',
  'innerHTML', 'outerHTML', 'insertAdjacentHTML', 'setAttribute',
  'setAttributeNS', 'submit', 'requestSubmit', 'click',
  'constructor', '__proto__', 'prototype',
]);
const forbiddenJsxAttributes = new Set([
  'href', 'action', 'formAction', 'target', 'srcDoc',
  'dangerouslySetInnerHTML', 'ref', 'asChild', 'is',
]);
const generatedRoot = path.resolve(__dirname, '../src/generated');
const sourcePaths = new Set(
  artifact.sourceBundle.files.map((file) =>
    path.resolve(__dirname, '..', file.path),
  ),
);
const failures = [];

function allowedModule(specifier, fromFile, importClause) {
  if (specifier.startsWith('.')) {
    const resolvedPath = path.resolve(path.dirname(fromFile), specifier);
    if (!resolvedPath.startsWith(`${generatedRoot}${path.sep}`)) return false;
    const candidates = [
      resolvedPath,
      `${resolvedPath}.ts`,
      `${resolvedPath}.tsx`,
      `${resolvedPath}.css`,
      path.join(resolvedPath, 'index.ts'),
      path.join(resolvedPath, 'index.tsx'),
    ];
    return candidates.some((candidate) => sourcePaths.has(candidate));
  }
  if (
    specifier === '@/lib/generated-demo/contract' &&
    importClause?.isTypeOnly &&
    importClause.namedBindings &&
    ts.isNamedImports(importClause.namedBindings)
  ) {
    const imports = importClause.namedBindings.elements;
    return (
      imports.length === 1 &&
      !imports[0].propertyName &&
      imports[0].name.text === 'GeneratedDemoAppProps'
    );
  }
  if (specifier === 'react' || specifier === 'lucide-react') return true;
  if (specifier === '@enterpriseaigroup/core') {
    if (
      !importClause?.namedBindings ||
      !ts.isNamedImports(importClause.namedBindings)
    )
      return false;
    return importClause.namedBindings.elements.every((element) =>
      allowedCoreComponents.has(
        element.propertyName?.text || element.name.text,
      ),
    );
  }
  return false;
}

function inspectSource(file, diskPath) {
  if (file.path.endsWith('.css')) {
    const decodedCss = file.content.replace(/\\([0-9a-f]{1,6}\s?|.)/gi, (_escape, sequence) => {
      const value = sequence.trim();
      if (!/^[0-9a-f]{1,6}$/i.test(value)) return sequence;
      const codePoint = parseInt(value, 16);
      return codePoint > 0x10ffff || codePoint === 0 ? '\ufffd' : String.fromCodePoint(codePoint);
    });
    if (/@import\b|url\s*\(|image-set\s*\(/i.test(decodedCss))
      failures.push(`${file.path}: external CSS imports are forbidden`);
    return;
  }
  const parsed = ts.createSourceFile(
    file.path,
    file.content,
    ts.ScriptTarget.Latest,
    true,
    file.path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  if (parsed.parseDiagnostics.length)
    failures.push(`${file.path}: invalid TypeScript syntax`);
  function visit(node) {
    if (ts.isImportDeclaration(node)) {
      const moduleName = node.moduleSpecifier.text;
      if (!allowedModule(moduleName, diskPath, node.importClause))
        failures.push(`${file.path}: import ${moduleName} is not allowed`);
    }
    if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      if (!allowedModule(node.moduleSpecifier.text, diskPath))
        failures.push(`${file.path}: re-export is not allowed`);
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      failures.push(`${file.path}: dynamic import is not allowed`);
    }
    if (ts.isMetaProperty(node))
      failures.push(`${file.path}: import.meta is not allowed`);
    if (ts.isImportEqualsDeclaration(node))
      failures.push(`${file.path}: import equals is not allowed`);
    if (
      ts.isIdentifier(node) &&
      forbiddenIdentifiers.has(node.text) &&
      !(
        ts.isPropertyAccessExpression(node.parent) && node.parent.name === node
      ) &&
      !(ts.isPropertyAssignment(node.parent) && node.parent.name === node)
    ) {
      failures.push(`${file.path}: ${node.text} is not allowed in demo source`);
    }
    if (
      (ts.isPropertyAccessExpression(node) && forbiddenBrowserProperties.has(node.name.text)) ||
      (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression) &&
        forbiddenBrowserProperties.has(node.argumentExpression.text)) ||
      (ts.isImportSpecifier(node) &&
        forbiddenBrowserProperties.has(node.propertyName?.text || node.name.text))
    ) {
      failures.push(`${file.path}: browser navigation or DOM mutation is not allowed in demo source`);
    }
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      ((ts.isIdentifier(node.tagName) && forbiddenElements.has(node.tagName.text)) ||
        ts.isJsxNamespacedName(node.tagName))
    ) {
      failures.push(
        `${file.path}: <${node.tagName.text}> is not allowed in demo source`,
      );
    }
    if (ts.isJsxSpreadAttribute(node) ||
        (ts.isJsxAttribute(node) && ts.isIdentifier(node.name) &&
          forbiddenJsxAttributes.has(node.name.text))) {
      failures.push(
        `${file.path}: navigation-capable markup is not allowed in demo source`,
      );
    }
    ts.forEachChild(node, visit);
  }
  visit(parsed);
}

for (const file of artifact.sourceBundle.files) {
  const diskPath = path.resolve(__dirname, '..', file.path);
  if (!diskPath.startsWith(`${generatedRoot}${path.sep}`)) {
    failures.push(`${file.path}: source path escapes generated root`);
    continue;
  }
  try {
    if (fs.lstatSync(diskPath).isSymbolicLink()) {
      failures.push(`${file.path}: symlink source is not allowed`);
      continue;
    }
    if (
      !fs
        .realpathSync(diskPath)
        .startsWith(`${fs.realpathSync(generatedRoot)}${path.sep}`)
    ) {
      failures.push(`${file.path}: source resolves outside generated root`);
      continue;
    }
    if (fs.readFileSync(diskPath, 'utf8') !== file.content) {
      failures.push(`${file.path}: disk bytes differ from accepted source`);
      continue;
    }
    inspectSource(file, diskPath);
  } catch {
    failures.push(`${file.path}: accepted source file is missing`);
  }
}

if (failures.length) {
  console.error('generated demo source guard failed:');
  for (const failure of [...new Set(failures)]) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('generated demo source guard passed');
