import { validateEnv } from './env.validation';

const productionEnv = () => ({
  NODE_ENV: 'production',
  CORS_ORIGIN: 'https://plvpilot.space',
  APP_BASE_URL: 'https://plvpilot.space/',
  MONGO_URI: 'mongodb://mongo.internal:27017/digital_menu',
  JWT_ACCESS_SECRET: 'access_secret_1234567890',
  JWT_REFRESH_SECRET: 'refresh_secret_0987654321',
  REDIS_URL: 'redis://redis.internal:6379',
  S3_REGION: 'us-east-1',
  S3_ACCESS_KEY: 'real-access-key',
  S3_SECRET_KEY: 'real-secret-key',
  S3_BUCKET: 'digital-menu',
  S3_PUBLIC_BASE_URL: 'https://storage.plvpilot.space/digital-menu',
  EMAIL_FROM: 'Food Recipe System <no-reply@notify.plvpilot.space>',
  HOSTINGER_MAIL_API_TOKEN: 'hostinger-valid-test-token',
  EMAIL_NOTIFICATIONS_ENABLED: 'true',
  EMAIL_RECIPIENT_OVERRIDE: '',
});

describe('validateEnv email settings', () => {
  it('normalizes the public app URL and boolean email settings', () => {
    const result = validateEnv(productionEnv());

    expect(result.APP_BASE_URL).toBe('https://plvpilot.space');
    expect(result.EMAIL_NOTIFICATIONS_ENABLED).toBe('true');
    expect(result.HOSTINGER_MAIL_API_TOKEN).toBe('hostinger-valid-test-token');
  });

  it('rejects recipient overrides in production', () => {
    expect(() =>
      validateEnv({
        ...productionEnv(),
        EMAIL_RECIPIENT_OVERRIDE: 'developer@example.com',
      }),
    ).toThrow('EMAIL_RECIPIENT_OVERRIDE must be empty in production');
  });

  it('normalizes Hostinger Mail API settings', () => {
    const result = validateEnv({
      ...productionEnv(),
      HOSTINGER_MAIL_API_TOKEN: ' hostinger-valid-test-token ',
      HOSTINGER_MAILBOX_ID: ' AC1mailbox ',
    });

    expect(result.HOSTINGER_MAIL_API_TOKEN).toBe('hostinger-valid-test-token');
    expect(result.HOSTINGER_MAILBOX_ID).toBe('AC1mailbox');
  });

  it('allows Hostinger mailbox discovery when mailbox ID is omitted', () => {
    const result = validateEnv({
      ...productionEnv(),
    });

    expect(result.HOSTINGER_MAILBOX_ID).toBe('');
  });

  it('rejects missing Hostinger Mail API tokens', () => {
    const env = productionEnv();
    delete (env as Partial<typeof env>).HOSTINGER_MAIL_API_TOKEN;

    expect(() => validateEnv(env)).toThrow(
      'HOSTINGER_MAIL_API_TOKEN is required',
    );
  });
});
