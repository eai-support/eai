#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DOCS_URL = 'https://docs.eai.software/services/publicapi/v4/resource-mutation-contract';
const OBJECT_TYPE_ROUTING_CONFIG_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'config',
  'object-type-routing.json'
);
const SOURCE_EXTENSIONS = new Set(['.cjs', '.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx', '.vue']);
const RESOURCE_URL_PATTERN =
  /(?:\/api\/eai)?\/v4\/data\/resources|(?<![\w$])(?:this\s*\.\s*)?(?:resources?BaseUrl|resourceUrl)\s*\(/;
const NON_RECORD_MUTATION_PATTERN =
  /\/(?:object-types|query|search|aggregate|batch|files|links|shares|parents|storage)(?:\/|['"`}]|$)/;
const RESOURCE_ROUTING_METHODS = Object.freeze([
  'collection',
  'member',
  'subresource',
  'collectionOperation',
  'query',
  'search',
  'schema',
  'objectTypes',
  'objectType',
  'parent',
]);
const RESOURCE_ROUTING_CALLEE_PATTERN =
  `this\\s*\\.\\s*routing\\s*\\.\\s*(?:${RESOURCE_ROUTING_METHODS.join('|')})`;
const RESOURCE_ROUTING_ROUTE_PREFIX = 'eai-resource-routing:';
const RESOURCE_ROUTING_NON_RECORD_FAMILIES = new Set([
  'subresource',
  'collectionOperation',
  'query',
  'search',
  'schema',
  'parent',
]);
const NON_NETWORK_ROUTE_CONSUMERS = new Set(['URL']);
const IS_DIRECT_RUN =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
const FIXED_AUDIT_ROOTS = ['src', 'app', 'pages', 'lib', 'packages'];
const GOVERNED_REPOSITORY_ROOTS = ['front/eai-app-template'];
const SOLE_ROUTE_OWNER = 'front/eai-app-template/packages/platform-sdk/src/resource-routing.ts';

function assertObjectTypeRoutingConfig(config) {
  if (
    config?.schemaVersion !== 'eai.object-type-routing.source-audit-config/v1' ||
    config?.contractVersion !== 'eai.object-type-routing/v1' ||
    !Array.isArray(config.fixedRoots) ||
    !Array.isArray(config.governedRepositoryRoots) ||
    !Array.isArray(config.excludedDirectories) ||
    typeof config.soleOwner !== 'string' ||
    typeof config.canonicalGuidance !== 'string' ||
    JSON.stringify(config.fixedRoots) !== JSON.stringify(FIXED_AUDIT_ROOTS) ||
    JSON.stringify(config.governedRepositoryRoots) !==
      JSON.stringify(GOVERNED_REPOSITORY_ROOTS) ||
    config.soleOwner !== SOLE_ROUTE_OWNER
  ) {
    throw new Error(`Invalid immutable Object Type routing config: ${OBJECT_TYPE_ROUTING_CONFIG_PATH}`);
  }
  return Object.freeze({
    fixedRoots: Object.freeze([...config.fixedRoots]),
    governedRepositoryRoots: Object.freeze([...config.governedRepositoryRoots]),
    excludedDirectories: new Set(config.excludedDirectories),
    soleOwner: config.soleOwner.replace(/\\/g, '/'),
    canonicalGuidance: config.canonicalGuidance,
  });
}

const OBJECT_TYPE_ROUTING_CONFIG = assertObjectTypeRoutingConfig(
  JSON.parse(await fs.readFile(OBJECT_TYPE_ROUTING_CONFIG_PATH, 'utf8'))
);

export const OBJECT_TYPE_ROUTING_AUDIT_CONFIG = Object.freeze({
  fixedRoots: [...OBJECT_TYPE_ROUTING_CONFIG.fixedRoots],
  governedRepositoryRoots: [...OBJECT_TYPE_ROUTING_CONFIG.governedRepositoryRoots],
  excludedDirectories: [...OBJECT_TYPE_ROUTING_CONFIG.excludedDirectories].sort(),
  soleOwner: OBJECT_TYPE_ROUTING_CONFIG.soleOwner,
  canonicalGuidance: OBJECT_TYPE_ROUTING_CONFIG.canonicalGuidance,
});

function lineNumber(content, index) {
  return content.slice(0, index).split(/\r?\n/).length;
}

function maskNonCode(content) {
  const masked = [...content];
  let quote = '';
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    const next = content[index + 1];

    if (lineComment) {
      if (character === '\n') {
        lineComment = false;
      } else {
        masked[index] = ' ';
      }
      continue;
    }
    if (blockComment) {
      if (character === '*' && next === '/') {
        masked[index] = ' ';
        masked[index + 1] = ' ';
        index += 1;
        blockComment = false;
      } else if (character !== '\n') {
        masked[index] = ' ';
      }
      continue;
    }
    if (quote) {
      if (character !== '\n') masked[index] = ' ';
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === quote) {
        quote = '';
      }
      continue;
    }
    if (character === '/' && next === '/') {
      masked[index] = ' ';
      masked[index + 1] = ' ';
      index += 1;
      lineComment = true;
      continue;
    }
    if (character === '/' && next === '*') {
      masked[index] = ' ';
      masked[index + 1] = ' ';
      index += 1;
      blockComment = true;
      continue;
    }
    if (character === "'" || character === '"' || character === '`') {
      masked[index] = ' ';
      quote = character;
    }
  }

  return masked.join('');
}

function callSnippets(content, calleePattern) {
  const snippets = [];
  const masked = maskNonCode(content);
  const regex = new RegExp(`(?<![\\w$])(?:${calleePattern})(?![\\w$])`, 'g');
  let match;

  while ((match = regex.exec(masked)) !== null) {
    let openIndex = match.index + match[0].length;
    while (/\s/.test(masked[openIndex] || '')) openIndex += 1;

    if (masked.slice(openIndex, openIndex + 2) === '?.') {
      openIndex += 2;
      while (/\s/.test(masked[openIndex] || '')) openIndex += 1;
    }

    if (masked[openIndex] === '<') {
      let genericDepth = 0;
      for (let index = openIndex; index < masked.length; index += 1) {
        if (masked[index] === '<') genericDepth += 1;
        if (masked[index] === '>' && masked[index - 1] !== '=') {
          genericDepth -= 1;
          if (genericDepth === 0) {
            openIndex = index + 1;
            break;
          }
        }
      }
      while (/\s/.test(masked[openIndex] || '')) openIndex += 1;
    }

    if (masked.slice(openIndex, openIndex + 2) === '?.') {
      openIndex += 2;
      while (/\s/.test(masked[openIndex] || '')) openIndex += 1;
    }

    if (masked[openIndex] !== '(') continue;
    let depth = 0;
    for (let index = openIndex; index < content.length; index += 1) {
      const character = masked[index];
      if (character === '(') depth += 1;
      if (character === ')') {
        depth -= 1;
        if (depth === 0) {
          snippets.push({
            start: match.index,
            end: index + 1,
            text: content.slice(match.index, index + 1),
            callee: content.slice(match.index, match.index + match[0].length).replace(/\s+/g, ''),
            openOffset: openIndex - match.index,
          });
          regex.lastIndex = index + 1;
          break;
        }
      }
    }
  }

  return snippets;
}

function splitTopLevel(content) {
  const masked = maskNonCode(content);
  const segments = [];
  let segmentStart = 0;
  let depth = 0;

  for (let index = 0; index < masked.length; index += 1) {
    const character = masked[index];
    if (character === '{' || character === '[' || character === '(') depth += 1;
    if (character === '}' || character === ']' || character === ')') depth -= 1;
    if (character === ',' && depth === 0) {
      segments.push(content.slice(segmentStart, index).trim());
      segmentStart = index + 1;
    }
  }
  segments.push(content.slice(segmentStart).trim());
  return segments;
}

function callArguments(snippet, openOffset) {
  const openIndex = openOffset ?? maskNonCode(snippet).indexOf('(');
  if (openIndex === -1 || !snippet.endsWith(')')) return [];
  return splitTopLevel(snippet.slice(openIndex + 1, -1));
}

function literalRouteSegment(expression) {
  const match = expression.trim().match(/^(['"`])([^'"`]*)\1$/);
  if (!match || match[2].includes('${')) return undefined;
  return match[2].replace(/^\/+|\/+$/g, '') || undefined;
}

function canonicalResourceRoutingRoute(expression) {
  const call = callSnippets(expression, RESOURCE_ROUTING_CALLEE_PATTERN)[0];
  if (!call) return undefined;

  const prefix = expression.slice(0, call.start);
  const suffix = expression.slice(call.end);
  if (!/^\s*\(*\s*$/.test(prefix) || !/^\s*\)*\s*$/.test(suffix)) return undefined;

  const method = call.callee.split('.').at(-1);
  const args = callArguments(call.text, call.openOffset);
  const family =
    method === 'subresource' && literalRouteSegment(args[2] || '') === 'actions'
      ? 'action'
      : method;
  return `${RESOURCE_ROUTING_ROUTE_PREFIX}${family}`;
}

function canonicalResourceRoutingFamily(route) {
  return route.startsWith(RESOURCE_ROUTING_ROUTE_PREFIX)
    ? route.slice(RESOURCE_ROUTING_ROUTE_PREFIX.length)
    : undefined;
}

function objectLiteralBody(expression) {
  let candidate = expression.trim();
  const stringifyMatch = /^JSON\s*\.\s*stringify\s*\(/.exec(maskNonCode(candidate));
  if (stringifyMatch) {
    const args = callArguments(candidate);
    candidate = args[0]?.trim() || '';
  }
  if (!candidate.startsWith('{')) return null;

  const masked = maskNonCode(candidate);
  let depth = 0;
  for (let index = 0; index < masked.length; index += 1) {
    if (masked[index] === '{') depth += 1;
    if (masked[index] === '}') {
      depth -= 1;
      if (depth === 0) {
        return candidate.slice(1, index);
      }
    }
  }
  return null;
}

function topLevelPropertyExpression(objectExpression, propertyName) {
  const objectBody = objectLiteralBody(objectExpression);
  if (objectBody === null) return undefined;
  for (const segment of splitTopLevel(objectBody)) {
    if (segment.trim() === propertyName) return propertyName;
    const match = segment.match(
      /^(?:['"`]([A-Za-z_$][\w$]*)['"`]|([A-Za-z_$][\w$]*))\s*:\s*([\s\S]+)$/
    );
    if ((match?.[1] || match?.[2]) === propertyName) return match[3].trim();
  }
  return undefined;
}

function methodOf(optionsExpression) {
  const normalizedOptions = optionsExpression.trim();
  if (!normalizedOptions || normalizedOptions === 'undefined') {
    return { method: 'GET', resolved: true };
  }

  const objectBody = objectLiteralBody(normalizedOptions);
  if (objectBody === null) return { method: undefined, resolved: false };

  let methodExpression;
  let unresolvedAssignment = false;
  for (const segment of splitTopLevel(objectBody)) {
    const candidate = segment.trim();
    if (candidate.startsWith('...') || candidate.startsWith('[')) {
      methodExpression = undefined;
      unresolvedAssignment = true;
      continue;
    }

    if (candidate === 'method') {
      methodExpression = candidate;
      unresolvedAssignment = false;
      continue;
    }

    const match = candidate.match(/^(?:['"`]method['"`]|method)\s*:\s*([\s\S]+)$/);
    if (match) {
      methodExpression = match[1].trim();
      unresolvedAssignment = false;
    }
  }

  if (unresolvedAssignment) return { method: undefined, resolved: false };
  if (methodExpression === undefined) return { method: 'GET', resolved: true };
  const method = methodExpression.match(/^['"`](GET|POST|PUT|PATCH|DELETE)['"`]$/i)?.[1];
  return method
    ? { method: method.toUpperCase(), resolved: true }
    : { method: undefined, resolved: false };
}

function objectLiteralArgument(expression) {
  const stringifyIndex = expression.search(/JSON\s*\.\s*stringify\s*\(/);
  if (stringifyIndex === -1) return null;
  const openParenthesis = expression.indexOf('(', stringifyIndex);
  let index = openParenthesis + 1;
  while (/\s/.test(expression[index] || '')) index += 1;
  return objectLiteralBody(expression.slice(index));
}

function topLevelObjectProperties(objectBody) {
  const properties = new Set();
  let segmentStart = 0;
  let depth = 0;
  let quote = '';
  let escaped = false;

  function recordSegment(end) {
    const segment = objectBody.slice(segmentStart, end).trim();
    const property = segment.match(
      /^(?:['"`]([A-Za-z_$][\w$]*)['"`]|([A-Za-z_$][\w$]*))\s*(?::|$)/
    );
    const name = property?.[1] || property?.[2];
    if (name) properties.add(name);
  }

  for (let index = 0; index < objectBody.length; index += 1) {
    const character = objectBody[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === quote) {
        quote = '';
      }
      continue;
    }
    if (character === "'" || character === '"' || character === '`') {
      quote = character;
      continue;
    }
    if (character === '{' || character === '[' || character === '(') depth += 1;
    if (character === '}' || character === ']' || character === ')') depth -= 1;
    if (character === ',' && depth === 0) {
      recordSegment(index);
      segmentStart = index + 1;
    }
  }
  recordSegment(objectBody.length);
  return properties;
}

function hasObjectEnvelope(bodyExpression, requiredProperties) {
  const objectBody = objectLiteralArgument(bodyExpression);
  if (objectBody === null) return false;
  const properties = topLevelObjectProperties(objectBody);
  return requiredProperties.every((property) => properties.has(property));
}

function simpleResourceBindings(content) {
  const bindings = new Map();
  const masked = maskNonCode(content);
  const bindingPattern = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g;
  let match;

  while ((match = bindingPattern.exec(masked)) !== null) {
    const expressionStart = match.index + match[0].length;
    let expressionEnd = masked.indexOf(';', expressionStart);
    if (expressionEnd === -1) expressionEnd = content.length;
    const expression = content.slice(expressionStart, expressionEnd).trim();
    const canonicalRoute = canonicalResourceRoutingRoute(expression);
    if (canonicalRoute || RESOURCE_URL_PATTERN.test(expression)) {
      bindings.set(match[1], canonicalRoute || expression);
    }
  }
  return bindings;
}

function resolvedResourceRoute(expression, bindings) {
  const canonicalRoute = canonicalResourceRoutingRoute(expression);
  if (canonicalRoute) return canonicalRoute;
  if (RESOURCE_URL_PATTERN.test(expression)) return expression;
  const identifier = expression.trim().match(/^([A-Za-z_$][\w$]*)$/)?.[1];
  return identifier ? bindings.get(identifier) : undefined;
}

function isResourceMemberRoute(route) {
  const routingFamily = canonicalResourceRoutingFamily(route);
  if (routingFamily) return routingFamily === 'member';

  const resourceUrlCall = route.match(/(?:this\s*\.\s*)?resourceUrl\s*\(([\s\S]*?)\)/);
  if (resourceUrlCall) {
    return splitTopLevel(resourceUrlCall[1]).length >= 2;
  }

  const marker = '/v4/data/resources';
  const markerIndex = route.indexOf(marker);
  if (markerIndex === -1) return false;
  const suffix = route
    .slice(markerIndex + marker.length)
    .split(/[?#]/, 1)[0]
    .replace(/['"`)}\];,\s]+$/g, '');
  const segments = suffix.split('/').filter(Boolean);
  if (segments.length >= 3) return true;
  if (segments.length < 2) return false;

  const firstSegment = segments[0];
  const isExplicitTenantSegment =
    /tenant/i.test(firstSegment) ||
    /^\$\{[^}]*tenant[^}]*\}$/i.test(firstSegment) ||
    /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(firstSegment);
  return !isExplicitTenantSegment;
}

function enclosingBlockEnd(content, start) {
  const masked = maskNonCode(content);
  let depth = 0;
  for (let index = 0; index < start; index += 1) {
    if (masked[index] === '{') depth += 1;
    if (masked[index] === '}') depth -= 1;
  }
  if (depth === 0) return content.length;

  const targetDepth = depth - 1;
  for (let index = start; index < masked.length; index += 1) {
    if (masked[index] === '{') depth += 1;
    if (masked[index] === '}') {
      depth -= 1;
      if (depth === targetDepth) return index;
    }
  }
  return content.length;
}

function normalizedExpression(expression) {
  let normalized = expression.replace(/\s+/g, '');
  while (normalized.startsWith('(') && normalized.endsWith(')')) {
    normalized = normalized.slice(1, -1);
  }
  return normalized;
}

function actionResultBinding(content, actionStart) {
  const prefix = maskNonCode(content.slice(0, actionStart));
  const destructured = prefix.match(
    /(?:const|let|var)\s*\{([^{}]+)\}(?:\s*:\s*[^=]+)?\s*=\s*await\s*\(?\s*$/
  );
  if (destructured) {
    for (const property of splitTopLevel(destructured[1])) {
      const versionBinding = property
        .trim()
        .match(/^version(?:\s*:\s*([A-Za-z_$][\w$]*))?$/);
      if (versionBinding) {
        return {
          resultName: undefined,
          versionNames: new Set([versionBinding[1] || 'version']),
        };
      }
    }
  }

  const declarations = [
    ...prefix.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g),
  ].reverse();

  for (const declaration of declarations) {
    const candidate = prefix.slice(declaration.index);
    const binding = candidate.match(
      /^(?:const|let|var)\s+([A-Za-z_$][\w$]*)(?:\s*:\s*[^=]*?)?\s*=\s*await\s*\(?\s*$/
    );
    if (binding) {
      return { resultName: binding[1], versionNames: new Set() };
    }
  }

  const assignment = prefix.match(
    /(?:^|[;{}])\s*([A-Za-z_$][\w$]*)\s*=\s*await\s*\(?\s*$/
  );
  return {
    resultName: assignment?.[1],
    versionNames: new Set(),
  };
}

function versionExpressionsBeforeUpdate(binding, flowPrefix) {
  const accepted = new Set(binding.versionNames);
  if (binding.resultName) accepted.add(`${binding.resultName}.version`);

  const masked = maskNonCode(flowPrefix);
  if (binding.resultName) {
    const escapedResult = binding.resultName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const propertyAlias = new RegExp(
      `\\b(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)(?:\\s*:\\s*[^=]+)?\\s*=\\s*${escapedResult}\\s*\\.\\s*version\\b`,
      'g'
    );
    for (const match of masked.matchAll(propertyAlias)) accepted.add(match[1]);

    const destructuredAlias = new RegExp(
      `\\b(?:const|let|var)\\s*\\{\\s*version(?:\\s*:\\s*([A-Za-z_$][\\w$]*))?\\s*\\}\\s*=\\s*${escapedResult}\\b`,
      'g'
    );
    for (const match of masked.matchAll(destructuredAlias)) {
      accepted.add(match[1] || 'version');
    }
  }

  for (const sourceName of [...accepted]) {
    if (sourceName.includes('.')) continue;
    const escapedSource = sourceName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const localAlias = new RegExp(
      `\\b(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)(?:\\s*:\\s*[^=]+)?\\s*=\\s*${escapedSource}\\b`,
      'g'
    );
    for (const match of masked.matchAll(localAlias)) accepted.add(match[1]);
  }

  return accepted;
}

function violation(ruleId, file, content, index, message, remediation) {
  return {
    ruleId,
    file,
    line: lineNumber(content, index),
    message,
    remediation,
    documentation: DOCS_URL,
  };
}

export function validateSourceContent(content, file = '<memory>') {
  const violations = [];
  const bindings = simpleResourceBindings(content);
  const requests = callSnippets(
    content,
    '[A-Za-z_$][\\w$]*(?:\\s*\\.\\s*[A-Za-z_$][\\w$]*)*'
  );

  for (const request of requests) {
    const callee = request.callee;
    const terminalCallee = callee.split('.').at(-1);
    const args = callArguments(request.text, request.openOffset);
    const isNetworkLike =
      terminalCallee === 'fetch' ||
      terminalCallee === 'platformFetch' ||
      /(?:fetch|request|send|call)$/i.test(terminalCallee || '');
    if (!isNetworkLike) continue;

    const route = resolvedResourceRoute(args[0] || '', bindings);
    if (!route) {
      const routeExpression = (args[0] || '').trim();
      const optionsExpression = args[1] || '{}';
      const methodResult = methodOf(optionsExpression);
      const isLiteralNonV4Route =
        /^['"`]/.test(routeExpression) && !/\/v4\/data\/resources/.test(routeExpression);
      const isUnresolvedResourceCandidate =
        !isLiteralNonV4Route && /resource/i.test(routeExpression);
      const isMutationCandidate =
        !methodResult.resolved || ['POST', 'PUT', 'PATCH'].includes(methodResult.method);

      if (isUnresolvedResourceCandidate && isMutationCandidate) {
        violations.push(
          violation(
            'EAI_V4_RESOURCE_PATTERN_UNRESOLVED',
            file,
            content,
            request.start,
            'A mutation-capable PublicAPI resource request uses a route that cannot be proven.',
            'Use the canonical resource SDK or keep the literal /v4/data/resources route in the network call.'
          )
        );
      }
      continue;
    }

    if (NON_NETWORK_ROUTE_CONSUMERS.has(terminalCallee)) continue;

    if (terminalCallee !== 'fetch' && terminalCallee !== 'platformFetch') {
      violations.push(
        violation(
          'EAI_V4_RESOURCE_PATTERN_UNRESOLVED',
          file,
          content,
          request.start,
          `A PublicAPI v4 resource request is hidden behind unsupported helper ${callee}().`,
          'Use the canonical resource SDK or a direct fetch/platformFetch call with a literal method and body envelope.'
        )
      );
      continue;
    }

    const optionsExpression = args[1] || '{}';
    const methodResult = methodOf(optionsExpression);
    if (!methodResult.resolved) {
      violations.push(
        violation(
          'EAI_V4_RESOURCE_PATTERN_UNRESOLVED',
          file,
          content,
          request.start,
          'A PublicAPI v4 resource request uses a dynamic or unresolved HTTP method.',
          'Use a literal GET, POST, PUT, PATCH, or DELETE method so Gofer can prove the mutation contract.'
        )
      );
      continue;
    }

    const method = methodResult.method;
    const bodyExpression = topLevelPropertyExpression(optionsExpression, 'body') || '';
    const routingFamily = canonicalResourceRoutingFamily(route);
    const isObjectTypeManagement =
      /\/object-types(?:\/|['"`}]|$)/.test(route) ||
      routingFamily === 'objectTypes' ||
      routingFamily === 'objectType';
    const isAction = /\/actions\//.test(route) || routingFamily === 'action';
    const isOperation = /\/operations\//.test(route);
    const routeShapeResolved =
      /\/v4\/data\/resources/.test(route) ||
      /\b(?:this\.)?resources?BaseUrl\s*\(/.test(route) ||
      /\b(?:this\.)?resourceUrl\s*\(/.test(route) ||
      routingFamily !== undefined;

    if (method === 'PATCH' && !isObjectTypeManagement) {
      violations.push(
        violation(
          'EAI_V4_RESOURCE_PATCH_FORBIDDEN',
          file,
          content,
          request.start,
          'PATCH is not a valid PublicAPI v4 resource record update.',
          'Use PUT with {"data": {...}, "version": n}.'
        )
      );
      continue;
    }

    if (!routeShapeResolved && ['POST', 'PUT'].includes(method)) {
      violations.push(
        violation(
          'EAI_V4_RESOURCE_PATTERN_UNRESOLVED',
          file,
          content,
          request.start,
          'A PublicAPI v4 resource mutation route is constructed dynamically and its route family cannot be proven.',
          'Use the canonical resource SDK or keep the literal /v4/data/resources route in the fetch call.'
        )
      );
      continue;
    }

    if (method === 'PUT' && !isObjectTypeManagement) {
      if (!hasObjectEnvelope(bodyExpression, ['data', 'version'])) {
        violations.push(
          violation(
            'EAI_V4_RESOURCE_ENVELOPE_REQUIRED',
            file,
            content,
            request.start,
            'A PublicAPI v4 resource update is not provably wrapped in data and version.',
            'Send PUT with JSON.stringify({ data, version }).'
          )
        );
      }
      continue;
    }

    if (method !== 'POST') continue;
    if (isAction || isOperation) {
      if (!hasObjectEnvelope(bodyExpression, ['params'])) {
        violations.push(
          violation(
            'EAI_V4_RESOURCE_ENVELOPE_REQUIRED',
            file,
            content,
            request.start,
            `A PublicAPI v4 resource ${isOperation ? 'operation' : 'action'} is missing the params envelope.`,
            'Send POST with JSON.stringify({ params }).'
          )
        );
      }
      continue;
    }
    if (
      isObjectTypeManagement ||
      NON_RECORD_MUTATION_PATTERN.test(route) ||
      RESOURCE_ROUTING_NON_RECORD_FAMILIES.has(routingFamily)
    ) {
      continue;
    }
    if (isResourceMemberRoute(route)) {
      violations.push(
        violation(
          'EAI_V4_RESOURCE_METHOD_REQUIRED',
          file,
          content,
          request.start,
          'POST is not a valid PublicAPI v4 resource record update.',
          'Use PUT with JSON.stringify({ data, version }) for a member resource route.'
        )
      );
      continue;
    }
    if (!hasObjectEnvelope(bodyExpression, ['data'])) {
      violations.push(
        violation(
          'EAI_V4_RESOURCE_ENVELOPE_REQUIRED',
          file,
          content,
          request.start,
          'A PublicAPI v4 resource create is not provably wrapped in data.',
          'Send POST with JSON.stringify({ data }).'
        )
      );
    }
  }

  const actionCalls = callSnippets(
    content,
    '[A-Za-z_$][\\w$]*(?:\\s*\\))?\\s*\\.\\s*executeAction'
  );
  for (const [actionIndex, actionCall] of actionCalls.entries()) {
    const receiver = actionCall.text.match(
      /^([A-Za-z_$][\w$]*)\s*(?:\)\s*)?\.\s*executeAction/
    )?.[1];
    if (!receiver) continue;
    let flowEnd = enclosingBlockEnd(content, actionCall.end);
    for (const nextAction of actionCalls.slice(actionIndex + 1)) {
      if (nextAction.start >= flowEnd) break;
      const nextReceiver = nextAction.text.match(
        /^([A-Za-z_$][\w$]*)\s*(?:\)\s*)?\.\s*executeAction/
      )?.[1];
      if (nextReceiver === receiver) {
        flowEnd = nextAction.start;
        break;
      }
    }
    const afterAction = content.slice(actionCall.end, flowEnd);
    const escapedReceiver = receiver.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const actionBinding = actionResultBinding(content, actionCall.start);
    const updateCalls = callSnippets(afterAction, `${escapedReceiver}\\s*\\.\\s*update`);

    for (const updateCall of updateCalls) {
      const versionExpression = callArguments(updateCall.text, updateCall.openOffset)[3];
      const acceptedVersions = versionExpressionsBeforeUpdate(
        actionBinding,
        afterAction.slice(0, updateCall.start)
      );
      const usesActionVersion =
        versionExpression &&
        acceptedVersions.has(normalizedExpression(versionExpression));

      if (!usesActionVersion) {
        violations.push(
          violation(
            'EAI_V4_RESOURCE_STALE_VERSION_FLOW',
            file,
            content,
            actionCall.end + updateCall.start,
            'An action is followed by update without passing the action result version as the update version argument.',
            'Capture executeAction(), then call updateFrom(objectType, actionResult, data) or pass actionResult.version as update() argument four.'
          )
        );
      }
    }
  }

  return violations;
}

function rawObjectTypeRouteFindings(content, file) {
  if (file.replace(/\\/g, '/') === OBJECT_TYPE_ROUTING_CONFIG.soleOwner) return [];

  const findings = [];
  const pattern = /(?:\/api\/eai)?\/v4\/data\/resources\b/g;
  let match;
  while ((match = pattern.exec(content)) !== null) {
    const prefix = content.slice(0, match.index);
    const lineStart = Math.max(prefix.lastIndexOf('\n'), prefix.lastIndexOf('\r')) + 1;
    findings.push({
      contractVersion: 'eai.object-type-routing/v1',
      rule: 'OBJECT_TYPE_DIRECT_ROUTE_CONSTRUCTION',
      classification: 'blocking_source_drift',
      severity: 'error',
      location: {
        kind: 'source',
        file,
        line: lineNumber(content, match.index),
        column: match.index - lineStart + 1,
      },
      field: null,
      offendingValue: match[0],
      expectedValue: 'shared platform SDK or approved BFF route owner',
      remediation: OBJECT_TYPE_ROUTING_CONFIG.canonicalGuidance,
    });
  }
  return findings;
}

async function sourceFiles(root) {
  const files = [];

  async function visit(directory) {
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      if (entry.isDirectory() && OBJECT_TYPE_ROUTING_CONFIG.excludedDirectories.has(entry.name)) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(absolute);
      } else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
        files.push(absolute);
      }
    }
  }

  for (const repositoryRoot of ['', ...OBJECT_TYPE_ROUTING_CONFIG.governedRepositoryRoots]) {
    for (const fixedRoot of OBJECT_TYPE_ROUTING_CONFIG.fixedRoots) {
      await visit(path.join(root, repositoryRoot, fixedRoot));
    }
  }
  const soleOwner = path.join(root, ...OBJECT_TYPE_ROUTING_CONFIG.soleOwner.split('/'));
  try {
    if ((await fs.stat(soleOwner)).isFile()) files.push(soleOwner);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  return [...new Set(files)].sort((left, right) => left.localeCompare(right));
}

export async function validateWorkspace(workspace) {
  const root = path.resolve(workspace);
  const files = await sourceFiles(root);
  const violations = [];
  for (const file of files) {
    const content = await fs.readFile(file, 'utf8');
    const relativeFile = path.relative(root, file).split(path.sep).join('/');
    violations.push(...validateSourceContent(content, relativeFile));
    violations.push(...rawObjectTypeRouteFindings(content, relativeFile));
  }
  violations.sort((left, right) => {
    const leftFile = left.location?.file ?? left.file ?? '';
    const rightFile = right.location?.file ?? right.file ?? '';
    return (
      leftFile.localeCompare(rightFile) ||
      (left.location?.line ?? left.line ?? 0) - (right.location?.line ?? right.line ?? 0) ||
      String(left.rule ?? left.ruleId).localeCompare(String(right.rule ?? right.ruleId))
    );
  });
  return {
    valid: violations.length === 0,
    filesScanned: files.length,
    violations,
  };
}

function parseArgs(argv) {
  const args = { workspace: process.cwd(), json: false };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--workspace') {
      const workspace = argv[index + 1];
      if (!workspace || workspace.startsWith('-')) {
        throw new Error('--workspace requires a path.');
      }
      args.workspace = workspace;
      index += 1;
    } else if (argv[index] === '--json') {
      args.json = true;
    } else if (argv[index] === '--help' || argv[index] === '-h') {
      process.stdout.write(
        'Usage: validate-v4-resource-contract.mjs [--workspace <path>] [--json]\n'
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${argv[index]}`);
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await validateWorkspace(args.workspace);
  if (args.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else if (result.valid) {
    process.stdout.write(
      `PASS PublicAPI v4 resource mutation contract (${result.filesScanned} files scanned)\n`
    );
  } else {
    for (const item of result.violations) {
      const rule = item.rule ?? item.ruleId;
      const location = item.location ?? { file: item.file, line: item.line };
      process.stderr.write(
        `${location.file}:${location.line} ${rule}: ${item.message ?? item.remediation}\n` +
          `  Fix: ${item.remediation}\n` +
          (item.documentation ? `  Docs: ${item.documentation}\n` : '')
      );
    }
  }
  process.exitCode = result.valid ? 0 : 1;
}

if (IS_DIRECT_RUN) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
