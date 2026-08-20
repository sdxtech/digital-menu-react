import { createHash } from 'crypto';
import { AuthController } from './auth.controller';

describe('AuthController password reset', () => {
  const makeController = () => {
    const users = {
      findByEmail: jest.fn(),
      setPasswordResetToken: jest.fn().mockResolvedValue(undefined),
      consumePasswordResetToken: jest.fn(),
      updatePassword: jest.fn().mockResolvedValue({ id: 'user-1' }),
      setRefreshToken: jest.fn().mockResolvedValue(undefined),
    };
    const config = {
      getOrThrow: jest.fn((key: string) => {
        if (key === 'APP_BASE_URL') return 'http://localhost:5173';
        throw new Error(`Missing ${key}`);
      }),
    };
    const mail = {
      enqueue: jest.fn().mockResolvedValue({ jobId: 'mail-1' }),
    };
    const controller = new AuthController(
      {} as never,
      users as never,
      config as never,
      mail as never,
      {} as never,
    );
    return { controller, mail, users };
  };

  it('stores a hashed expiring token and emails only the raw token', async () => {
    const { controller, mail, users } = makeController();
    users.findByEmail.mockResolvedValue({
      id: 'user-1',
      email: 'chef@example.com',
      isActive: true,
    });

    await controller.forgotPassword({ email: 'chef@example.com' });

    expect(users.setPasswordResetToken).toHaveBeenCalledWith(
      'user-1',
      expect.stringMatching(/^[a-f0-9]{64}$/),
      expect.any(Date),
    );
    const tokenHash = users.setPasswordResetToken.mock.calls[0]?.[1] as string;
    const mailInput = mail.enqueue.mock.calls[0]?.[0] as {
      text: string;
      deduplicationKey: string;
    };
    const rawToken = new URL(
      mailInput.text.split(' ').at(-1) ?? '',
    ).searchParams.get('token');
    expect(rawToken).toMatch(/^[a-f0-9]{64}$/);
    expect(
      createHash('sha256')
        .update(rawToken ?? '')
        .digest('hex'),
    ).toBe(tokenHash);
    expect(mailInput.deduplicationKey).toContain(tokenHash);
  });

  it('returns the same response without sending for an unknown account', async () => {
    const { controller, mail, users } = makeController();
    users.findByEmail.mockResolvedValue(null);

    const result = await controller.forgotPassword({
      email: 'unknown@example.com',
    });

    expect(result.ok).toBe(true);
    expect(mail.enqueue).not.toHaveBeenCalled();
    expect(users.setPasswordResetToken).not.toHaveBeenCalled();
  });

  it('consumes the hashed token before updating the password', async () => {
    const { controller, users } = makeController();
    const token = 'a'.repeat(64);
    users.consumePasswordResetToken.mockResolvedValue({ id: 'user-1' });

    await controller.resetPassword({ token, newPassword: 'new-secret' });

    expect(users.consumePasswordResetToken).toHaveBeenCalledWith(
      createHash('sha256').update(token).digest('hex'),
    );
    expect(users.updatePassword).toHaveBeenCalledWith('user-1', 'new-secret');
    expect(users.setRefreshToken).toHaveBeenCalledWith('user-1', null);
  });
});
