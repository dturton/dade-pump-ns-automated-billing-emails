import { parseEmailList } from '../src/TypeScript/lib/emailAddress';

describe('parseEmailList', () => {
  it('returns nothing for empty input', () => {
    expect(parseEmailList('')).toEqual({ valid: [], invalid: [] });
    expect(parseEmailList('  ;, ')).toEqual({ valid: [], invalid: [] });
    expect(parseEmailList(null)).toEqual({ valid: [], invalid: [] });
    expect(parseEmailList(undefined)).toEqual({ valid: [], invalid: [] });
  });

  it('splits on commas, semicolons and newlines', () => {
    expect(parseEmailList(' ap@example.com , billing@example.com;owner@example.org\nx@y.io ').valid).toEqual([
      'ap@example.com',
      'billing@example.com',
      'owner@example.org',
      'x@y.io',
    ]);
  });

  it('splits bare whitespace-separated addresses', () => {
    expect(parseEmailList('ap@example.com billing@example.com').valid).toEqual(['ap@example.com', 'billing@example.com']);
  });

  it('accepts "Name <address>" entries', () => {
    expect(parseEmailList('AP Team <ap@example.com>; Jane Doe <jane@example.com>').valid).toEqual(['ap@example.com', 'jane@example.com']);
  });

  it('reports invalid entries and keeps the valid ones', () => {
    const r = parseEmailList('ap@example.com, not-an-email; @nope.com, bad@domain');
    expect(r.valid).toEqual(['ap@example.com']);
    expect(r.invalid).toEqual(['not-an-email', '@nope.com', 'bad@domain']);
  });

  it('de-duplicates case-insensitively, keeping the first spelling', () => {
    expect(parseEmailList('AP@Example.com, ap@example.com; ap@EXAMPLE.COM').valid).toEqual(['AP@Example.com']);
  });
});

import { resolveRecipients } from '../src/TypeScript/lib/emailAddress';

describe('resolveRecipients', () => {
  it('prefers the notification field when it has a valid address', () => {
    expect(resolveRecipients('ap@example.com; bad-entry', 'owner@example.com')).toEqual({
      addresses: ['ap@example.com'],
      source: 'primary',
      invalid: ['bad-entry'],
    });
  });

  it('falls back to the customer email when the notification field is empty', () => {
    expect(resolveRecipients('', 'owner@example.com')).toEqual({ addresses: ['owner@example.com'], source: 'fallback', invalid: [] });
    expect(resolveRecipients(null, 'Owner <owner@example.com>')).toEqual({ addresses: ['owner@example.com'], source: 'fallback', invalid: [] });
  });

  it('falls back when the notification field has no valid address, keeping the invalid entries for logging', () => {
    expect(resolveRecipients('n/a', 'owner@example.com')).toEqual({ addresses: ['owner@example.com'], source: 'fallback', invalid: ['n/a'] });
  });

  it('returns none when neither field has a valid address', () => {
    expect(resolveRecipients('', '')).toEqual({ addresses: [], source: 'none', invalid: [] });
    expect(resolveRecipients('nope', 'also nope')).toEqual({ addresses: [], source: 'none', invalid: ['nope', 'also', 'nope'] });
  });
});
