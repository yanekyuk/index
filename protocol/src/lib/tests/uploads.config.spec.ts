import { describe, expect, test } from 'bun:test';

import { validateFileByMetadata, validateFileTypeByMetadata } from '../uploads.config';

describe('validateFileTypeByMetadata', () => {
  test('accepts files with exact MIME type match', () => {
    expect(validateFileTypeByMetadata('doc.pdf', 'application/pdf', 'general').isValid).toBe(true);
    expect(validateFileTypeByMetadata('doc.txt', 'text/plain', 'general').isValid).toBe(true);
    expect(validateFileTypeByMetadata('doc.json', 'application/json', 'general').isValid).toBe(true);
    expect(validateFileTypeByMetadata('doc.csv', 'text/csv', 'general').isValid).toBe(true);
    expect(validateFileTypeByMetadata('doc.md', 'text/markdown', 'general').isValid).toBe(true);
  });

  test('accepts files with application/octet-stream when extension is valid', () => {
    expect(validateFileTypeByMetadata('doc.md', 'application/octet-stream', 'general').isValid).toBe(true);
    expect(validateFileTypeByMetadata('doc.csv', 'application/octet-stream', 'general').isValid).toBe(true);
    expect(validateFileTypeByMetadata('doc.json', 'application/octet-stream', 'general').isValid).toBe(true);
    expect(validateFileTypeByMetadata('doc.xml', 'application/octet-stream', 'general').isValid).toBe(true);
    expect(validateFileTypeByMetadata('doc.tsv', 'application/octet-stream', 'general').isValid).toBe(true);
    expect(validateFileTypeByMetadata('doc.pdf', 'application/octet-stream', 'general').isValid).toBe(true);
    expect(validateFileTypeByMetadata('doc.docx', 'application/octet-stream', 'general').isValid).toBe(true);
  });

  test('rejects files with unsupported extensions even with octet-stream', () => {
    expect(validateFileTypeByMetadata('script.exe', 'application/octet-stream', 'general').isValid).toBe(false);
    expect(validateFileTypeByMetadata('script.sh', 'application/octet-stream', 'general').isValid).toBe(false);
    expect(validateFileTypeByMetadata('image.png', 'application/octet-stream', 'general').isValid).toBe(false);
    expect(validateFileTypeByMetadata('archive.zip', 'application/octet-stream', 'general').isValid).toBe(false);
  });

  test('rejects files with no filename or mimetype', () => {
    expect(validateFileTypeByMetadata('', 'text/plain', 'general').isValid).toBe(false);
    expect(validateFileTypeByMetadata('doc.txt', '', 'general').isValid).toBe(false);
  });

  test('rejects files with wrong MIME type for extension', () => {
    expect(validateFileTypeByMetadata('doc.pdf', 'text/html', 'general').isValid).toBe(false);
    expect(validateFileTypeByMetadata('doc.txt', 'image/png', 'general').isValid).toBe(false);
  });

  test('avatar validation still requires exact MIME type', () => {
    expect(validateFileTypeByMetadata('photo.png', 'image/png', 'avatar').isValid).toBe(true);
    expect(validateFileTypeByMetadata('photo.png', 'application/octet-stream', 'avatar').isValid).toBe(false);
  });
});

describe('validateFileByMetadata', () => {
  test('accepts valid file with octet-stream MIME', () => {
    expect(validateFileByMetadata('doc.md', 'application/octet-stream', 100, 'general').isValid).toBe(true);
  });

  test('rejects empty files', () => {
    expect(validateFileByMetadata('doc.md', 'application/octet-stream', 0, 'general').isValid).toBe(false);
  });

  test('rejects oversized files', () => {
    expect(validateFileByMetadata('doc.md', 'application/octet-stream', 11 * 1024 * 1024, 'general').isValid).toBe(false);
  });
});
