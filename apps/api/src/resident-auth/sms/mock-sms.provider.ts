import { SmsDeliveryError, type SmsFailureKind, type SmsMessage, type SmsProvider } from './sms.js';

/**
 * Test adapter: records messages in memory and can be told to fail or stall. It delivers nothing. createSmsProvider refuses
 * to construct it when APP_ENV is production, and the config parser refuses RESIDENT_SMS_PROVIDER=mock there as well.
 */
export class MockSmsProvider implements SmsProvider {
  readonly name = 'mock';
  readonly outbox: SmsMessage[] = [];
  private failures: Array<{ kind: SmsFailureKind; code: string }> = [];
  delayMs = 0;

  failNext(kind: SmsFailureKind, code = 'MOCK_FAILURE', times = 1): void {
    for (let i = 0; i < times; i++) this.failures.push({ kind, code });
  }

  reset(): void {
    this.outbox.length = 0;
    this.failures = [];
    this.delayMs = 0;
  }

  /** The most recent code sent to a number (tests only). */
  lastCodeFor(e164: string): string | undefined {
    const message = [...this.outbox].reverse().find((m) => m.to === e164);
    return message?.body.match(/\b(\d{6})\b/)?.[1];
  }

  async send(
    message: SmsMessage,
    options: { signal: AbortSignal },
  ): Promise<{ providerMessageId: string }> {
    if (this.delayMs > 0) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, this.delayMs);
        options.signal.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new SmsDeliveryError('timeout', 'PROVIDER_TIMEOUT'));
        });
      });
    }
    const failure = this.failures.shift();
    if (failure) throw new SmsDeliveryError(failure.kind, failure.code);
    this.outbox.push(message);
    return { providerMessageId: `mock-${this.outbox.length}` };
  }
}
