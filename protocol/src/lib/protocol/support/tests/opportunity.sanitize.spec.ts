import { describe, test, expect } from 'bun:test';
import { stripUuids } from '../opportunity.sanitize';

describe('stripUuids', () => {
  test('removes a single UUID', () => {
    expect(stripUuids('hello e037ca5a-d5ce-426e-80d1-37660a6a1221 world'))
      .toBe('hello world');
  });

  test('removes multiple UUIDs', () => {
    expect(stripUuids('user e037ca5a-d5ce-426e-80d1-37660a6a1221 and e037ca5a-d5ce-426e-80d1-37660a6a1222'))
      .toBe('user and');
  });

  test('cleans up "(from <uuid>)" pattern', () => {
    expect(stripUuids('Seref Yarar (from e037ca5a-d5ce-426e-80d1-37660a6a1221) at Index'))
      .toBe('Seref Yarar at Index');
  });

  test('cleans up empty parens after UUID removal', () => {
    expect(stripUuids('Name (e037ca5a-d5ce-426e-80d1-37660a6a1221) end'))
      .toBe('Name end');
  });

  test('handles uppercase UUIDs', () => {
    expect(stripUuids('ID: E037CA5A-D5CE-426E-80D1-37660A6A1221'))
      .toBe('ID:');
  });

  test('preserves text without UUIDs', () => {
    expect(stripUuids('No UUIDs here at all'))
      .toBe('No UUIDs here at all');
  });

  test('handles empty string', () => {
    expect(stripUuids('')).toBe('');
  });

  test('collapses multiple spaces after removal', () => {
    expect(stripUuids('a  e037ca5a-d5ce-426e-80d1-37660a6a1221  b'))
      .toBe('a b');
  });

  test('cleans up parens with only "and" filler after UUID removal', () => {
    expect(stripUuids('Name (e037ca5a-d5ce-426e-80d1-37660a6a1221 and e037ca5a-d5ce-426e-80d1-37660a6a1222) end'))
      .toBe('Name end');
  });

  test('cleans up parens with comma filler after UUID removal', () => {
    expect(stripUuids('Name (e037ca5a-d5ce-426e-80d1-37660a6a1221, e037ca5a-d5ce-426e-80d1-37660a6a1222) end'))
      .toBe('Name end');
  });

  test('cleans up parens with "from" and comma filler after UUID removal', () => {
    expect(stripUuids('Name (from e037ca5a-d5ce-426e-80d1-37660a6a1221, e037ca5a-d5ce-426e-80d1-37660a6a1222) end'))
      .toBe('Name end');
  });

  test('preserves parens with meaningful content after UUID removal', () => {
    expect(stripUuids('Name (CEO, e037ca5a-d5ce-426e-80d1-37660a6a1221) end'))
      .toBe('Name (CEO) end');
  });

  test('does not strip "and"/"from" in parens without UUIDs', () => {
    expect(stripUuids('Name (CEO and CTO) end'))
      .toBe('Name (CEO and CTO) end');
  });

  test('does not strip "from" in parens without UUIDs', () => {
    expect(stripUuids('Name (from NY) end'))
      .toBe('Name (from NY) end');
  });
});
