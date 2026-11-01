export interface LoginDto {
  readonly email: unknown;
  readonly password: unknown;
}

export function parseLoginDto(value: unknown): { email: string; password: string } {
  if (!value || typeof value !== 'object') {
    throw new Error('INVALID_LOGIN');
  }
  const input = value as Record<string, unknown>;
  if (
    typeof input.email !== 'string' ||
    typeof input.password !== 'string' ||
    input.email.trim() === '' ||
    input.password === ''
  ) {
    throw new Error('INVALID_LOGIN');
  }
  return { email: input.email, password: input.password };
}

export function normalizeLoginIdentifier(email: string): string {
  return email.trim().toLowerCase();
}
