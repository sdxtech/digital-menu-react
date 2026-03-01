export const parseCorsOrigins = (raw: string) => {
  const origins = raw
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (origins.length === 0) {
    throw new Error('CORS_ORIGIN must contain at least one origin');
  }
  if (origins.includes('*')) {
    throw new Error('Wildcard CORS origin is not allowed');
  }

  return Array.from(new Set(origins));
};
