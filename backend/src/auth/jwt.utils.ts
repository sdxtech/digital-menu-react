import type { SignOptions } from 'jsonwebtoken';

export type ExpiresIn = NonNullable<SignOptions['expiresIn']>;

export const resolveExpiresIn = (
  raw: string | undefined,
  fallback: ExpiresIn,
): ExpiresIn => {
  if (!raw) return fallback;
  const trimmed = raw.trim();
  if (!trimmed) return fallback;

  const numeric = Number(trimmed);
  if (!Number.isNaN(numeric) && /^\d+$/.test(trimmed)) {
    return numeric;
  }

  return trimmed as ExpiresIn;
};

export const expiresInToMs = (value: ExpiresIn, fallbackMs: number) => {
  if (typeof value === 'number') return value * 1000;

  const trimmed = value.trim();
  if (!trimmed) return fallbackMs;
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;

  const match = trimmed.match(/^(\d+)\s*([smhd])$/i);
  if (!match) return fallbackMs;

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  if (!Number.isFinite(amount) || amount <= 0) return fallbackMs;

  if (unit === 's') return amount * 1000;
  if (unit === 'm') return amount * 60 * 1000;
  if (unit === 'h') return amount * 60 * 60 * 1000;
  if (unit === 'd') return amount * 24 * 60 * 60 * 1000;
  return fallbackMs;
};
