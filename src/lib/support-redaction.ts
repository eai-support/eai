const sensitiveKey = /token|secret|password|passwd|pwd|api[_-]?key|account[_-]?key|authorization|cookie|credential|connection[_-]?string|private[_-]?key/i;

export function isSupportSensitiveKey(key: string): boolean {
  return sensitiveKey.test(key);
}

export function redactSupportText(text: string, sensitiveValues: readonly string[] = []): string {
  let safe = text;
  for (const value of sensitiveValues) {
    if (value) safe = safe.split(value).join('[redacted]');
  }
  return safe
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[redacted-private-key]')
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 [redacted]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[redacted-jwt]')
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]{16,})\b/g, '[redacted-key]')
    .replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, '$1[redacted]@')
    .replace(/((?:["']?[\w.-]*(?:token|secret|password|passwd|pwd|api[_-]?key|account[_-]?key|cookie|credential|authorization|connection[_-]?string|private[_-]?key)[\w.-]*["']?\s*[:=]\s*))(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;}]+)/gi, '$1[redacted]')
    .replace(/((?:--[\w-]*(?:token|secret|password|passwd|pwd|api[_-]?key|account[_-]?key|authorization|cookie|credential|connection[_-]?string|private[_-]?key)[\w-]*)\s+)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s]+)/gi, '$1[redacted]')
    .replace(/([?&](?:sig|signature|access_token|token|key|code)=)[^&#\s]*/gi, '$1[redacted]')
    .replace(/#draft=[^\s"']+/gi, '#draft=[redacted]')
    // eslint-disable-next-line no-control-regex -- Upstream terminal escapes must not execute during report review.
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    // eslint-disable-next-line no-control-regex -- Strip upstream terminal controls while retaining readable lines and tabs.
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '');
}

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
