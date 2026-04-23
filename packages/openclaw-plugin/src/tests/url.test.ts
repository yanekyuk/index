import { describe, expect, test } from 'bun:test';

import { deriveUrls } from '../lib/utils/url.js';

describe('deriveUrls', () => {
  test('production: https://index.network', () => {
    const result = deriveUrls('https://index.network');
    expect(result.protocolUrl).toBe('https://protocol.index.network');
    expect(result.frontendUrl).toBe('https://index.network');
  });

  test('staging: https://dev.index.network', () => {
    const result = deriveUrls('https://dev.index.network');
    expect(result.protocolUrl).toBe('https://protocol.dev.index.network');
    expect(result.frontendUrl).toBe('https://dev.index.network');
  });

  test('custom subdomain: https://staging.example.com', () => {
    const result = deriveUrls('https://staging.example.com');
    expect(result.protocolUrl).toBe('https://protocol.staging.example.com');
    expect(result.frontendUrl).toBe('https://staging.example.com');
  });

  test('localhost with default frontend port: http://localhost:5173', () => {
    const result = deriveUrls('http://localhost:5173');
    expect(result.protocolUrl).toBe('http://localhost:3001');
    expect(result.frontendUrl).toBe('http://localhost:5173');
  });

  test('localhost with custom port: http://localhost:8080', () => {
    const result = deriveUrls('http://localhost:8080');
    expect(result.protocolUrl).toBe('http://localhost:3001');
    expect(result.frontendUrl).toBe('http://localhost:8080');
  });

  test('localhost without port: http://localhost', () => {
    const result = deriveUrls('http://localhost');
    expect(result.protocolUrl).toBe('http://localhost:3001');
    expect(result.frontendUrl).toBe('http://localhost');
  });

  test('strips trailing slash', () => {
    const result = deriveUrls('https://index.network/');
    expect(result.protocolUrl).toBe('https://protocol.index.network');
    expect(result.frontendUrl).toBe('https://index.network');
  });

  test('legacy protocolUrl passthrough via fromProtocolUrl', () => {
    const result = deriveUrls('https://protocol.index.network');
    expect(result.protocolUrl).toBe('https://protocol.index.network');
    expect(result.frontendUrl).toBe('https://index.network');
  });

  test('legacy protocol dev URL passthrough', () => {
    const result = deriveUrls('https://protocol.dev.index.network');
    expect(result.protocolUrl).toBe('https://protocol.dev.index.network');
    expect(result.frontendUrl).toBe('https://dev.index.network');
  });

  test('127.0.0.1 is treated as localhost', () => {
    const result = deriveUrls('http://127.0.0.1:5173');
    expect(result.protocolUrl).toBe('http://localhost:3001');
    expect(result.frontendUrl).toBe('http://127.0.0.1:5173');
  });

  test('IPv6 ::1 is treated as localhost', () => {
    const result = deriveUrls('http://[::1]:5173');
    expect(result.protocolUrl).toBe('http://localhost:3001');
    expect(result.frontendUrl).toBe('http://[::1]:5173');
  });
});
