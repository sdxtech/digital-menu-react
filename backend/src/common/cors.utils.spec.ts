import { parseCorsOrigins } from './cors.utils';

describe('parseCorsOrigins', () => {
  it('returns normalized unique origins', () => {
    const result = parseCorsOrigins(
      ' http://localhost:5173,https://corp.example,https://corp.example ',
    );

    expect(result).toEqual(['http://localhost:5173', 'https://corp.example']);
  });

  it('throws when wildcard is provided', () => {
    expect(() => parseCorsOrigins('http://localhost:5173,*')).toThrow(
      'Wildcard CORS origin is not allowed',
    );
  });

  it('throws when value is empty', () => {
    expect(() => parseCorsOrigins(' ,  ')).toThrow(
      'CORS_ORIGIN must contain at least one origin',
    );
  });
});
