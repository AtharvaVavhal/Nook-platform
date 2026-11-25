import { maskPhone } from '../phone.js';
import { SmsDeliveryError, type SmsFailureKind, type SmsMessage, type SmsProvider } from './sms.js';

/** Marker that makes a preview-only line impossible to mistake for a real delivery, and easy to filter for in the log viewer. */
export const MOCK_SMS_LOG_MARKER = 'PREVIEW-ONLY MOCK SMS';

export interface MockSmsOptions {
  /** The runtime APP_ENV. `production` is refused: this adapter must never exist in a production process. */
  readonly appEnv: string;
  /**
   * Preview log sink. When given (and APP_ENV is not production) every accepted message is announced here as ONE line holding
   * the marker, the masked number, the expiry and the code, so an authorised presenter can read it in the API server log.
   * Omitted (the default, used by unit tests) the mock stays completely silent.
   */
  readonly previewLog?: (line: string) => void;
}

/**
 * Test and preview adapter: records messages in memory and can be told to fail or stall. It delivers NOTHING to any handset.
 * createSmsProvider and the config parser both refuse it when APP_ENV is production; this class refuses a second time.
 */
export class MockSmsProvider implements SmsProvider {
  readonly name = 'mock';
  readonly outbox: SmsMessage[] = [];
  private failures: Array<{ kind: SmsFailureKind; code: string }> = [];
  private readonly previewLog: ((line: string) => void) | undefined;
  delayMs = 0;

  constructor(options?: MockSmsOptions) {
    if (options?.appEnv === 'production') {
      throw new Error('The mock SMS provider cannot be used in production.');
    }
    this.previewLog = options?.previewLog;
  }

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
    this.announce(message);
    return { providerMessageId: `mock-${this.outbox.length}` };
  }

  /** One line: marker, masked number, expiry, code. Nothing else from the message, no full number, no reference. */
  private announce(message: SmsMessage): void {
    if (!this.previewLog) return;
    const code = message.body.match(/\b(\d{6})\b/)?.[1];
    if (!code) return;
    const expiry = message.expiresAt ? message.expiresAt.toISOString() : 'unknown';
    this.previewLog(
      `${MOCK_SMS_LOG_MARKER} (not delivered to any handset) to=${maskPhone(message.to)} expires=${expiry} otp=${code}`,
    );
  }
}
