// Must verify database identity and acquire the real suite lock before importing fixture writers.
import '../../apps/api/test/integration/helpers/preflight.ts';
import { randomUUID } from 'node:crypto';
import { provisionTestOrgUserMembership } from '../../apps/api/test/integration/helpers/db.ts';
import { hashTestPassword, M3C_FIXTURE } from '../../apps/api/test/integration/helpers/fixtures.ts';

const hash = await hashTestPassword();
await provisionTestOrgUserMembership(
  M3C_FIXTURE.orgId,
  M3C_FIXTURE.userId,
  M3C_FIXTURE.membershipId,
  M3C_FIXTURE.email,
  hash,
  M3C_FIXTURE.orgName,
  'CI Owner',
);
for (const email of [
  'test-a-7ab755ea-c3a9-401e-8e1f-34064119be41@example.com',
  'test-b-a16f9f94-4f92-42ec-8d32-72158652f73c@example.com',
]) {
  await provisionTestOrgUserMembership(
    randomUUID(),
    randomUUID(),
    randomUUID(),
    email,
    hash,
    'CI Inventory Org',
    'CI Owner',
  );
}
