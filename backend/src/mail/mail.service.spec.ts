import { createHash } from 'crypto';
import { MailService } from './mail.service';

describe('MailService', () => {
  it('adds queue deduplication and safe retention options', async () => {
    const queue = {
      add: jest.fn().mockResolvedValue({ id: 'job-1' }),
    };
    const values: Record<string, string> = {
      EMAIL_FROM: 'Food Recipe System <no-reply@notify.plvpilot.space>',
    };
    const config = {
      get: jest.fn((key: string) => values[key]),
      getOrThrow: jest.fn((key: string) => {
        const value = values[key];
        if (!value) throw new Error(`Missing ${key}`);
        return value;
      }),
    };
    const service = new MailService(queue as never, config as never);

    await service.enqueue({
      to: 'chef@example.com',
      subject: 'Approved',
      text: 'Approved',
      deduplicationKey: 'recipe-approved-1-chef-1',
    });

    const expectedJobId = `mail-${createHash('sha256')
      .update('recipe-approved-1-chef-1')
      .digest('hex')}`;
    expect(queue.add).toHaveBeenCalledWith(
      'send',
      expect.objectContaining({
        to: 'chef@example.com',
      }),
      expect.objectContaining({
        jobId: expectedJobId,
        attempts: 3,
        removeOnComplete: { age: 86_400, count: 1_000 },
      }),
    );
  });

  it('redirects recipients when the development override is configured', async () => {
    const queue = {
      add: jest.fn().mockResolvedValue({ id: 'job-2' }),
    };
    const values: Record<string, string> = {
      EMAIL_FROM: 'Food Recipe System <no-reply@notify.plvpilot.space>',
      EMAIL_RECIPIENT_OVERRIDE: 'developer@plvpilot.space',
    };
    const config = {
      get: jest.fn((key: string) => values[key]),
      getOrThrow: jest.fn((key: string) => values[key]),
    };
    const service = new MailService(queue as never, config as never);

    await service.enqueue({ to: 'manager@example.com', subject: 'Test' });

    expect(queue.add).toHaveBeenCalledWith(
      'send',
      expect.objectContaining({
        to: 'developer@plvpilot.space',
        originalTo: 'manager@example.com',
      }),
      expect.any(Object),
    );
  });
});
