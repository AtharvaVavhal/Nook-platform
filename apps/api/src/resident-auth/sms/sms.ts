/**
 * Provider-independent SMS contract. No real provider is selected yet: nothing here knows any provider's API. A future adapter
 * (MSG91, Exotel, ...) implements SmsProvider and throws SmsDeliveryError; the dispatcher owns timeouts and retries.
 */
export interface SmsMessage {
  /** E.164 destination. */
  readonly to: string;
  /** The text. Never logged, never returned in a delivery result. */
  readonly body: string;
  /** An opaque internal id (the challenge id) so a delivery can be traced without the text or the number. */
  readonly reference: string;
}

export type SmsFailureKind = 'transient' | 'permanent' | 'timeout';

export class SmsDeliveryError extends Error {
  constructor(
    readonly kind: SmsFailureKind,
    /** A short, provider-neutral code such as PROVIDER_NOT_CONFIGURED or PROVIDER_UNAVAILABLE. Never the message text. */
    readonly code: string,
  ) {
    super(`sms delivery failed: ${code}`);
    this.name = 'SmsDeliveryError';
  }
}

export interface SmsProvider {
  readonly name: string;
  /** Resolve when the provider ACCEPTED the message. Reject with SmsDeliveryError. Must honour options.signal. */
  send(
    message: SmsMessage,
    options: { readonly signal: AbortSignal },
  ): Promise<{ readonly providerMessageId?: string }>;
}

export const SMS_PROVIDER = Symbol('SMS_PROVIDER');

/** What the rest of the system learns about a delivery: never the text, never the number. */
export interface SmsDeliveryResult {
  readonly status: 'SENT' | 'FAILED';
  readonly attempts: number;
  readonly provider: string;
  readonly failure?: { readonly kind: SmsFailureKind; readonly code: string };
}

export interface SmsDispatchOptions {
  /** Per-attempt limit. */
  readonly timeoutMs: number;
  /** Total attempts including the first. Only transient and timeout failures are retried. */
  readonly maxAttempts: number;
  readonly retryDelayMs: number;
}

export const DEFAULT_SMS_DISPATCH: SmsDispatchOptions = {
  timeoutMs: 5000,
  maxAttempts: 2,
  retryDelayMs: 250,
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Sends one message with a hard per-attempt timeout and a bounded, safe retry. Retrying an OTP is safe because every attempt
 * carries the same code: a duplicate delivery is harmless, a lost one is not. Permanent failures are never retried.
 */
export class SmsDispatcher {
  constructor(
    private readonly provider: SmsProvider,
    private readonly options: SmsDispatchOptions = DEFAULT_SMS_DISPATCH,
  ) {}

  async send(message: SmsMessage): Promise<SmsDeliveryResult> {
    let last: { kind: SmsFailureKind; code: string } = { kind: 'permanent', code: 'NOT_ATTEMPTED' };
    for (let attempt = 1; attempt <= this.options.maxAttempts; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
      try {
        await Promise.race([
          this.provider.send(message, { signal: controller.signal }),
          new Promise<never>((_, reject) => {
            controller.signal.addEventListener(
              'abort',
              () => reject(new SmsDeliveryError('timeout', 'PROVIDER_TIMEOUT')),
              {
                once: true,
              },
            );
          }),
        ]);
        return { status: 'SENT', attempts: attempt, provider: this.provider.name };
      } catch (error) {
        last =
          error instanceof SmsDeliveryError
            ? { kind: error.kind, code: error.code }
            : { kind: 'transient', code: 'PROVIDER_ERROR' };
        if (last.kind === 'permanent') {
          return {
            status: 'FAILED',
            attempts: attempt,
            provider: this.provider.name,
            failure: last,
          };
        }
      } finally {
        clearTimeout(timer);
      }
      if (attempt < this.options.maxAttempts) await sleep(this.options.retryDelayMs);
    }
    return {
      status: 'FAILED',
      attempts: this.options.maxAttempts,
      provider: this.provider.name,
      failure: last,
    };
  }
}

/** The default until an approved provider exists: every send fails permanently and visibly, nothing is delivered. */
export class DisabledSmsProvider implements SmsProvider {
  readonly name = 'disabled';
  send(): Promise<never> {
    return Promise.reject(new SmsDeliveryError('permanent', 'PROVIDER_NOT_CONFIGURED'));
  }
}
