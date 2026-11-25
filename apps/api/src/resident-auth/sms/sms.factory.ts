import type { RuntimeConfig } from '../../config.js';
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
    return new MockSmsProvider();
  }
  return new DisabledSmsProvider();
}
