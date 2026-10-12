const sensitiveKey = /token|secret|password|passwd|pwd|api[_-]?key|access[_-]?key(?:[_-]?id)?|account[_-]?key|authorization|cookie|credential|connection[_-]?string|private[_-]?key/i;

/** A key-name heuristic; opaque credentials under unrelated keys still need explicit sensitive values. */
export function isSupportSensitiveKey(key: string): boolean {
  return sensitiveKey.test(key);
}

// SECURITY: decode only candidate key spelling for recognition; reviewed text and value boundaries remain literal.
function decodeCredentialKey(key: string): string {
  const parts: string[] = [];
  let copiedUntil = 0;
  let index = 0;
  while (index < key.length) {
    if (key[index] !== '\\') { index++; continue; }
    const runStart = index;
    while (key[index] === '\\') index++;
    const code = key.slice(index + 1, index + 5);
    if (key[index] === 'u' && /^[0-9a-f]{4}$/i.test(code)) {
      parts.push(key.slice(copiedUntil, runStart), String.fromCharCode(Number.parseInt(code, 16)));
      index += 5;
      copiedUntil = index;
    }
  }
  parts.push(key.slice(copiedUntil));
  return parts.join('');
}

interface CredentialField { readonly key: string; readonly start: number; readonly tokenStart: number }

function redactCredentialValues(text: string): string {
  const escaped = new Uint8Array(text.length);
  const quoteEnds = new Uint32Array(text.length);
  const closingEnds = new Uint32Array(text.length);
  const quotes: { start: number; end: number; key: string }[] = [];
  let slashRun = 0;
  for (let index = 0; index < text.length; index++) {
    escaped[index] = slashRun % 2;
    if (text[index] === '"' || text[index] === "'") {
      const depth = slashRun % 2 ? slashRun : 0;
      quotes.push({ start: index - depth, end: index + 1, key: `${text[index]}:${depth}` });
    }
    slashRun = text[index] === '\\' ? slashRun + 1 : 0;
  }
  // SECURITY: serialized wrappers close at their own escape depth; inner quotes cannot expose a value tail.
  const nearestQuoteEnd = new Map<string, number>();
  for (let index = quotes.length - 1; index >= 0; index--) {
    const quote = quotes[index];
    quoteEnds[quote.start] = quote.end;
    closingEnds[quote.start] = nearestQuoteEnd.get(quote.key) ?? text.length;
    nearestQuoteEnd.set(quote.key, quote.end);
  }
  // SECURITY: a boundary quote must close an enclosing wrapper, not open an attached credential suffix.
  const wrapperStarts = new Uint32Array(text.length);
  const openWrappers = new Map<string, number>();
  for (const quote of quotes) {
    const opening = openWrappers.get(quote.key);
    if (opening === undefined) openWrappers.set(quote.key, quote.start + 1);
    else { wrapperStarts[quote.start] = opening; openWrappers.delete(quote.key); }
  }
  const closingWrapper = new Uint32Array(text.length + 1);
  for (let index = text.length - 1; index >= 0; index--) {
    const afterQuote = quoteEnds[index];
    if (!wrapperStarts[index]) continue;
    if (quoteEnds[afterQuote]) {
      if (closingWrapper[afterQuote]) closingWrapper[index] = Math.max(wrapperStarts[index], closingWrapper[afterQuote]);
    } else if (/^[\s&,;}\]]?$/.test(text[afterQuote] ?? '')) closingWrapper[index] = wrapperStarts[index];
  }

  // SECURITY: every position is cached, including containers inside serialized outer quotes.
  const containerEnds = new Uint32Array(text.length);
  const nextDelimiter = new Uint32Array(text.length + 1);
  nextDelimiter[text.length] = text.length;
  for (let index = text.length - 1; index >= 0; index--) {
    if (quoteEnds[index]) nextDelimiter[index] = nextDelimiter[closingEnds[index]];
    else if (text[index] === ']' || text[index] === '}') nextDelimiter[index] = index;
    else if (text[index] === '[' || text[index] === '{') {
      const close = nextDelimiter[index + 1];
      const expected = text[index] === '[' ? ']' : '}';
      containerEnds[index] = text[close] === expected ? close + 1 : text.length;
      nextDelimiter[index] = nextDelimiter[containerEnds[index]];
    } else nextDelimiter[index] = nextDelimiter[index + 1];
  }

  const fields: CredentialField[] = [];
  for (const match of text.matchAll(/[\w.\\-]+/g)) {
    const rawKey = match[0];
    const fullEnd = match.index + rawKey.length;
    let keyEnd = fullEnd;
    if (text[fullEnd] === '"' || text[fullEnd] === "'") {
      while (keyEnd > match.index && text[keyEnd - 1] === '\\') keyEnd--;
    }
    const key = decodeCredentialKey(text.slice(match.index, keyEnd));
    let start = keyEnd;
    if (quoteEnds[start]) start = quoteEnds[start];
    else if (keyEnd < fullEnd && quoteEnds[fullEnd]) start = quoteEnds[fullEnd];
    const separator = start;
    while (start < text.length && /\s/.test(text[start])) start++;
    if (text[start] === '=' || text[start] === ':') start++;
    else if (!key.startsWith('--') || start === separator) continue;
    while (start < text.length && /\s/.test(text[start])) start++;
    fields.push({ key, start, tokenStart: match.index });
  }
  const fieldStarts = new Set(fields.map(field => field.tokenStart));
  const stops = new Uint32Array(text.length + 1);
  stops[text.length] = text.length;
  for (let index = text.length - 1; index >= 0; index--) {
    if (quoteEnds[index]) stops[index] = stops[closingEnds[index]];
    else if (containerEnds[index]) stops[index] = stops[containerEnds[index]];
    else if (!escaped[index] && /[\s&,;}]/.test(text[index])) stops[index] = index;
    else stops[index] = stops[index + 1];
  }
  // SECURITY: independent spans include nested malformed assignments; union them before copying any text.
  const spans: { start: number; end: number }[] = [];
  for (const { key, start, tokenStart } of fields) {
    if (!isSupportSensitiveKey(key)) continue;
    const markerEnd = start + '[redacted]'.length;
    if (text.startsWith('[redacted]', start) && ((closingWrapper[markerEnd] && closingWrapper[markerEnd] <= tokenStart) || fieldStarts.has(markerEnd) || /^[\s&,;}\]]?$/.test(text[markerEnd] ?? ''))) continue;
    const containerEnd = containerEnds[start];
    const completeContainer = containerEnd && ((closingWrapper[containerEnd] && closingWrapper[containerEnd] <= tokenStart) || /^[\s&,;}\]]?$/.test(text[containerEnd] ?? ''));
    const end = quoteEnds[start] ? closingEnds[start] : completeContainer ? containerEnd : stops[start];
    if (end <= start) continue;
    const previous = spans.at(-1);
    if (previous && previous.end >= start) previous.end = Math.max(previous.end, end);
    else spans.push({ start, end });
  }
  const parts: string[] = [];
  let cursor = 0;
  for (const { start, end } of spans) {
    parts.push(text.slice(cursor, start), '[redacted]');
    cursor = end;
  }
  parts.push(text.slice(cursor));
  return parts.join('');
}

