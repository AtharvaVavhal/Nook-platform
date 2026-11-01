import { PasswordHasher } from '../../../src/auth/password-hasher.js';

export const TEST_NAMESPACE = '00000000-0000-4000-8000-000000001' as const;

export const FIXTURE_IDS = {
  orgA: `${TEST_NAMESPACE}001`,
  userA: `${TEST_NAMESPACE}002`,
  membershipA: `${TEST_NAMESPACE}003`,
  orgB: `${TEST_NAMESPACE}004`,
  userB: `${TEST_NAMESPACE}005`,
  membershipB: `${TEST_NAMESPACE}006`,
} as const;

const testPassword = process.env.TEST_OWNER_PASSWORD;
if (!testPassword) {
  throw new Error('TEST_OWNER_PASSWORD environment variable is required');
}
export const TEST_PASSWORD = testPassword;
export const TEST_USER_EMAIL = 'integration-test@nook.test.invalid';
export const TEST_USER_DISPLAY = 'Integration Test User';

export async function hashTestPassword(): Promise<string> {
  const hasher = new PasswordHasher();
  return hasher.hash(TEST_PASSWORD);
}

export const M3C_FIXTURE = {
  orgId: '00000000-0000-4000-8000-000000000101',
  userId: '00000000-0000-4000-8000-000000000102',
  membershipId: '00000000-0000-4000-8000-000000000103',
  email: 'm3c-owner@nook.test.invalid',
  orgName: 'Nook Milestone 3C Fixture Organisation',
} as const;

export function generatePropertyCode(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}`;
}