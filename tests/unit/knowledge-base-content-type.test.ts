/** KB-only Markdown MIME normalization keeps general resource/document rules unchanged. */
import { describe, expect, test } from 'vitest';
import { resolveKnowledgeBaseContentType } from '../../src/commands/knowledge-base.js';
import { resolveUploadContentType } from '../../src/lib/api.js';

describe('KB Markdown media type normalization', () => {
  test.each(['notes.md', 'notes.MD', 'notes.markdown', 'notes.MARKDOWN'])(
    '%s infers canonical Markdown for supported extensions', name => {
      expect(resolveKnowledgeBaseContentType(name)).toBe('text/markdown');
    },
  );

  test.each(['', 'application/octet-stream', 'APPLICATION/OCTET-STREAM', 'text/plain', 'TEXT/PLAIN'])(
    'known Markdown filename limits the %s fallback', contentType => {
      expect(resolveKnowledgeBaseContentType('notes.MARKDOWN', contentType)).toBe('text/markdown');
      expect(resolveKnowledgeBaseContentType('notes.md', contentType)).toBe('text/markdown');
    },
  );

  test.each(['text/markdown', 'TEXT/MARKDOWN', 'text/x-markdown', 'TEXT/X-MARKDOWN'])(
    'explicit %s is canonicalized without rewriting the file', contentType => {
      expect(resolveKnowledgeBaseContentType('notes.md', contentType)).toBe('text/markdown');
      expect(resolveKnowledgeBaseContentType('explicit-source', contentType)).toBe('text/markdown');
    },
  );

  test.each(['notes.bin', 'notes.md.exe', 'notes.csv'])(
    'unrelated %s receives no octet/plain filename fallback', name => {
      expect(resolveKnowledgeBaseContentType(name, 'application/octet-stream')).toBe('application/octet-stream');
      expect(resolveKnowledgeBaseContentType(name, 'text/plain')).toBe('text/plain');
      expect(() => resolveKnowledgeBaseContentType(name, '')).toThrow('Content type must');
    },
  );

  test.each(['text/markdown; charset=utf-8', 'text/plain\r\nAuthorization: secret', '*/*', 'not-a-type', ' '])(
    'known Markdown filename does not permit invalid MIME %s', contentType => {
      expect(() => resolveKnowledgeBaseContentType('notes.md', contentType)).toThrow('Content type must');
    },
  );

  test('explicit other supported types and generic upload inference remain unchanged', () => {
    expect(resolveKnowledgeBaseContentType('notes.md', 'application/pdf')).toBe('application/pdf');
    expect(resolveKnowledgeBaseContentType('notes.pptx')).toBe('application/vnd.openxmlformats-officedocument.presentationml.presentation');
    expect(resolveUploadContentType('notes.md')).toBe('text/markdown');
    expect(resolveUploadContentType('notes.markdown')).toBe('application/octet-stream');
    expect(resolveUploadContentType('notes.md', 'text/plain')).toBe('text/plain');
    expect(resolveUploadContentType('notes.md', 'text/x-markdown')).toBe('text/x-markdown');
    expect(() => resolveUploadContentType('notes.md', '')).toThrow('Content type must');
  });
});
