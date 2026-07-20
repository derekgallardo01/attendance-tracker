const { escapeHtml } = require('../../src/lib/html');

describe('escapeHtml', () => {
  test('escapes the full 5-char set', () => {
    expect(escapeHtml(`a & b < c > d " e ' f`)).toBe('a &amp; b &lt; c &gt; d &quot; e &#39; f');
  });

  test('returns empty string for null/undefined (the guard branch)', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });

  test('coerces non-strings', () => {
    expect(escapeHtml(42)).toBe('42');
  });

  test('neutralises a script-tag injection attempt', () => {
    expect(escapeHtml('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
  });
});
