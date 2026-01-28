import type { SignOptions } from 'jsonwebtoken';

export type ExpiresIn = NonNullable<SignOptions['expiresIn']>;

export const resolveExpiresIn = (raw: string | undefined, fallback: ExpiresIn): ExpiresIn => {
  if (!raw) return fallback;
  const trimmed = raw.trim();
  if (!trimmed) return fallback;

  const numeric = Number(trimmed);
  if (!Number.isNaN(numeric) && /^\d+$/.test(trimmed)) {
    return numeric;
  }

  return trimmed as ExpiresIn;
};
