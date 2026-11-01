import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const KEY_LENGTH = 64;

export class PasswordHasher {
  async hash(password: string): Promise<string> {
    const salt = randomBytes(16);
    const derived = (await scrypt(password, salt, KEY_LENGTH)) as Buffer;
    return `scrypt$${salt.toString('base64url')}$${derived.toString('base64url')}`;
  }

  async verify(password: string, encoded: string): Promise<boolean> {
    const parts = encoded.split('$');
    if (parts.length !== 3 || parts[0] !== 'scrypt' || !parts[1] || !parts[2]) {
      return false;
    }
    try {
      const salt = Buffer.from(parts[1], 'base64url');
      const expected = Buffer.from(parts[2], 'base64url');
      if (salt.length === 0 || expected.length !== KEY_LENGTH) return false;
      const actual = (await scrypt(password, salt, expected.length)) as Buffer;
      return timingSafeEqual(actual, expected);
    } catch {
      return false;
    }
  }
}
