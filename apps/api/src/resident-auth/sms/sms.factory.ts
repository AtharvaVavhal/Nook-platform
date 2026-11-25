import type { RuntimeConfig } from '../../config.js';
import { log } from '../../observability/json-logger.js';
import { MockSmsProvider } from './mock-sms.provider.js';
import { DisabledSmsProvider, type SmsProvider } from './sms.js';

/**
 * The only place a provider is chosen. A real provider (MSG91, Exotel, ...) is added here once one is approved, together with
 * its credentials in RESIDENT_* variables; today only `disabled` and `mock` exist, and `mock` can never run in production.
 */
export function createSmsProvider(
  config: Pick<RuntimeConfig, 'appEnv' | 'residentSmsProvider'>,
): SmsProvider {
  const selected = config.residentSmsProvider ?? 'disabled';
  if (selected === 'mock') {
    if (config.appEnv === 'production') {
      throw new Error('The mock SMS provider cannot be used in production.');
    }
    // Preview only: when APP_ENV is `development` the one-time code is written to the API server log so an authorised presenter
    // can read it there. APP_ENV=test (automated runs, CI) stays silent so no code ever reaches a CI log; production is refused above.
    return new MockSmsProvider({
      appEnv: config.appEnv,
      ...(config.appEnv === 'development'
        ? { previewLog: (line: string) => log.warn(line, { context: 'resident-mock-sms' }) }
        : {}),
    });
  }
  return new DisabledSmsProvider();
}
