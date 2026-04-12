import { parseCorsAllowedOrigins } from './env.validation';

describe('parseCorsAllowedOrigins', () => {
  it('normalizes trailing slash to origin', () => {
    expect(parseCorsAllowedOrigins('https://app.example.com/')).toEqual(['https://app.example.com']);
  });

  it('normalizes multiple entries with optional slashes and spaces', () => {
    expect(
      parseCorsAllowedOrigins('https://a.example.com/ , http://localhost:3000 '),
    ).toEqual(['https://a.example.com', 'http://localhost:3000']);
  });

  it('deduplicates after normalization', () => {
    expect(parseCorsAllowedOrigins('https://x.com,https://x.com/')).toEqual(['https://x.com']);
  });

  it('rejects entries with a path', () => {
    expect(() => parseCorsAllowedOrigins('https://app.example.com/api')).toThrow(
      /must not include a path/,
    );
  });

  it('rejects entries with query', () => {
    expect(() => parseCorsAllowedOrigins('https://app.example.com?x=1')).toThrow(
      /must not include query or hash/,
    );
  });

  it('rejects entries with hash', () => {
    expect(() => parseCorsAllowedOrigins('https://app.example.com#frag')).toThrow(
      /must not include query or hash/,
    );
  });

  it('rejects invalid URL strings', () => {
    expect(() => parseCorsAllowedOrigins('not-a-url')).toThrow(/not a valid URL/);
  });

  it('rejects non-http(s) schemes', () => {
    expect(() => parseCorsAllowedOrigins('ftp://files.example.com')).toThrow(/http or https/);
  });

  it('returns empty array for empty or whitespace-only input', () => {
    expect(parseCorsAllowedOrigins('')).toEqual([]);
    expect(parseCorsAllowedOrigins('  ,  , ')).toEqual([]);
  });
});
