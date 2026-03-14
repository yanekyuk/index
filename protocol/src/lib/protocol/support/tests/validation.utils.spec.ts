import { config } from 'dotenv';
config({ path: '.env.test' });

import { describe, expect, test } from 'bun:test';

import { isValidUUID } from '../validation.utils';

describe('isValidUUID', () => {
  test('accepts valid UUID v4', () => {
    expect(isValidUUID('c2505011-2e45-426e-81dd-b9abb9b72023')).toBe(true);
  });

  test('accepts uppercase UUID', () => {
    expect(isValidUUID('C2505011-2E45-426E-81DD-B9ABB9B72023')).toBe(true);
  });

  test('rejects non-UUID alphanumeric string', () => {
    expect(isValidUUID('TS9uwW4671WavtWJtSMrjeBLzL1KZJPb')).toBe(false);
  });

  test('rejects empty string', () => {
    expect(isValidUUID('')).toBe(false);
  });

  test('rejects UUID without dashes', () => {
    expect(isValidUUID('c25050112e45426e81ddb9abb9b72023')).toBe(false);
  });
});
