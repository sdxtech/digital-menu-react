import type { RedisOptions } from 'ioredis';

export const parseRedisUrl = (rawUrl?: string): RedisOptions => {
  const value = rawUrl?.trim();
  const normalized = value
    ? value.startsWith('redis://')
      ? value
      : `redis://${value}`
    : 'redis://localhost:6379';

  const url = new URL(normalized);
  const port = url.port ? Number(url.port) : 6379;
  const db = url.pathname && url.pathname !== '/' ? Number(url.pathname.slice(1)) : undefined;

  return {
    host: url.hostname,
    port: Number.isNaN(port) ? 6379 : port,
    username: url.username || undefined,
    password: url.password || undefined,
    db: Number.isNaN(db ?? NaN) ? undefined : db,
  };
};
