import { AuditPdfService } from './audit-pdf.service';
import { AuditService } from './audit.service';

describe('AuditService annual archive', () => {
  const makeService = (mailResult: 'success' | 'failure') => {
    const archiveLean = jest.fn().mockResolvedValue(null);
    const rows = [
      {
        _id: 'audit-1',
        module: 'recipes',
        action: 'PATCH recipes/1',
        success: true,
        createdAt: new Date('2025-06-01T00:00:00Z'),
      },
    ];
    const auditModel = {
      find: jest.fn().mockReturnValue({
        sort: jest
          .fn()
          .mockReturnValue({ lean: jest.fn().mockResolvedValue(rows) }),
      }),
      deleteMany: jest.fn().mockResolvedValue({ deletedCount: 1 }),
      create: jest.fn().mockResolvedValue(undefined),
    };
    const archiveModel = {
      findOne: jest.fn().mockReturnValue({ lean: archiveLean }),
      create: jest.fn().mockResolvedValue(undefined),
      updateOne: jest.fn().mockResolvedValue(undefined),
    };
    const files = {
      uploadObject: jest.fn().mockResolvedValue('unused-public-url'),
      presignDownload: jest
        .fn()
        .mockResolvedValue('https://private.example/audit.pdf'),
    };
    const mail = {
      sendNow:
        mailResult === 'success'
          ? jest.fn().mockResolvedValue(undefined)
          : jest.fn().mockRejectedValue(new Error('Mail unavailable')),
    };
    const users = {
      findActiveEmailRecipients: jest
        .fn()
        .mockResolvedValue([
          { id: 'admin-1', name: 'Admin', email: 'admin@example.com' },
        ]),
    };
    const service = new AuditService(
      auditModel as never,
      archiveModel as never,
      new AuditPdfService(),
      files as never,
      mail as never,
      users as never,
    );
    return { service, auditModel, archiveModel, mail };
  };

  it('deletes an annual period only after the archive email is sent', async () => {
    const { service, auditModel, mail } = makeService('success');

    await service.runAnnualArchive();

    expect(mail.sendNow).toHaveBeenCalled();
    expect(auditModel.deleteMany).toHaveBeenCalled();
    expect(mail.sendNow.mock.invocationCallOrder[0]).toBeLessThan(
      auditModel.deleteMany.mock.invocationCallOrder[0],
    );
  });

  it('keeps audit records when annual archive email delivery fails', async () => {
    const { service, auditModel, archiveModel } = makeService('failure');

    await service.runAnnualArchive();

    expect(auditModel.deleteMany).not.toHaveBeenCalled();
    expect(archiveModel.updateOne).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        $set: expect.objectContaining({ status: 'failed' }),
      }),
      expect.anything(),
    );
  });
});