/**
 * Removes known credential values, credential-shaped text and unsafe terminal controls before review.
 * Supply values from every credential source: pattern matching alone cannot identify opaque secrets.
 */
export function redactSupportText(text: string, sensitiveValues: readonly string[] = []): string {
  let safe = text;
  for (const value of sensitiveValues) {
    if (value) safe = safe.split(value).join('[redacted]');
  }
  safe = redactCredentialValues(safe);
  return safe
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[redacted-private-key]')
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 [redacted]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[redacted-jwt]')
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]{16,})\b/g, '[redacted-key]')
    .replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, '$1[redacted]@')
    .replace(/([?&](?:sig|signature|access_token|token|key|code)=)[^&#\s]*/gi, '$1[redacted]')
    .replace(/#draft=[^\s"']+/gi, '#draft=[redacted]')
    // eslint-disable-next-line no-control-regex -- Upstream terminal escapes must not execute during report review.
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    // eslint-disable-next-line no-control-regex -- Strip upstream terminal controls while retaining readable lines and tabs.
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '');
}

/** Redacts a JSON-compatible tree without mutating it; sensitive-key values become placeholders and strings use text redaction. */
export function redactSupportBundle<T>(value: T, sensitiveValues: readonly string[] = []): T {
  if (typeof value === 'string') return redactSupportText(value, sensitiveValues) as T;
  if (Array.isArray(value)) return value.map(item => redactSupportBundle(item, sensitiveValues)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key, isSupportSensitiveKey(key) ? '[redacted]' : redactSupportBundle(item, sensitiveValues),
    ])) as T;
  }
  return value;
}
