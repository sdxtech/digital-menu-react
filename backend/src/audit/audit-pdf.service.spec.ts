import { AuditPdfService } from './audit-pdf.service';

describe('AuditPdfService', () => {
  it('creates a valid paginated PDF table', () => {
    const service = new AuditPdfService();
    const rows = Array.from({ length: 30 }, (_, index) => ({
      createdAt: new Date('2026-01-01T00:00:00Z'),
      actorName: `User ${index + 1}`,
      role: 'chef',
      site: 'S001',
      module: 'recipes',
      action: 'PATCH recipes/1',
      success: true,
      details: { field: 'value' },
    }));

    const pdf = service.build('Audit Log', rows, '2026-01-01 to 2026-12-31');

    expect(pdf.subarray(0, 8).toString('latin1')).toBe('%PDF-1.4');
    expect(pdf.toString('latin1')).toContain('/Count 2');
    expect(pdf.toString('latin1')).toContain('%%EOF');
  });
});
