const SENSITIVE_KEYS = new Set([
  'password',
  'passwordhash',
  'currentpassword',
  'newpassword',
  'token',
  'accesstoken',
  'refreshtoken',
  'refreshtokenhash',
  'resettokenhash',
  'authorization',
  'cookie',
  'secret',
]);

export const sanitizeAuditValue = (value: unknown, depth = 0): unknown => {
  if (depth > 8) return '[truncated]';
  if (value instanceof Date) return value.toISOString();
  if (isObjectId(value)) return value.toHexString();
  if (Buffer.isBuffer(value)) {
    return {
      type: 'Buffer',
      byteLength: value.length,
      content: '[stored separately]',
    };
  }
  if (Array.isArray(value)) {
    return value
      .slice(0, 100)
      .map((item) => sanitizeAuditValue(item, depth + 1));
  }
  if (value && typeof value === 'object') {
    const objectValue = value as { toObject?: unknown };
    const source =
      value instanceof Map
        ? Object.fromEntries(value as Map<string, unknown>)
        : typeof objectValue.toObject === 'function'
          ? (objectValue.toObject as () => unknown)()
          : value;
    return Object.fromEntries(
      Object.entries(source as Record<string, unknown>)
        .slice(0, 200)
        .map(([key, item]) => [
          key,
          SENSITIVE_KEYS.has(key.toLowerCase())
            ? '[REDACTED]'
            : sanitizeAuditValue(item, depth + 1),
        ]),
    );
  }
  if (typeof value === 'string') return value.slice(0, 10_000);
  return value;
};

const isObjectId = (
  value: unknown,
): value is { _bsontype: 'ObjectId'; toHexString: () => string } => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as {
    _bsontype?: unknown;
    toHexString?: unknown;
  };
  return (
    candidate._bsontype === 'ObjectId' &&
    typeof candidate.toHexString === 'function'
  );
};

export const buildAuditDiff = (
  before: unknown,
  after: unknown,
): Record<string, { before: unknown; after: unknown }> => {
  const result: Record<string, { before: unknown; after: unknown }> = {};
  walkDiff(before, after, '', result);
  return result;
};

const walkDiff = (
  before: unknown,
  after: unknown,
  path: string,
  result: Record<string, { before: unknown; after: unknown }>,
) => {
  if (Object.keys(result).length >= 500) return;
  if (isPlainObject(before) && isPlainObject(after)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const key of keys) {
      walkDiff(before[key], after[key], path ? `${path}.${key}` : key, result);
    }
    return;
  }
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    result[path || 'value'] = { before, after };
  }
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  !(value instanceof Date);
