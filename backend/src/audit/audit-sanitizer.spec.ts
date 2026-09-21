import { buildAuditDiff, sanitizeAuditValue } from './audit-sanitizer';

describe('audit sanitizer', () => {
  it('redacts secrets recursively while preserving response fields', () => {
    expect(
      sanitizeAuditValue({
        id: '1',
        nested: { passwordHash: 'hash', value: 'visible' },
      }),
    ).toEqual({
      id: '1',
      nested: { passwordHash: '[REDACTED]', value: 'visible' },
    });
  });

  it('builds a field-level before and after comparison', () => {
    expect(
      buildAuditDiff(
        { name: 'Old', status: 'draft' },
        { name: 'New', status: 'draft' },
      ),
    ).toEqual({ name: { before: 'Old', after: 'New' } });
  });
});
