import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../database/prisma.service.js';
import { log } from '../observability/json-logger.js';
import { generateOtp, hashOtp, otpMatches, otpMessageBody, requireOtpSecret } from './otp.js';
import { normalizeIndianMobile } from './phone.js';
import {
  GENERIC_CODE_FAILURE,
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_COOLDOWN_SECONDS,
  OTP_TTL_MS,
  PORTAL_ELIGIBLE,
} from './policy.js';
import { ResidentAuditService } from './resident-audit.service.js';
import type { ResidentAuthContext } from './resident-auth.types.js';
import { ResidentSessionService } from './resident-session.service.js';
import { ResidentThrottleService } from './resident-throttle.service.js';
import { SmsDispatcher } from './sms/sms.js';

const isUniqueViolation = (error: unknown) => (error as { code?: string } | null)?.code === 'P2002';

/**
 * Phone-OTP sign-in for resident accounts that an owner has provisioned. Nobody can register here: a code is only ever issued
 * for an existing, active account, and the response never tells a caller whether one exists.
 */
@Injectable()
export class ResidentAuthService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ResidentThrottleService) private readonly throttle: ResidentThrottleService,
    @Inject(ResidentSessionService) private readonly sessions: ResidentSessionService,
    @Inject(ResidentAuditService) private readonly audit: ResidentAuditService,
    @Inject(SmsDispatcher) private readonly sms: SmsDispatcher,
  ) {}

  private rateLimited(until: Date): HttpException {
    const retryAfterSeconds = Math.max(1, Math.ceil((until.getTime() - Date.now()) / 1000));
    return new HttpException(
      { code: 'OTP_RATE_LIMITED', retryAfterSeconds },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  private genericFailure(): UnauthorizedException {
    return new UnauthorizedException({ code: GENERIC_CODE_FAILURE });
  }

  /**
   * An account that may use the portal right now: the account is active, its organization is active and its resident is
   * ACTIVE (an INACTIVE or ARCHIVED resident is refused, like a suspended or revoked account). The same rule is applied at
   * sign-in request, at verification, inside the session-creating transaction and on every authenticated request.
   */
  private findSignInAccount(phoneE164: string) {
    return this.prisma.db.residentAccount.findFirst({
      where: { phoneE164, ...PORTAL_ELIGIBLE },
      select: { id: true, organizationId: true, phoneE164: true },
    });
  }

  /**
   * Always answers the same way for a valid-looking number, whether or not an account exists and whether or not an SMS was
   * sent. Only a malformed number (400) and a rate limit (429, applied to every number alike) differ.
   */
  async requestOtp(
    rawPhone: unknown,
    ip: string,
  ): Promise<{ requested: true; resendAfterSeconds: number }> {
    const phone = normalizeIndianMobile(rawPhone);
    if (!phone) throw new BadRequestException({ code: 'INVALID_PHONE_NUMBER' });
    const generic = { requested: true as const, resendAfterSeconds: OTP_RESEND_COOLDOWN_SECONDS };

    const limited = await this.throttle.lockedUntil([
      { scope: 'OTP_REQUEST_PHONE', value: phone },
      { scope: 'OTP_REQUEST_ADDRESS', value: ip },
    ]);
    if (limited) throw this.rateLimited(limited);
    // Every request counts against the sender's address. A request counts against the NUMBER only when it passes the resend
    // cooldown, i.e. when a code could actually be sent, so a burst of refused requests cannot use up (and lock) a number's hourly
    // allowance on its own.
    await this.throttle.hit({ scope: 'OTP_REQUEST_ADDRESS', value: ip });
    if (
      !(await this.throttle.tryLock(
        { scope: 'OTP_COOLDOWN_PHONE', value: phone },
        OTP_RESEND_COOLDOWN_SECONDS,
      ))
    ) {
      const until = await this.throttle.lockedUntil([
        { scope: 'OTP_COOLDOWN_PHONE', value: phone },
      ]);
      throw this.rateLimited(until ?? new Date(Date.now() + OTP_RESEND_COOLDOWN_SECONDS * 1000));
    }
    await this.throttle.hit({ scope: 'OTP_REQUEST_PHONE', value: phone });

    const account = await this.findSignInAccount(phone);
    if (!account) {
      // Do the same expensive work as the real path so the response time does not reveal the difference.
      hashOtp(requireOtpSecret(), randomUUID(), randomUUID(), generateOtp());
      return generic;
    }

    const secret = requireOtpSecret();
    const code = generateOtp();
    const challengeId = randomUUID();
    const now = new Date();
    try {
      await this.prisma.db.$transaction(async (tx) => {
        // A new code replaces every earlier live one: only the newest can ever be verified.
        await tx.residentOtpChallenge.updateMany({
          where: { accountId: account.id, consumedAt: null, invalidatedAt: null },
          data: { invalidatedAt: now, invalidatedReason: 'SUPERSEDED' },
        });
        await tx.residentOtpChallenge.create({
          data: {
            id: challengeId,
            organizationId: account.organizationId,
            accountId: account.id,
            codeHash: hashOtp(secret, challengeId, account.id, code),
            maxAttempts: OTP_MAX_ATTEMPTS,
            expiresAt: new Date(now.getTime() + OTP_TTL_MS),
          },
        });
      });
    } catch (error) {
      // A concurrent request already issued the live challenge for this account; that one stands.
      if (isUniqueViolation(error)) return generic;
      throw error;
    }

    const delivery = await this.sms.send({
      to: account.phoneE164,
      body: otpMessageBody(code, OTP_TTL_MS / 60000),
      reference: challengeId,
    });
    if (delivery.status === 'SENT') {
      await this.prisma.db.residentOtpChallenge.update({
        where: { id: challengeId },
        data: { deliveryStatus: 'SENT' },
      });
    } else {
      // The code was never delivered, so it must not stay usable. The caller still gets the generic answer.
      await this.prisma.db.residentOtpChallenge.updateMany({
        where: { id: challengeId, consumedAt: null, invalidatedAt: null },
        data: {
          deliveryStatus: 'FAILED',
          invalidatedAt: new Date(),
          invalidatedReason: 'DELIVERY_FAILED',
        },
      });
      log.warn('resident otp delivery failed', {
        context: 'resident-auth',
        challengeId,
        provider: delivery.provider,
        attempts: delivery.attempts,
        failureKind: delivery.failure?.kind,
        failureCode: delivery.failure?.code,
      });
    }
    return generic;
  }

  /**
   * Verifies a code. Every refusal (wrong, expired, used, superseded, locked, unknown number) is the same 401; only the rate
   * limit (429) differs, and it applies to every number alike.
   */
  async verifyOtp(
    rawPhone: unknown,
    rawCode: unknown,
    ip: string,
  ): Promise<{ secret: string; absoluteExpiresAt: Date }> {
    const phone = normalizeIndianMobile(rawPhone);
    const code = typeof rawCode === 'string' && /^\d{6}$/.test(rawCode) ? rawCode : null;
    const limited = await this.throttle.lockedUntil([
      ...(phone ? [{ scope: 'OTP_VERIFY_PHONE' as const, value: phone }] : []),
      { scope: 'OTP_VERIFY_ADDRESS', value: ip },
    ]);
    if (limited) throw this.rateLimited(limited);

    const refuse = async (reason: string, account?: { id: string; organizationId: string }) => {
      if (phone) await this.throttle.hit({ scope: 'OTP_VERIFY_PHONE', value: phone });
      await this.throttle.hit({ scope: 'OTP_VERIFY_ADDRESS', value: ip });
      if (account) {
        await this.audit.record('resident_auth.login.failed', {
          organizationId: account.organizationId,
          accountId: account.id,
          reasonCode: reason,
        });
      }
      return this.genericFailure();
    };

    if (!phone || !code) throw await refuse('MALFORMED');
    const account = await this.findSignInAccount(phone);
    if (!account) throw await refuse('UNKNOWN');
    const challenge = await this.prisma.db.residentOtpChallenge.findFirst({
      where: { accountId: account.id, consumedAt: null, invalidatedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!challenge) throw await refuse('NO_LIVE_CHALLENGE', account);

    // Count the attempt BEFORE comparing, in one conditional update: N parallel guesses can never exceed the attempt limit,
    // and an expired, used or exhausted challenge simply matches no row.
    const counted = await this.prisma.db.residentOtpChallenge.updateMany({
      where: {
        id: challenge.id,
        consumedAt: null,
        invalidatedAt: null,
        expiresAt: { gt: new Date() },
        attempts: { lt: challenge.maxAttempts },
      },
      data: { attempts: { increment: 1 } },
    });
    if (counted.count !== 1) throw await refuse('CHALLENGE_UNUSABLE', account);

    if (!otpMatches(challenge.codeHash, requireOtpSecret(), challenge.id, account.id, code)) {
      await this.prisma.db.residentOtpChallenge.updateMany({
        where: {
          id: challenge.id,
          consumedAt: null,
          invalidatedAt: null,
          attempts: { gte: challenge.maxAttempts },
        },
        data: { invalidatedAt: new Date(), invalidatedReason: 'MAX_ATTEMPTS' },
      });
      throw await refuse('WRONG_CODE', account);
    }

    // Consume the code and open the session in ONE transaction. Of any number of concurrent correct submissions, exactly one
    // updates the row; the rest see it already consumed and are refused.
    const session = await this.prisma.db.$transaction(async (tx) => {
      const consumed = await tx.residentOtpChallenge.updateMany({
        where: {
          id: challenge.id,
          consumedAt: null,
          invalidatedAt: null,
          expiresAt: { gt: new Date() },
        },
        data: { consumedAt: new Date() },
      });
      if (consumed.count !== 1) return null;
      // Re-check eligibility inside the transaction: a resident made INACTIVE after the check above gets no session.
      const stillEligible = await tx.residentAccount.count({
        where: { id: account.id, ...PORTAL_ELIGIBLE },
      });
      if (stillEligible !== 1) return null;
      await tx.residentAccount.update({
        where: { id: account.id },
        data: { lastLoginAt: new Date() },
      });
      return this.sessions.createIn(tx, account.id, account.organizationId);
    });
    if (!session) throw await refuse('REPLAYED', account);

    await this.throttle.reset({ scope: 'OTP_VERIFY_PHONE', value: phone });
    await this.audit.record('resident_auth.login.succeeded', {
      organizationId: account.organizationId,
      accountId: account.id,
    });
    return { secret: session.secret, absoluteExpiresAt: session.absoluteExpiresAt };
  }

  async logout(context: ResidentAuthContext): Promise<void> {
    await this.sessions.revoke(context.sessionId, 'logout');
    await this.audit.record('resident_auth.logout', {
      organizationId: context.organizationId,
      accountId: context.accountId,
    });
  }

  me(context: ResidentAuthContext) {
    return { displayName: context.displayName, organizationName: context.organizationName };
  }
}
