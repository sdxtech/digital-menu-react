const REQUIRED_ENV_KEYS = [
  'MONGO_URI',
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
  'REDIS_URL',
  'S3_REGION',
  'S3_ACCESS_KEY',
  'S3_SECRET_KEY',
  'S3_BUCKET',
  'S3_PUBLIC_BASE_URL',
  'EMAIL_FROM',
  'HOSTINGER_MAIL_API_TOKEN',
] as const;

const TEST_DEFAULTS: Record<string, string> = {
  MONGO_URI: 'mongodb://localhost:27017/digital_menu_test',
  JWT_ACCESS_SECRET: 'test_access_secret_1234567890',
  JWT_REFRESH_SECRET: 'test_refresh_secret_1234567890',
  REDIS_URL: 'redis://localhost:6379',
  S3_REGION: 'us-east-1',
  S3_ACCESS_KEY: 'test-access-key',
  S3_SECRET_KEY: 'test-secret-key',
  S3_BUCKET: 'test-bucket',
  S3_PUBLIC_BASE_URL: 'http://localhost:9000/test-bucket',
  EMAIL_FROM: 'Test <test@example.com>',
  HOSTINGER_MAIL_API_TOKEN: 'hostinger_test_token',
};

const parsePositiveInt = (value: string, key: string) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${key} must be a positive integer`);
  }
  return String(parsed);
};

const parseBoolean = (value: string, key: string) => {
  const normalized = value.trim().toLowerCase();
  if (!['true', 'false'].includes(normalized)) {
    throw new Error(`${key} must be either true or false`);
  }
  return normalized;
};

const parseHttpUrl = (value: string, key: string) => {
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error();
    return parsed.toString().replace(/\/$/, '');
  } catch {
    throw new Error(`${key} must be a valid HTTP(S) URL`);
  }
};

const assertSecret = (value: string, key: string) => {
  if (value.startsWith('change_me')) {
    throw new Error(`${key} cannot use placeholder value`);
  }
};

const looksLikePlaceholder = (value: string) => {
  const normalized = value.trim().toLowerCase();
  return (
    normalized.startsWith('change_me') ||
    normalized.includes('your_') ||
    normalized.includes('example.com')
  );
};

const assertNotPlaceholderInProduction = (value: string, key: string) => {
  if (looksLikePlaceholder(value)) {
    throw new Error(`${key} cannot use placeholder value in production`);
  }
};

export const validateEnv = (rawEnv: Record<string, unknown>) => {
  const env = rawEnv as Record<string, string | undefined>;

  const nodeEnv = env.NODE_ENV?.trim() || 'development';
  const isTest = nodeEnv === 'test';
  env.NODE_ENV = nodeEnv;
  env.PORT = parsePositiveInt(env.PORT?.trim() || '3000', 'PORT');
  env.AUTH_RATE_LIMIT_MAX = parsePositiveInt(
    env.AUTH_RATE_LIMIT_MAX?.trim() || '10',
    'AUTH_RATE_LIMIT_MAX',
  );
  env.AUTH_RATE_LIMIT_WINDOW_MS = parsePositiveInt(
    env.AUTH_RATE_LIMIT_WINDOW_MS?.trim() || '60000',
    'AUTH_RATE_LIMIT_WINDOW_MS',
  );
  env.AUTH_IDLE_TIMEOUT_MINUTES = parsePositiveInt(
    env.AUTH_IDLE_TIMEOUT_MINUTES?.trim() || '480',
    'AUTH_IDLE_TIMEOUT_MINUTES',
  );

  const corsOrigin =
    env.CORS_ORIGIN?.trim() ||
    (nodeEnv === 'development' || isTest ? 'http://localhost:5173' : '');
  if (!corsOrigin) {
    throw new Error('CORS_ORIGIN is required');
  }
  if (corsOrigin.split(',').some((origin) => origin.trim() === '*')) {
    throw new Error('CORS_ORIGIN cannot include wildcard origin "*"');
  }
  env.CORS_ORIGIN = corsOrigin;

  const appBaseUrl =
    env.APP_BASE_URL?.trim() ||
    (nodeEnv === 'development' || isTest ? 'http://localhost:5173' : '');
  if (!appBaseUrl) {
    throw new Error('APP_BASE_URL is required');
  }
  env.APP_BASE_URL = parseHttpUrl(appBaseUrl, 'APP_BASE_URL');
  env.EMAIL_NOTIFICATIONS_ENABLED = parseBoolean(
    env.EMAIL_NOTIFICATIONS_ENABLED?.trim() || 'false',
    'EMAIL_NOTIFICATIONS_ENABLED',
  );
  env.EMAIL_RECIPIENT_OVERRIDE = env.EMAIL_RECIPIENT_OVERRIDE?.trim() || '';

  for (const key of REQUIRED_ENV_KEYS) {
    const fallbackValue = isTest ? TEST_DEFAULTS[key] : undefined;
    const value = env[key]?.trim() || fallbackValue;
    if (!value) {
      throw new Error(`${key} is required`);
    }
    env[key] = value;
  }
  env.HOSTINGER_MAILBOX_ID = env.HOSTINGER_MAILBOX_ID?.trim() || '';

  assertSecret(env.JWT_ACCESS_SECRET as string, 'JWT_ACCESS_SECRET');
  assertSecret(env.JWT_REFRESH_SECRET as string, 'JWT_REFRESH_SECRET');

  if (nodeEnv === 'production') {
    const sensitiveKeys: string[] = [
      'S3_ACCESS_KEY',
      'S3_SECRET_KEY',
      'HOSTINGER_MAIL_API_TOKEN',
    ];

    for (const key of sensitiveKeys) {
      assertNotPlaceholderInProduction(env[key] as string, key);
    }
    if (env.EMAIL_RECIPIENT_OVERRIDE) {
      throw new Error('EMAIL_RECIPIENT_OVERRIDE must be empty in production');
    }
  }

  if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
    throw new Error(
      'JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different',
    );
  }

  return env;
};
