import { createHash, randomUUID } from 'node:crypto';
import { OsaError } from './contracts.js';
import type { Identity } from './contracts.js';
export const id = () => randomUUID();
export function canonical(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return (
    '{' +
    Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => JSON.stringify(k) + ':' + canonical(v))
      .join(',') +
    '}'
  );
}
export const digest = (value: unknown) =>
  createHash('sha256').update(canonical(value)).digest('hex');
export function requireWrite(identity: Identity) {
  if (identity.role === 'reader')
    throw new OsaError(
      'FORBIDDEN',
      'To konto ma dostęp tylko do odczytu.',
      403,
    );
}
export function owner(identity: Identity) {
  if (identity.role !== 'owner')
    throw new OsaError('FORBIDDEN', 'Wymagane uprawnienie właściciela.', 403);
}
export function text(
  value: unknown,
  name: string,
  max = 16000,
  optional = false,
): string {
  if (optional && (value === undefined || value === null || value === ''))
    return '';
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    throw new OsaError(
      'INVALID_INPUT',
      `${name}: wymagany tekst, maksymalnie ${max} znaków.`,
    );
  return value.trim();
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new OsaError('INVALID_INPUT', 'Wymagany obiekt JSON.');
  const result = value as Record<string, unknown>;
  if (Buffer.byteLength(JSON.stringify(result)) > 96000)
    throw new OsaError(
      'INPUT_TOO_LARGE',
      'Wejście przekracza limit 96 KB.',
      413,
    );
  return result;
}
export function dateKey(at: number, timezone: string) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(at));
}
export function nextDaily(
  after: number,
  hour: number,
  minute: number,
  timezone: string,
): number {
  if (
    !Number.isInteger(hour) ||
    hour < 0 ||
    hour > 23 ||
    !Number.isInteger(minute) ||
    minute < 0 ||
    minute > 59
  )
    throw new OsaError('INVALID_INPUT', 'Nieprawidłowa godzina harmonogramu.');
  let format: Intl.DateTimeFormat;
  try {
    format = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
  } catch {
    throw new OsaError('INVALID_INPUT', 'Nieprawidłowa strefa czasowa.');
  }
  const target = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  for (
    let at = Math.floor(after / 60000) * 60000 + 60000;
    at <= after + 72 * 3600000;
    at += 60000
  )
    if (format.format(new Date(at)) === target) return at;
  throw new OsaError('INVALID_INPUT', 'Nie znaleziono następnego terminu.');
}
