import { buildAuditDiff, sanitizeAuditValue } from './audit-sanitizer';
import { Types } from 'mongoose';

describe('audit sanitizer', () => {
  it('preserves imported raw material extra fields stored as a Map', () => {
    expect(
      sanitizeAuditValue({ extraFields: new Map([['source', 'Import']]) }),
    ).toEqual({ extraFields: { source: 'Import' } });
  });

  it('redacts recovery credentials in document snapshots', () => {
    expect(sanitizeAuditValue({ resetTokenHash: 'private-hash' })).toEqual({
      resetTokenHash: '[REDACTED]',
    });
  });

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

  it('serializes MongoDB ObjectId values as hexadecimal strings', () => {
    const id = new Types.ObjectId();

    expect(sanitizeAuditValue({ _id: id })).toEqual({
      _id: id.toHexString(),
    });
  });
});
