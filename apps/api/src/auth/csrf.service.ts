import { Injectable } from '@nestjs/common';
import { randomBytes, timingSafeEqual } from 'node:crypto';

@Injectable()
export class CsrfService {
  createToken(): string {
    return randomBytes(32).toString('base64url');
  }

  matches(cookieToken: string | undefined, headerToken: string | undefined): boolean {
    if (!cookieToken || !headerToken) return false;
    const cookie = Buffer.from(cookieToken);
    const header = Buffer.from(headerToken);
    return cookie.length === header.length && timingSafeEqual(cookie, header);
  }
}
