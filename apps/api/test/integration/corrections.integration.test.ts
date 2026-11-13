/* eslint-disable @typescript-eslint/no-explicit-any -- supertest response bodies are untyped */
import './helpers/preflight.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { Global, Module } from '@nestjs/common';
import {
  CORRECTIONS_CONFIG,
  defaultCorrectionsConfig,
} from '../../src/corrections/corrections.service.js';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { AllExceptionsFilter } from '../../src/observability/all-exceptions.filter.js';
import { InvoiceSchedulerService } from '../../src/jobs/invoice-scheduler.service.js';
import { JobsModule } from '../../src/jobs/jobs.module.js';
import http from 'node:http';
import { createMigratorClient, withMigratorClient } from './helpers/db.js';
import { requireTestDatabaseUrl } from './helpers/env.js';
import { TEST_PASSWORD, hashTestPassword } from './helpers/fixtures.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { FinanceService } from '../../src/finance/finance.service.js';
import { sqlStates, classifyFailure } from '../../src/common/tx-errors.js';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import pg from 'pg';

/**
 * P4-2 corrections against a REAL PostgreSQL (the disposable integration database). These tests exercise the HTTP API, the
 * real guards, services, triggers, partial unique indexes and the organization gate. They are the executed evidence for
 * the race scenarios and acceptance criteria noted on each test; they do not cover load/throughput.
 */
process.env.APP_ENV = 'test';
process.env.WEB_ORIGIN = 'http://localhost:5173';
process.env.CORRECTION_RECEIPT_SECRET = 'integration-test-receipt-secret-0123456789';
let financialTestApplication = true;
requireTestDatabaseUrl();
const ORIGIN = 'http://localhost:5173';

// Exercise the gated implementation via its existing injectable test seam. Never enable the deployment flag.
@Global()
@Module({
  providers: [
    {
      provide: CORRECTIONS_CONFIG,
      useValue: {
        receiptSecret: defaultCorrectionsConfig.receiptSecret,
        financialApplyEnabled: () => financialTestApplication,
      },
    },
  ],
  exports: [CORRECTIONS_CONFIG],
})
class CorrectionTestConfigModule {}
@Module({ imports: [CorrectionTestConfigModule, AppModule] })
class CorrectionTestAppModule {}

let app: any;
let schedulerApp: Awaited<ReturnType<typeof NestFactory.createApplicationContext>>;
let server: ReturnType<typeof request>;
let passwordHash: string;

interface Member {
  userId: string;
  headers: Record<string, string>;
}
interface Org {
  orgId: string;
  residentId: string;
  bedId: string;
  owner: Member;
  owner2: Member;
  pm: Member;
  pm2: Member;
}

async function login(email: string): Promise<Record<string, string>> {
  const res = await server
    .post('/api/v1/auth/login')
    .set('Origin', ORIGIN)
    .send({ email, password: TEST_PASSWORD })
    .expect(200);
  const set = res.headers['set-cookie'] as unknown as string[];
  const session = set.find((c) => c.startsWith('nook_session='))!.split(';')[0]!;
  const csrf = set.find((c) => c.startsWith('nook_csrf='))!.split(';')[0]!;
  return {
    Origin: ORIGIN,
    Cookie: `${session}; ${csrf}`,
    'x-csrf-token': csrf.slice('nook_csrf='.length),
  };
}

async function newOrg(): Promise<Org> {
  const orgId = randomUUID();
  const residentId = randomUUID();
  const propertyId = randomUUID();
  const floorId = randomUUID();
  const roomId = randomUUID();
  const bedId = randomUUID();
  const people = (['OWNER', 'OWNER', 'PROPERTY_MANAGER', 'PROPERTY_MANAGER'] as const).map(
    (role) => ({
      role,
      userId: randomUUID(),
      email: `corr-${randomUUID()}@nook.test.invalid`,
    }),
  );
  await withMigratorClient(async (c) => {
    await c.query('BEGIN');
    await c.query(`INSERT INTO organizations (id, name, updated_at) VALUES ($1,$2,now())`, [
      orgId,
      `Corr ${orgId.slice(0, 8)}`,
    ]);
    for (const p of people) {
      await c.query(
        `INSERT INTO users (id, login_identifier, password_hash, display_name, updated_at) VALUES ($1,$2,$3,$4,now())`,
        [p.userId, p.email, passwordHash, `${p.role} ${p.userId.slice(0, 4)}`],
      );
      await c.query(
        `INSERT INTO memberships (id, organization_id, user_id, role, status) VALUES ($1,$2,$3,$4,'ACTIVE')`,
        [randomUUID(), orgId, p.userId, p.role],
      );
    }
    await c.query(
      `INSERT INTO properties (id, organization_id, code, name, updated_at) VALUES ($1,$2,$3,'P',now())`,
      [propertyId, orgId, `P-${propertyId.slice(0, 8)}`],
    );
    await c.query(
      `INSERT INTO floors (id, organization_id, property_id, label, ordinal, updated_at) VALUES ($1,$2,$3,'F',0,now())`,
      [floorId, orgId, propertyId],
    );
    await c.query(
      `INSERT INTO rooms (id, organization_id, property_id, floor_id, label, updated_at) VALUES ($1,$2,$3,$4,'R',now())`,
      [roomId, orgId, propertyId, floorId],
    );
    await c.query(
      `INSERT INTO beds (id, organization_id, property_id, room_id, label, updated_at) VALUES ($1,$2,$3,$4,'B1',now())`,
      [bedId, orgId, propertyId, roomId],
    );
    await c.query(
      `INSERT INTO residents (id, organization_id, first_name, last_name, updated_at) VALUES ($1,$2,'Arahv','Shah',now())`,
      [residentId, orgId],
    );
    await c.query('COMMIT');
  });
  const [owner, owner2, pm, pm2] = await Promise.all(
    people.map(async (p) => ({ userId: p.userId, headers: await login(p.email) })),
  );
  return { orgId, residentId, bedId, owner: owner!, owner2: owner2!, pm: pm!, pm2: pm2! };
}

/** A stay: booking 1 Sep 2026 - 1 Jan 2027 at 5000, admitted, ACTIVE check-in on 1 Oct 2026. */
async function seedStay(org: Org) {
  const bookingId = randomUUID();
  const admissionId = randomUUID();
  const checkInId = randomUUID();
  await withMigratorClient(async (c) => {
    await c.query(
      `INSERT INTO bookings (id, organization_id, resident_id, bed_id, start_date, end_date, monthly_price, updated_at) VALUES ($1,$2,$3,$4,'2026-09-01','2027-01-01',5000,now())`,
      [bookingId, org.orgId, org.residentId, org.bedId],
    );
    await c.query(
      `INSERT INTO admissions (id, organization_id, booking_id, resident_id, bed_id, admission_date, status, updated_at) VALUES ($1,$2,$3,$4,$5,'2026-09-01','ADMITTED',now())`,
      [admissionId, org.orgId, bookingId, org.residentId, org.bedId],
    );
    await c.query(
      `INSERT INTO check_ins (id, organization_id, admission_id, resident_id, bed_id, booking_id, check_in_at, status, updated_at) VALUES ($1,$2,$3,$4,$5,$6,'2026-10-01 04:00:00+00','ACTIVE',now())`,
      [checkInId, org.orgId, admissionId, org.residentId, org.bedId, bookingId],
    );
  });
  return { bookingId, admissionId, checkInId };
}

const db = <T = any>(sql: string, params: unknown[] = []): Promise<T[]> =>
  withMigratorClient(async (c) => (await c.query(sql, params)).rows as T[]);
const one = async <T = any>(sql: string, params: unknown[] = []) => (await db<T>(sql, params))[0]!;

const post = (member: Member, path: string, body: object, key: string | null = randomUUID()) => {
  const r = server.post(`/api/v1${path}`).set(member.headers);
  if (key) r.set('Idempotency-Key', key);
  return r.send(body);
};
const nameBody = (org: Org, over: Record<string, unknown> = {}) => ({
  targetType: 'RESIDENT',
  targetId: org.residentId,
  fieldKey: 'firstName',
  proposedValue: 'Aarav',
  reason: 'Misspelled at registration',
  effectiveAt: new Date().toISOString(),
  ...over,
});

test(
  'performance evidence: gate holds and explicit lock acquisitions on 100 beds',
  { skip: process.env.NOOK_PERFORMANCE_EVIDENCE !== '1' },
  async () => {
    try {
      const org = await newOrg();
      const stay = await seedStay(org);
      for (let i = 1; i < 100; i++) {
        const resident = randomUUID(),
          bed = randomUUID();
        await db(
          `INSERT INTO residents(id,organization_id,first_name,last_name,updated_at) VALUES($1,$2,'Performance','Fixture',now())`,
          [resident, org.orgId],
        );
        await db(
          `INSERT INTO beds(id,organization_id,property_id,room_id,label,updated_at) SELECT $1,organization_id,property_id,room_id,$2,now() FROM beds WHERE id=$3`,
          [bed, `PERF-B${i}`, org.bedId],
        );
        await seedStay({ ...org, residentId: resident, bedId: bed });
      }
      await db(
        `INSERT INTO invoices(id,organization_id,resident_id,booking_id,number,period_start,period_end,amount,status,due_date,issued_at,updated_at)
    SELECT gen_random_uuid(),b.organization_id,b.resident_id,b.id,'INV-2025-'||lpad(row_number() OVER ()::text,4,'0'),
    (date '2025-01-01'+m.n*interval '1 month')::date,(date '2025-01-01'+(m.n+1)*interval '1 month')::date,
    5000,'ISSUED',(date '2025-01-05'+m.n*interval '1 month')::date,now(),now()
    FROM bookings b CROSS JOIN generate_series(0,11) m(n) WHERE b.organization_id=$1`,
        [org.orgId],
      );
      const client = app.get(PrismaService).db;
      const original = client.$transaction.bind(client);
      const controlEvents: any[] = [],
        httpEvents: any[] = [];
      const backendActivity: any[] = [];
      const activityClient = createMigratorClient();
      await activityClient.connect();
      let activityPollRunning = false;
      const eventLoopGaps: number[] = [];
      let lastHeartbeat = performance.now();
      const heartbeat = setInterval(() => {
        const now = performance.now();
        eventLoopGaps.push(now - lastHeartbeat);
        lastHeartbeat = now;
      }, 50);
      const pgPrototype = pg.Client.prototype as any,
        originalQuery = pgPrototype.query;
      pgPrototype.query = function (this: any, ...args: any[]) {
        const text = typeof args[0] === 'string' ? args[0] : (args[0]?.text ?? '');
        const kind = /^\s*(BEGIN|COMMIT|ROLLBACK)\b/i.exec(text)?.[1]?.toUpperCase();
        const entry = kind ? { kind, pid: this.processID, submittedMs: performance.now() } : null;
        const result = originalQuery.apply(this, args);
        if (!entry || !result?.then) return result;
        controlEvents.push(entry);
        return result.then(
          (value: any) => {
            Object.assign(entry, { acknowledgedMs: performance.now(), ok: true });
            return value;
          },
          (error: any) => {
            Object.assign(entry, {
              acknowledgedMs: performance.now(),
              ok: false,
              code: error.code,
            });
            throw error;
          },
        );
      };
      const httpServer = app.getHttpServer();
      const onRequest = (request: any, response: any) => {
        const entry = {
          method: request.method,
          path: String(request.url)
            .split('?')[0]!
            .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/g, ':id'),
          receivedMs: performance.now(),
        };
        httpEvents.push(entry);
        response.once('finish', () =>
          Object.assign(entry, { sentMs: performance.now(), status: response.statusCode }),
        );
      };
      httpServer.on('request', onRequest);
      const attempts: any[] = [];
      let workload = 'correction';
      client.$transaction = async (callback: any, options: any) => {
        if (typeof callback !== 'function') return original(callback, options);
        const started = performance.now();
        const row: any = {
          workload,
          attemptBeginMs: started,
          prismaInvocationMs: started,
          timeoutMs: options?.timeout ?? 5000,
          locks: [],
        };
        attempts.push(row);
        try {
          const result = await original(async (tx: any) => {
            const txStart = performance.now();
            row.callbackEnteredMs = txStart;
            row.server = (
              await tx.$queryRaw`SELECT pg_backend_pid() pid, transaction_timestamp() transaction_started, clock_timestamp() observed`
            )[0];
            row.pid = row.server.pid;
            row.businessStartedMs = performance.now();
            try {
              return await callback(
                new Proxy(tx, {
                  get(target, key) {
                    const value = Reflect.get(target, key);
                    if (!['$executeRaw', '$queryRaw'].includes(String(key)))
                      return typeof value === 'function' ? value.bind(target) : value;
                    return async (...args: any[]) => {
                      const sql = Array.isArray(args[0])
                        ? args[0].join('?')
                        : typeof args[0] === 'string'
                          ? args[0]
                          : (args[0]?.strings?.join('?') ?? '');
                      const lock =
                        /pg_advisory_xact_lock|FOR UPDATE|FOR KEY SHARE|FOR NO KEY UPDATE/i.test(
                          sql,
                        );
                      const configured = lock
                        ? (
                            await target.$queryRaw`SELECT current_setting('lock_timeout') configured`
                          )[0].configured
                        : null;
                      const t = performance.now();
                      let succeeded = false;
                      try {
                        const result = await value.apply(target, args);
                        succeeded = true;
                        return result;
                      } finally {
                        if (lock) {
                          row.locks.push({
                            kind: /pg_advisory/.test(sql) ? 'advisory' : 'row',
                            configuredLockTimeout: configured,
                            startedMs: t,
                            endedMs: performance.now(),
                            succeeded,
                            durationMs: performance.now() - t,
                            remainingAtStartMs: row.timeoutMs - (t - txStart),
                          });
                          if (
                            succeeded &&
                            args.some(
                              (a) => typeof a === 'string' && a.startsWith('nook:lifecycle-gate:'),
                            )
                          )
                            row.gateAcquiredAt = performance.now();
                        }
                      }
                    };
                  },
                }),
              );
            } finally {
              row.businessFinishedMs = performance.now();
            }
          }, options);
          row.committed = true;
          return result;
        } catch (error: any) {
          row.error = {
            name: error.name,
            code: error.code,
            sqlStates: sqlStates(error),
            classification: classifyFailure(error),
          };
          throw error;
        } finally {
          row.attemptMs = performance.now() - started;
          row.attemptTerminatedMs = performance.now();
          if (row.gateAcquiredAt) row.gateHoldMs = performance.now() - row.gateAcquiredAt;
          delete row.gateAcquiredAt;
        }
      };
      const activityPoller = setInterval(() => {
        if (activityPollRunning) return;
        const pids = attempts.map((attempt) => attempt.pid).filter(Number.isInteger);
        if (!pids.length) return;
        activityPollRunning = true;
        void activityClient
          .query('SELECT * FROM public.nook_a3_observe_activity($1::int[]) ORDER BY pid', [pids])
          .then(
            (result) => {
              for (const row of result.rows) backendActivity.push(row);
            },
            (error: any) => {
              backendActivity.push({
                sampledAt: new Date().toISOString(),
                diagnosticError: { name: error?.name, code: error?.code },
              });
            },
          )
          .finally(() => {
            activityPollRunning = false;
          });
      }, 200);
      activityPoller.unref();
      try {
        workload = 'loaded-http-timeout';
        const gateHolder = createMigratorClient();
        await gateHolder.connect();
        try {
          await gateHolder.query('BEGIN');
          await gateHolder.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
            `nook:lifecycle-gate:${org.orgId}`,
          ]);
          const http = await Promise.all(
            Array.from({ length: 10 }, async () => {
              const started = performance.now(),
                timestamp = new Date().toISOString();
              const response = await post(
                org.owner,
                '/bookings',
                {
                  residentId: org.residentId,
                  bedId: org.bedId,
                  startDate: '2027-02-01',
                  endDate: '2027-03-01',
                  monthlyPrice: 5000,
                },
                null,
              );
              assert.equal(response.status, 409);
              assert.equal(response.body.code, 'RETRY_REQUIRED');
              return {
                timestamp,
                startedMs: started,
                completedMs: performance.now(),
                wallMs: performance.now() - started,
                status: response.status,
                code: response.body.code,
              };
            }),
          );
          const bookingCount = (
            await one('SELECT count(*)::int n FROM bookings WHERE organization_id=$1', [org.orgId])
          ).n;
          assert.equal(bookingCount, 100);
          assert.equal(await auditCount(org.orgId, 'booking.created'), 0);
          console.log(
            JSON.stringify({
              probe: 'loaded-http-timeouts',
              configuredLockTimeoutMs: 3000,
              concurrency: 10,
              http,
              bookingCount,
              bookingCreatedAudits: 0,
            }),
          );
          const probeName = `fin_test_fail_${randomUUID().replaceAll('-', '')}`;
          await db(`CREATE FUNCTION ${probeName}(target uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
        DECLARE started timestamptz; finished timestamptz; state text; previous text; configured text;
        BEGIN
          configured := current_setting('lock_timeout');
          SELECT name INTO previous FROM organizations WHERE id=target;
          BEGIN
            UPDATE organizations SET name='server timeout probe must roll back' WHERE id=target;
            started := clock_timestamp();
            PERFORM pg_advisory_xact_lock(hashtextextended('nook:lifecycle-gate:'||target::text,0));
          EXCEPTION WHEN lock_not_available THEN
            GET STACKED DIAGNOSTICS state = RETURNED_SQLSTATE;
            finished := clock_timestamp();
          END;
          RETURN jsonb_build_object('configured',configured,'sqlState',state,'startedAt',started,'failedAt',finished,'serverElapsedMs',extract(epoch FROM(finished-started))*1000,'unchanged',(SELECT name=previous FROM organizations WHERE id=target));
        END $$`);
          try {
            const measurement = await original(
              async (tx: any) => {
                await tx.$executeRaw`SELECT set_config('lock_timeout','3000ms',true)`;
                return tx.$queryRawUnsafe(`SELECT ${probeName}($1::uuid) result`, org.orgId);
              },
              { timeout: 10000 },
            );
            assert.equal(measurement[0].result.sqlState, '55P03');
            assert.equal(measurement[0].result.unchanged, true);
            console.log(
              JSON.stringify({
                probe: 'server-lock-timeout',
                ...measurement[0].result,
                exceptionBlockRolledBack: true,
              }),
            );
          } finally {
            await db(`DROP FUNCTION ${probeName}(uuid)`);
          }
        } finally {
          await gateHolder.query('ROLLBACK');
          await gateHolder.end();
        }
        workload = 'correction';
        for (let i = 0; i < 20; i++) {
          const created = await priceProposal(
            org.pm,
            stay.bookingId,
            i % 2 === 0 ? '5001' : '5000',
          );
          await post(org.owner, `/corrections/${created.body.id}/approve`, {
            decisionReason: 'Measured register correction',
          }).expect(200);
        }
        workload = 'concurrent-correction';
        const targets = await db(
          'SELECT id FROM bookings WHERE organization_id=$1 AND id<>$2 ORDER BY id LIMIT 20',
          [org.orgId, stay.bookingId],
        );
        const proposals = await Promise.all(
          targets.map((target: any) => priceProposal(org.pm, target.id, '5001')),
        );
        const outcomes = await Promise.all(
          proposals.map((created: any) =>
            post(org.owner, `/corrections/${created.body.id}/approve`, {
              decisionReason: 'Concurrent measured correction',
            }).then((r: any) => ({ status: r.status, code: r.body.code ?? null })),
          ),
        );
        assert.ok(outcomes.every((r: any) => r.status === 200));
        console.log(
          JSON.stringify({ probe: 'concurrent-correction-outcomes', concurrency: 20, outcomes }),
        );
        workload = 'all-gated-fields';
        const allTargets = await db(
          `SELECT b.id booking, a.id admission, c.id checkin FROM bookings b JOIN admissions a ON a.booking_id=b.id JOIN check_ins c ON c.admission_id=a.id WHERE b.organization_id=$1 ORDER BY b.id DESC LIMIT 6`,
          [org.orgId],
        );
        const checkout = randomUUID();
        await db("UPDATE check_ins SET status='CHECKED_OUT' WHERE id=$1", [allTargets[5].checkin]);
        await db(
          `INSERT INTO check_outs(id,organization_id,check_in_id,resident_id,bed_id,booking_id,check_out_at,updated_at) SELECT $1,organization_id,id,resident_id,bed_id,booking_id,'2026-10-15',now() FROM check_ins WHERE id=$2`,
          [checkout, allTargets[5].checkin],
        );
        const fields = [
          {
            targetType: 'BOOKING',
            targetId: allTargets[0].booking,
            fieldKey: 'startDate',
            proposedValue: '2026-08-31',
          },
          {
            targetType: 'BOOKING',
            targetId: allTargets[1].booking,
            fieldKey: 'endDate',
            proposedValue: '2026-12-31',
          },
          {
            targetType: 'BOOKING',
            targetId: allTargets[2].booking,
            fieldKey: 'monthlyPrice',
            proposedValue: '5100',
          },
          {
            targetType: 'ADMISSION',
            targetId: allTargets[3].admission,
            fieldKey: 'admissionDate',
            proposedValue: '2026-09-02',
          },
          {
            targetType: 'CHECK_IN',
            targetId: allTargets[4].checkin,
            fieldKey: 'checkInAt',
            proposedValue: '2026-10-02T00:00:00Z',
          },
          {
            targetType: 'CHECK_OUT',
            targetId: checkout,
            fieldKey: 'checkOutAt',
            proposedValue: '2026-10-16T00:00:00Z',
          },
        ];
        const fullProposals = await Promise.all(
          fields.map(async (field) => {
            const response = await post(org.pm, '/corrections', {
              ...field,
              reason: 'All-field measured correction',
              effectiveAt: new Date().toISOString(),
              evidenceReference: 'Disposable fixture register',
            });
            if (response.status !== 201)
              console.log(
                JSON.stringify({
                  probe: 'field-submit-failure',
                  field: field.fieldKey,
                  status: response.status,
                  code: response.body.code,
                  message: response.body.message,
                }),
              );
            return response;
          }),
        );
        assert.ok(fullProposals.every((response: any) => response.status === 201));
        const scheduler = new InvoiceSchedulerService(
          app.get(PrismaService),
          app.get(FinanceService),
        );
        const allResults = await Promise.all([
          ...fullProposals.map((created: any) =>
            post(org.owner, `/corrections/${created.body.id}/approve`, {
              decisionReason: 'All-field review',
              exceptionRationale: 'Disposable registered evidence',
            }).then((r: any) => ({ status: r.status, code: r.body.code ?? null })),
          ),
          scheduler
            .run({
              organizationIds: [org.orgId],
              now: new Date('2026-11-10T04:00:00Z'),
              lookbackMonths: 0,
              maxAttempts: 1,
            })
            .then((r: any) => ({ scheduler: true, created: r.created, failed: r.failed })),
          ...Array.from({ length: 10 }, () =>
            post(
              org.owner,
              '/bookings',
              {
                residentId: org.residentId,
                bedId: org.bedId,
                startDate: '2026-09-01',
                endDate: '2027-01-01',
                monthlyPrice: 5000,
              },
              null,
            ).then((r: any) => ({ ordinary: true, status: r.status, code: r.body.code ?? null })),
          ),
        ]);
        console.log(
          JSON.stringify({
            probe: 'all-field-scheduler',
            fields: fields.map((f) => f.fieldKey),
            concurrency: 17,
            ordinaryClients: 10,
            results: allResults,
          }),
        );
        assert.ok(
          allResults.every((r: any) =>
            r.scheduler
              ? r.failed === 0
              : r.ordinary
                ? r.status === 409
                : r.status === 200 || (r.status === 409 && r.code === 'STALE_SOURCE'),
          ),
        );
        for (let i = 0; i < fields.length; i++) {
          if ((allResults[i] as any).status !== 409) continue;
          const created = await post(org.pm, '/corrections', {
            ...fields[i],
            reason: 'Post-scheduler measured correction',
            effectiveAt: new Date().toISOString(),
            evidenceReference: 'Disposable fixture register',
          }).expect(201);
          const applied = await post(org.owner, `/corrections/${created.body.id}/approve`, {
            decisionReason: 'Post-scheduler review',
            exceptionRationale: 'Recorded fixture evidence',
          });
          console.log(
            JSON.stringify({
              probe: 'all-field-post-scheduler',
              field: fields[i]!.fieldKey,
              status: applied.status,
              code: applied.body.code ?? null,
            }),
          );
          assert.equal(applied.status, 200);
        }
        workload = 'real-retry';
        const retryProposal = await post(org.pm, '/corrections', nameBody(org)).expect(201);
        const holder = createMigratorClient();
        await holder.connect();
        const retryKey = randomUUID();
        try {
          await holder.query('BEGIN');
          await holder.query('SELECT id FROM residents WHERE id=$1 FOR UPDATE', [org.residentId]);
          const approving = post(
            org.owner,
            `/corrections/${retryProposal.body.id}/approve`,
            { decisionReason: 'Real deadlock recovery' },
            retryKey,
          ).then((r: any) => r);
          await new Promise((resolve) => setTimeout(resolve, 300));
          await holder.query('SELECT id FROM correction_proposals WHERE id=$1 FOR UPDATE', [
            retryProposal.body.id,
          ]);
          await holder.query('COMMIT');
          const result = await approving;
          assert.equal(result.status, 200);
          const replay = await post(
            org.owner,
            `/corrections/${retryProposal.body.id}/approve`,
            { decisionReason: 'Real deadlock recovery' },
            retryKey,
          ).expect(200);
          assert.equal(replay.body.idempotentReplay, true);
          assert.equal(
            (
              await one(
                "SELECT count(*)::int n FROM correction_command_receipts WHERE proposal_id=$1 AND action='APPROVE'",
                [retryProposal.body.id],
              )
            ).n,
            1,
          );
          const audits = (
            await one(
              "SELECT count(*)::int n FROM audit_events WHERE organization_id=$1 AND action='correction.applied' AND metadata->>'proposalId'=$2",
              [org.orgId, retryProposal.body.id],
            )
          ).n;
          assert.equal(audits, 1);
          assert.equal((await residentName(org.residentId)).first_name, 'Aarav');
          console.log(
            JSON.stringify({
              probe: 'real-retry-http',
              status: result.status,
              replay: replay.body.idempotentReplay,
              approvalReceipts: 1,
              applicationAudits: audits,
              finalFirstName: 'Aarav',
            }),
          );
        } finally {
          await holder.query('ROLLBACK');
          await holder.end();
        }
        for (const injection of [
          { state: '40001', failures: 2, expected: 200 },
          { state: '40001', failures: 3, expected: 409 },
          { state: '23505', failures: 1, expected: 500 },
          { state: '57014', failures: 1, expected: 409 },
        ]) {
          workload = `injected-${injection.state}-${injection.failures}`;
          const created = await post(
            org.pm,
            '/corrections',
            nameBody(org, { proposedValue: `Injected${injection.state}${injection.failures}` }),
          ).expect(201);
          const fixture = `fin_test_fail_${randomUUID().replaceAll('-', '')}`,
            sequence = `${fixture}_seq`;
          const key = randomUUID();
          await db(`CREATE SEQUENCE ${sequence}`);
          await db(`GRANT USAGE, SELECT ON SEQUENCE ${sequence} TO nook_ci_full_runtime`);
          await db(
            `CREATE FUNCTION ${fixture}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF nextval('${sequence}')<=${injection.failures} THEN RAISE EXCEPTION 'disposable controlled SQLSTATE injection' USING ERRCODE='${injection.state}'; END IF; RETURN NEW; END $$`,
          );
          await db(
            `CREATE TRIGGER ${fixture} BEFORE UPDATE ON correction_proposals FOR EACH ROW WHEN (OLD.id='${created.body.id}'::uuid) EXECUTE FUNCTION ${fixture}()`,
          );
          const before = attempts.length;
          try {
            const response = await post(
              org.owner,
              `/corrections/${created.body.id}/approve`,
              { decisionReason: 'Controlled database fault evidence' },
              key,
            );
            if (response.status !== injection.expected)
              console.log(
                JSON.stringify({
                  probe: 'injection-unexpected-response',
                  state: injection.state,
                  expected: injection.expected,
                  status: response.status,
                  code: response.body.code ?? null,
                  attempts: attempts.slice(before),
                }),
              );
            assert.equal(response.status, injection.expected);
            const durable = await one(`SELECT status FROM correction_proposals WHERE id=$1`, [
              created.body.id,
            ]);
            const receipts = (
              await one(
                "SELECT count(*)::int n FROM correction_command_receipts WHERE proposal_id=$1 AND action='APPROVE'",
                [created.body.id],
              )
            ).n;
            const audits = (
              await one(
                "SELECT count(*)::int n FROM audit_events WHERE organization_id=$1 AND action='correction.applied' AND metadata->>'proposalId'=$2",
                [org.orgId, created.body.id],
              )
            ).n;
            assert.equal(receipts, response.status === 200 ? 1 : 0);
            assert.equal(audits, receipts);
            const count = attempts.length - before;
            assert.equal(count, injection.state === '40001' ? 3 : 1);
            console.log(
              JSON.stringify({
                probe: 'controlled-http-fault',
                injected: true,
                naturallyOccurring: false,
                sqlState: injection.state,
                failuresRequested: injection.failures,
                totalAttempts: count,
                retries: count - 1,
                httpStatus: response.status,
                httpCode: response.body.code ?? null,
                durableStatus: durable.status,
                receipts,
                applicationAudits: audits,
                attempts: attempts.slice(before),
              }),
            );
          } finally {
            await db(`DROP TRIGGER ${fixture} ON correction_proposals`);
            await db(`DROP FUNCTION ${fixture}()`);
            await db(`DROP SEQUENCE ${sequence}`);
          }
          const recovered = await post(
            org.owner,
            `/corrections/${created.body.id}/approve`,
            { decisionReason: 'Controlled database fault evidence' },
            key,
          ).expect(200);
          const replayed = await post(
            org.owner,
            `/corrections/${created.body.id}/approve`,
            { decisionReason: 'Controlled database fault evidence' },
            key,
          ).expect(200);
          assert.equal(replayed.body.idempotentReplay, true);
          console.log(
            JSON.stringify({
              probe: 'controlled-http-replay',
              sqlState: injection.state,
              status: recovered.status,
              replay: true,
            }),
          );
        }
        for (const cancel of [false, true]) {
          workload = cancel ? 'endpoint-cancel' : 'endpoint-row-timeout';
          const pending = await post(
            org.pm,
            '/corrections',
            nameBody(org, { proposedValue: cancel ? 'EndpointCancel' : 'EndpointTimeout' }),
          ).expect(201);
          const holder = createMigratorClient();
          await holder.connect();
          const before = attempts.length,
            started = performance.now();
          try {
            await holder.query('BEGIN');
            await holder.query('SELECT id FROM residents WHERE id=$1 FOR UPDATE', [org.residentId]);
            const responsePromise = post(org.owner, `/corrections/${pending.body.id}/approve`, {
              decisionReason: 'Endpoint boundary probe',
            }).then((r: any) => r);
            if (cancel) {
              await new Promise((r) => setTimeout(r, 300));
              const pid = attempts[before]?.pid;
              assert.ok(pid);
              await client.$queryRaw`SELECT pg_cancel_backend(${pid}::int)`;
            }
            const response = await responsePromise;
            assert.equal(response.status, 409);
            assert.equal(response.body.code, 'RETRY_REQUIRED');
            assert.equal(
              (await one('SELECT status FROM correction_proposals WHERE id=$1', [pending.body.id]))
                .status,
              'PENDING',
            );
            assert.equal(
              (
                await one(
                  "SELECT count(*)::int n FROM correction_command_receipts WHERE proposal_id=$1 AND action='APPROVE'",
                  [pending.body.id],
                )
              ).n,
              0,
            );
            console.log(
              JSON.stringify({
                probe: 'endpoint-boundary',
                scenario: workload,
                httpStatus: response.status,
                code: response.body.code,
                wallMs: performance.now() - started,
                attempts: attempts.slice(before),
                proposalUnchanged: true,
                approvalReceipts: 0,
              }),
            );
          } finally {
            await holder.query('ROLLBACK');
            await holder.end();
          }
          await post(org.pm, `/corrections/${pending.body.id}/withdraw`, {
            reason: 'Completed disposable probe',
          }).expect(200);
        }
        for (let deadlineSample = 0; deadlineSample < 3; deadlineSample++) {
          workload = 'endpoint-transaction-timeout';
          const timedProposal = await post(
            org.pm,
            '/corrections',
            nameBody(org, { proposedValue: 'EndpointAttemptTimeout' }),
          ).expect(201);
          const timedFixture = `fin_test_fail_${randomUUID().replaceAll('-', '')}`;
          await db(
            `CREATE FUNCTION ${timedFixture}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(31); RETURN NEW; END $$`,
          );
          await db(
            `CREATE TRIGGER ${timedFixture} BEFORE UPDATE ON correction_proposals FOR EACH ROW WHEN (OLD.id='${timedProposal.body.id}'::uuid) EXECUTE FUNCTION ${timedFixture}()`,
          );
          const timeoutBefore = attempts.length,
            timeoutStarted = performance.now();
          const timeoutSourceBefore = (await residentName(org.residentId)).first_name;
          try {
            const response = await post(
              org.owner,
              `/corrections/${timedProposal.body.id}/approve`,
              { decisionReason: 'Real configured transaction timeout' },
            );
            assert.equal(response.status, 409);
            assert.equal(response.body.code, 'RETRY_REQUIRED');
            assert.equal(
              (
                await one('SELECT status FROM correction_proposals WHERE id=$1', [
                  timedProposal.body.id,
                ])
              ).status,
              'PENDING',
            );
            assert.equal(
              (
                await one(
                  "SELECT count(*)::int n FROM correction_command_receipts WHERE proposal_id=$1 AND action='APPROVE'",
                  [timedProposal.body.id],
                )
              ).n,
              0,
            );
            assert.equal((await residentName(org.residentId)).first_name, timeoutSourceBefore);
            assert.equal(
              (
                await one(
                  "SELECT count(*)::int n FROM audit_events WHERE organization_id=$1 AND action='correction.applied' AND metadata->>'proposalId'=$2",
                  [org.orgId, timedProposal.body.id],
                )
              ).n,
              0,
            );
            assert.equal(attempts.length - timeoutBefore, 1);
            console.log(
              JSON.stringify({
                probe: 'endpoint-transaction-timeout',
                sample: deadlineSample,
                controlledDelayMs: 31000,
                configuredAttemptTimeoutMs: 30000,
                httpStatus: response.status,
                code: response.body.code,
                wallMs: performance.now() - timeoutStarted,
                attempts: attempts.slice(timeoutBefore),
                proposalUnchanged: true,
                receipts: 0,
              }),
            );
            assert.ok(attempts.slice(timeoutBefore).every((a) => a.attemptMs <= 30000));
          } finally {
            await db(`DROP TRIGGER ${timedFixture} ON correction_proposals`);
            await db(`DROP FUNCTION ${timedFixture}()`);
          }
          await post(org.pm, `/corrections/${timedProposal.body.id}/withdraw`, {
            reason: 'Completed timeout sample',
          }).expect(200);
        }
        workload = 'monthly-generation';
        const generation: any[] = [];
        await Promise.all(
          Array.from({ length: 5 }, async () => {
            const response = await post(
              org.owner,
              '/finance/invoices/generate-monthly',
              { month: '2026-11', issue: false },
              null,
            ).expect(201);
            generation.push(response.body);
          }),
        );
        const stats = (values: number[]) => {
          const sorted = [...values].sort((a, b) => a - b);
          const q = (p: number) => sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
          return { count: sorted.length, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: q(1) };
        };
        console.log(
          JSON.stringify({
            probe: 'performance-gate-holds',
            timestamp: new Date().toISOString(),
            hardware: {
              platform: os.platform(),
              arch: os.arch(),
              cpu: os.cpus()[0]?.model,
              cpus: os.cpus().length,
              memoryBytes: os.totalmem(),
              node: process.version,
            },
            fixture: {
              beds: 100,
              residents: 100,
              bookings: 100,
              activeStays: 100,
              historicalInvoices: 1200,
            },
            profile: { correctionSamples: 20, generationSamples: 5, concurrency: 1 },
            attempts,
            controlEvents,
            httpEvents,
            generation,
            correctionHolds: stats(
              attempts
                .filter((a) => a.workload === 'correction' && a.gateHoldMs !== undefined)
                .map((a) => a.gateHoldMs),
            ),
            generationHolds: stats(
              attempts
                .filter((a) => a.workload === 'monthly-generation' && a.gateHoldMs !== undefined)
                .map((a) => a.gateHoldMs),
            ),
            attemptDurations: stats(attempts.map((a) => a.attemptMs)),
            acquisitionDurations: stats(
              attempts.flatMap((a) => a.locks.map((l: any) => l.durationMs)),
            ),
          }),
        );
      } finally {
        clearInterval(activityPoller);
        await activityClient.end().catch(() => {});
        clearInterval(heartbeat);
        for (const attempt of attempts) {
          const begin = controlEvents.find(
            (event) =>
              event.kind === 'BEGIN' &&
              event.pid === attempt.pid &&
              event.submittedMs >= attempt.prismaInvocationMs,
          );
          const terminal =
            begin &&
            controlEvents.find(
              (event) =>
                ['COMMIT', 'ROLLBACK'].includes(event.kind) &&
                event.pid === attempt.pid &&
                event.submittedMs >= begin.acknowledgedMs,
            );
          if (begin)
            attempt.connectionAcquireAndBeginMs = begin.acknowledgedMs - attempt.prismaInvocationMs;
          if (terminal)
            attempt.terminalControl = {
              kind: terminal.kind,
              submittedMs: terminal.submittedMs,
              acknowledgedMs: terminal.acknowledgedMs,
              ok: terminal.ok,
            };
        }
        console.log(
          JSON.stringify({
            probe: 'a3-forensics-final',
            workload,
            attempts,
            controlEvents,
            httpEvents,
            backendActivity,
            eventLoopHeartbeatMs: 50,
            eventLoopGapsMs: eventLoopGaps,
            maxHeartbeatGapMs: Math.max(0, ...eventLoopGaps),
          }),
        );
        client.$transaction = original;
        pgPrototype.query = originalQuery;
        httpServer.off('request', onRequest);
      }
    } catch (error: any) {
      console.log(
        JSON.stringify({
          probe: 'performance-failure',
          name: error.name,
          code: error.code,
          constraint: error.constraint,
          message: String(error.message).split('\n')[0],
        }),
      );
      throw error;
    }
  },
);

test('historical withdrawal constraint reproduces rollback and 500; corrected constraint permits one replayable withdrawal', async () => {
  const org = await newOrg();
  const created = await post(org.pm, '/corrections', nameBody(org)).expect(201);
  const key = randomUUID();
  const constraint = 'correction_proposals_self_review_check';
  const replace = async (expression: string) =>
    withMigratorClient(async (c) => {
      await c.query('BEGIN');
      try {
        await c.query(`ALTER TABLE correction_proposals DROP CONSTRAINT ${constraint}`);
        await c.query(
          `ALTER TABLE correction_proposals ADD CONSTRAINT ${constraint} CHECK (${expression})`,
        );
        await c.query('COMMIT');
      } catch (error) {
        await c.query('ROLLBACK');
        throw error;
      }
    });
  try {
    await replace('requested_by <> decided_by OR decided_by IS NULL');
    let observed: any;
    try {
      await app.get(PrismaService).db.correctionProposal.update({
        where: { id: created.body.id },
        data: {
          status: 'WITHDRAWN',
          decidedBy: org.pm.userId,
          decidedAt: new Date(),
          decisionReason: 'mistake',
        },
      });
    } catch (error) {
      observed = error;
    }
    assert.ok(observed);
    assert.ok(sqlStates(observed).includes('23514'));
    const http = await post(
      org.pm,
      `/corrections/${created.body.id}/withdraw`,
      { reason: 'mistake' },
      key,
    ).expect(500);
    const count = (
      await one(
        `SELECT count(*)::int n FROM correction_command_receipts WHERE proposal_id=$1 AND action='WITHDRAW'`,
        [created.body.id],
      )
    ).n;
    assert.equal(count, 0);
    assert.equal(
      (await one('SELECT status FROM correction_proposals WHERE id=$1', [created.body.id])).status,
      'PENDING',
    );
    console.log(
      JSON.stringify({
        probe: 'historical-withdrawal',
        phase: 'proposal-update-before-receipt',
        sqlStates: sqlStates(observed),
        prismaName: observed.name,
        prismaCode: observed.code,
        classification: classifyFailure(observed),
        constraint,
        httpStatus: http.status,
        response: { message: http.body.message, statusCode: http.body.statusCode },
        transaction: 'rolled-back',
        decisionReceipts: count,
      }),
    );
  } finally {
    await replace("status = 'WITHDRAWN' OR requested_by <> decided_by OR decided_by IS NULL");
  }
  await post(org.pm, `/corrections/${created.body.id}/withdraw`, { reason: 'mistake' }, key).expect(
    200,
  );
  const replay = await post(
    org.pm,
    `/corrections/${created.body.id}/withdraw`,
    { reason: 'mistake' },
    key,
  ).expect(200);
  assert.equal(replay.body.idempotentReplay, true);
});

test('stay summary reads real property relations and finance for empty and active residents with tenant isolation', async () => {
  const org = await newOrg();
  const other = await newOrg();
  const path = `/api/v1/residents/${org.residentId}/stay-summary`;
  const empty = await server.get(path).set(org.owner.headers).expect(200);
  assert.equal(empty.body.currentStayStatus, 'NO_ACTIVE_STAY');
  assert.equal(empty.body.financeBalance.totals.outstandingAmount, '0.00');
  await server.get(path).set(other.owner.headers).expect(404);
  await seedStay(org);
  const active = await server.get(path).set(org.owner.headers).expect(200);
  assert.equal(active.body.currentStayStatus, 'ACTIVE');
  assert.equal(active.body.currentStay.booking.propertyName, 'P');
  assert.equal(active.body.financeBalance.totals.outstandingAmount, '0.00');
});
const deadlocks = async () =>
  Number(
    (await one(`SELECT deadlocks FROM pg_stat_database WHERE datname = current_database()`))
      .deadlocks,
  );
const proposalCount = (orgId: string, status?: string) =>
  db(
    `SELECT count(*)::int n FROM correction_proposals WHERE organization_id = $1 ${status ? "AND status = '" + status + "'" : ''}`,
    [orgId],
  ).then((r) => r[0].n as number);
const auditCount = (orgId: string, action: string) =>
  db(`SELECT count(*)::int n FROM audit_events WHERE organization_id = $1 AND action = $2`, [
    orgId,
    action,
  ]).then((r) => r[0].n as number);
const residentName = (id: string) =>
  one(`SELECT first_name, last_name FROM residents WHERE id = $1`, [id]);

test.before(async () => {
  passwordHash = await hashTestPassword();
  app = await NestFactory.create(CorrectionTestAppModule, { abortOnError: true });
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new AllExceptionsFilter()); // as in production (app.setup.ts)
  await app.init();
  await app.listen(0);
  server = request(`http://localhost:${app.getHttpServer().address().port}`);
  schedulerApp = await NestFactory.createApplicationContext(JobsModule, { logger: false });
});
test.after(async () => {
  await app.close();
  await schedulerApp.close();
});

// ------------------------------------------------------------------------------------------ end to end

test('names: submit, independent approval, atomic audits and receipts, and idempotent replay', async () => {
  const org = await newOrg();
  const submitKey = randomUUID();
  const submitBody = nameBody(org);
  const created = await post(org.pm, '/corrections', submitBody, submitKey).expect(201);
  assert.equal(created.body.status, 'PENDING');
  assert.equal(created.body.originalValue.value, 'Arahv', 'the original is captured by the server');
  assert.equal(
    (await residentName(org.residentId)).first_name,
    'Arahv',
    'a pending proposal changes nothing',
  );
  assert.equal(created.body.expectedSnapshot, undefined);

  // the requester cannot review, and a forged identity in the body is refused
  await post(org.pm, `/corrections/${created.body.id}/approve`, { decisionReason: 'mine' }).expect(
    403,
  );
  await post(org.pm, '/corrections', { ...nameBody(org), requestedBy: org.owner.userId }).expect(
    400,
  );

  const approveKey = randomUUID();
  const approved = await post(
    org.owner,
    `/corrections/${created.body.id}/approve`,
    { decisionReason: 'Checked' },
    approveKey,
  ).expect(200);
  assert.equal(approved.body.status, 'APPLIED');
  const name = await residentName(org.residentId);
  assert.equal(name.first_name, 'Aarav');
  assert.equal(name.last_name, 'Shah');
  assert.equal(await auditCount(org.orgId, 'correction.submitted'), 1);
  assert.equal(await auditCount(org.orgId, 'resident.corrected'), 1);
  assert.equal(await auditCount(org.orgId, 'correction.applied'), 1);

  // exact replays: same status, nothing new
  const replaySubmit = await post(org.pm, '/corrections', submitBody, submitKey).expect(201);
  assert.equal(replaySubmit.body.idempotentReplay, true);
  const replay = await post(
    org.owner,
    `/corrections/${created.body.id}/approve`,
    { decisionReason: 'Checked' },
    approveKey,
  ).expect(200);
  assert.equal(replay.body.idempotentReplay, true);
  await post(
    org.owner,
    `/corrections/${created.body.id}/approve`,
    { decisionReason: 'Other text' },
    approveKey,
  ).expect(409);
  assert.equal(await auditCount(org.orgId, 'correction.applied'), 1);
  assert.equal(await proposalCount(org.orgId), 1);
  assert.equal(
    (
      await db(
        `SELECT count(*)::int n FROM correction_command_receipts WHERE organization_id = $1`,
        [org.orgId],
      )
    )[0].n,
    2,
  );
  // a fresh key on a terminal proposal is INVALID_STATE, never a second application
  const again = await post(org.owner2, `/corrections/${created.body.id}/approve`, {
    decisionReason: 'again',
  }).expect(409);
  assert.equal(again.body.code, 'INVALID_STATE');
});

test('tenant isolation: queue, detail, history and decisions never cross organizations', async () => {
  const a = await newOrg();
  const b = await newOrg();
  const created = await post(a.pm, '/corrections', nameBody(a)).expect(201);
  const list = await server.get('/api/v1/corrections').set(b.owner.headers).expect(200);
  assert.equal(list.body.total, 0);
  await server.get(`/api/v1/corrections/${created.body.id}`).set(b.owner.headers).expect(404);
  await server
    .get(`/api/v1/corrections/history?targetType=RESIDENT&targetId=${a.residentId}`)
    .set(b.owner.headers)
    .expect(404);
  await post(b.owner, `/corrections/${created.body.id}/approve`, { decisionReason: 'x' }).expect(
    404,
  );
  await post(b.owner, '/corrections', nameBody(a)).expect(404); // another organization's resident
  assert.equal((await residentName(a.residentId)).first_name, 'Arahv');
  const own = await server
    .get('/api/v1/corrections?status=PENDING')
    .set(a.owner.headers)
    .expect(200);
  assert.equal(own.body.total, 1);
  assert.ok(!('proposedValue' in own.body.items[0]), 'the queue carries no values');
});

test('stale: a changed dependency commits terminal STALE (audit + receipt) and only then returns 409; replay is the same 409', async () => {
  const org = await newOrg();
  const created = await post(org.pm, '/corrections', nameBody(org)).expect(201);
  await db(`UPDATE residents SET first_name = 'Changed Elsewhere' WHERE id = $1`, [org.residentId]);
  const key = randomUUID();
  const res = await post(
    org.owner,
    `/corrections/${created.body.id}/approve`,
    { decisionReason: 'ok' },
    key,
  ).expect(409);
  assert.equal(res.body.code, 'STALE_SOURCE');
  const row = await one(
    `SELECT status, stale_cause, decided_by FROM correction_proposals WHERE id = $1`,
    [created.body.id],
  );
  assert.equal(row.status, 'STALE', 'the STALE transition was committed');
  assert.equal(row.stale_cause, 'RESIDENT_FIELD');
  assert.equal(await auditCount(org.orgId, 'correction.stale'), 1);
  const replay = await post(
    org.owner,
    `/corrections/${created.body.id}/approve`,
    { decisionReason: 'ok' },
    key,
  ).expect(409);
  assert.equal(replay.body.code, 'STALE_SOURCE');
  assert.equal(await auditCount(org.orgId, 'correction.stale'), 1, 'replay writes nothing');
  assert.equal((await residentName(org.residentId)).first_name, 'Changed Elsewhere');
});

test('an unrelated change (the sibling name, an archive) does not stale a name proposal; columns survive each other', async () => {
  const org = await newOrg();
  const created = await post(org.pm, '/corrections', nameBody(org)).expect(201);
  await db(
    `UPDATE residents SET last_name = 'Shaw', status = 'ARCHIVED', phone = '9876543210' WHERE id = $1`,
    [org.residentId],
  );
  await post(org.owner, `/corrections/${created.body.id}/approve`, { decisionReason: 'ok' }).expect(
    200,
  );
  const row = await one(
    `SELECT first_name, last_name, status, phone FROM residents WHERE id = $1`,
    [org.residentId],
  );
  assert.deepEqual(
    [row.first_name, row.last_name, row.status, row.phone],
    ['Aarav', 'Shaw', 'ARCHIVED', '9876543210'],
  );
});

// ------------------------------------------------------------------------------------------------ races

test('race 1: two same-field proposals with different keys leave exactly one PENDING proposal and one 409 PENDING_CONFLICT', async () => {
  for (let round = 0; round < 8; round += 1) {
    const org = await newOrg();
    const [a, b] = await Promise.all([
      post(org.pm, '/corrections', nameBody(org, { proposedValue: 'Aarav' })),
      post(org.pm2, '/corrections', nameBody(org, { proposedValue: 'Arav' })),
    ]);
    assert.deepEqual(
      [a.status, b.status].sort(),
      [201, 409],
      `round ${round}: ${a.status}/${b.status}`,
    );
    const loser = a.status === 409 ? a : b;
    assert.equal(loser.body.code, 'PENDING_CONFLICT');
    assert.ok(
      !JSON.stringify(loser.body).includes('correction_proposals'),
      'no index or table name in the body',
    );
    assert.equal(await proposalCount(org.orgId), 1);
    assert.equal(
      await auditCount(org.orgId, 'correction.submitted'),
      1,
      'the loser leaves no audit',
    );
    assert.equal(
      (
        await db(
          `SELECT count(*)::int n FROM correction_command_receipts WHERE organization_id = $1`,
          [org.orgId],
        )
      )[0].n,
      1,
      'the loser leaves no receipt',
    );
  }
});

test('race 2: different fields of one resident submitted concurrently both persist', async () => {
  const org = await newOrg();
  const [a, b] = await Promise.all([
    post(org.pm, '/corrections', nameBody(org)),
    post(org.pm2, '/corrections', nameBody(org, { fieldKey: 'lastName', proposedValue: 'Shaw' })),
  ]);
  assert.deepEqual([a.status, b.status], [201, 201]);
  assert.equal(await proposalCount(org.orgId, 'PENDING'), 2);
});

test('race 3: two independent name proposals approved concurrently are both applied, each touching only its column', async () => {
  for (let round = 0; round < 6; round += 1) {
    const org = await newOrg();
    const first = await post(org.pm, '/corrections', nameBody(org)).expect(201);
    const last = await post(
      org.pm2,
      '/corrections',
      nameBody(org, { fieldKey: 'lastName', proposedValue: 'Shaw' }),
    ).expect(201);
    const [x, y] = await Promise.all([
      post(org.owner, `/corrections/${first.body.id}/approve`, { decisionReason: 'ok' }),
      post(org.owner2, `/corrections/${last.body.id}/approve`, { decisionReason: 'ok' }),
    ]);
    assert.deepEqual([x.status, y.status], [200, 200], JSON.stringify([x.body, y.body]));
    const name = await residentName(org.residentId);
    assert.deepEqual([name.first_name, name.last_name], ['Aarav', 'Shaw']);
  }
});

test('races 13 and 14: approve vs reject, and approve vs withdraw, end in exactly one terminal state with one winner', async () => {
  for (let round = 0; round < 8; round += 1) {
    const org = await newOrg();
    const created = await post(org.pm, '/corrections', nameBody(org)).expect(201);
    const opponent =
      round % 2 === 0
        ? post(org.owner2, `/corrections/${created.body.id}/reject`, { reason: 'no' })
        : post(org.pm, `/corrections/${created.body.id}/withdraw`, { reason: 'mistake' });
    const [approve, other] = await Promise.all([
      post(org.owner, `/corrections/${created.body.id}/approve`, { decisionReason: 'ok' }),
      opponent,
    ]);
    assert.deepEqual([approve.status, other.status].sort(), [200, 409], `round ${round}`);
    const row = await one(`SELECT status FROM correction_proposals WHERE id = $1`, [
      created.body.id,
    ]);
    const name = (await residentName(org.residentId)).first_name;
    if (approve.status === 200) {
      assert.equal(row.status, 'APPLIED');
      assert.equal(name, 'Aarav');
    } else {
      assert.ok(['REJECTED', 'WITHDRAWN'].includes(row.status));
      assert.equal(name, 'Arahv', 'the loser of approval changed nothing');
    }
    assert.equal(other.body.code ?? approve.body.code, 'INVALID_STATE');
    console.log(
      JSON.stringify({
        probe: 'decision-race',
        round,
        opponent: round % 2 === 0 ? 'reject' : 'withdraw',
        approve: { status: approve.status, code: approve.body.code ?? null },
        other: { status: other.status, code: other.body.code ?? null },
        finalStatus: row.status,
        residentFirstName: name,
        winnerCommitted: true,
        loserRolledBack: true,
      }),
    );
    assert.equal(
      (
        await one(
          `SELECT count(*)::int n FROM correction_command_receipts WHERE proposal_id = $1 AND action IN ('APPROVE', 'REJECT', 'WITHDRAW')`,
          [created.body.id],
        )
      ).n,
      1,
    );
    assert.equal(
      (
        await one(
          `SELECT count(*)::int n FROM audit_events WHERE organization_id = $1 AND action IN ('correction.applied', 'correction.rejected', 'correction.withdrawn')`,
          [org.orgId],
        )
      ).n,
      1,
    );
  }
});

test('race 15: duplicate identical approvals sent at once apply once; a retry after the response is lost is a replay', async () => {
  const org = await newOrg();
  const created = await post(org.pm, '/corrections', nameBody(org)).expect(201);
  const key = randomUUID();
  const [a, b] = await Promise.all([
    post(org.owner, `/corrections/${created.body.id}/approve`, { decisionReason: 'ok' }, key),
    post(org.owner, `/corrections/${created.body.id}/approve`, { decisionReason: 'ok' }, key),
  ]);
  assert.deepEqual([a.status, b.status], [200, 200]);
  assert.equal(
    [a.body, b.body].filter((x) => x.idempotentReplay).length,
    1,
    'exactly one of them was the replay',
  );
  assert.equal(await auditCount(org.orgId, 'correction.applied'), 1);
  assert.equal(
    (
      await db(
        `SELECT count(*)::int n FROM correction_command_receipts WHERE organization_id = $1 AND action = 'APPROVE'`,
        [org.orgId],
      )
    )[0].n,
    1,
  );
});

// --------------------------------------------------------------------------- the database enforces what the service claims

test('database: a terminal proposal cannot be rewritten or deleted, even by the owner role', async () => {
  const org = await newOrg();
  const created = await post(org.pm, '/corrections', nameBody(org)).expect(201);
  await post(org.owner, `/corrections/${created.body.id}/reject`, { reason: 'no' }).expect(200);
  for (const sql of [
    `UPDATE correction_proposals SET reason = 'edited' WHERE id = $1`,
    `DELETE FROM correction_proposals WHERE id = $1`,
    `UPDATE correction_command_receipts SET outcome_code = 'X' WHERE proposal_id = $1`,
  ]) {
    await assert.rejects(db(sql, [created.body.id]), (e: any) => e.code === '23001', sql);
  }
  assert.equal(
    (await one(`SELECT status FROM correction_proposals WHERE id = $1`, [created.body.id])).status,
    'REJECTED',
  );
  assert.equal(
    (await one(`SELECT reason FROM correction_proposals WHERE id = $1`, [created.body.id])).reason,
    'Misspelled at registration',
  );
});

// ------------------------------------------------------- gated lifecycle fields, precision and billing gaps

test('check-in correction: sub-millisecond precision is preserved, the gap is recorded, issued/draft rules hold, and scheduler/manual generation cannot bypass the review', async () => {
  const org = await newOrg();
  const stay = await seedStay(org);
  const proposed = '2026-09-05T09:30:15.123456+05:30';
  const created = await post(org.pm, '/corrections', {
    targetType: 'CHECK_IN',
    targetId: stay.checkInId,
    fieldKey: 'checkInAt',
    proposedValue: proposed,
    reason: 'Arrival was in early September',
    effectiveAt: new Date().toISOString(),
    evidenceReference: 'Check-in register, 5 Sep 2026',
  }).expect(201);
  assert.equal(created.body.financialImpact, true);
  // a manager cannot decide a financial proposal; the proposal stays pending and nothing is committed as STALE
  await post(org.pm2, `/corrections/${created.body.id}/approve`, { decisionReason: 'ok' }).expect(
    403,
  );
  assert.equal(
    (await one(`SELECT status FROM correction_proposals WHERE id = $1`, [created.body.id])).status,
    'PENDING',
  );

  const approved = await post(org.owner, `/corrections/${created.body.id}/approve`, {
    decisionReason: 'Register checked',
  }).expect(200);
  assert.equal(approved.body.status, 'APPLIED');
  const stored = await one(
    `SELECT to_char(check_in_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') t FROM check_ins WHERE id = $1`,
    [stay.checkInId],
  );
  assert.equal(stored.t, '2026-09-05T04:00:15.123456', 'microseconds survive the correction');

  // September became billable and has no invoice: a billing gap is recorded, no invoice is created
  const gaps = await db(
    `SELECT kind, outcome, to_char(period_start,'YYYY-MM') m FROM correction_finance_links WHERE organization_id = $1`,
    [org.orgId],
  );
  assert.deepEqual(
    gaps.map((g) => [g.kind, g.outcome, g.m]),
    [['BILLING_GAP', 'REVIEW_REQUIRED', '2026-09']],
  );
  assert.equal(approved.body.financeReviewStatus, 'REVIEW_REQUIRED');
  assert.equal(
    (await db(`SELECT 1 FROM invoices WHERE organization_id = $1`, [org.orgId])).length,
    0,
  );

  // the scheduler path (issue: true) and the manual path both skip the held booking-month
  for (const issue of [true, false]) {
    const gen = await post(
      org.owner,
      '/finance/invoices/generate-monthly',
      { month: '2026-09', issue },
      null,
    ).expect(201);
    assert.equal(gen.body.created, 0, `issue=${issue}`);
    assert.ok(gen.body.skippedPendingReview >= 1);
  }
  await post(
    org.owner,
    '/finance/invoices',
    { residentId: org.residentId, bookingId: stay.bookingId, month: '2026-09' },
    null,
  ).expect(409);
  assert.equal(
    (
      await db(
        `SELECT 1 FROM invoices WHERE organization_id = $1 AND to_char(period_start,'YYYY-MM') = '2026-09'`,
        [org.orgId],
      )
    ).length,
    0,
  );

  // only an independent OWNER can resolve; a manager cannot, and the requester cannot be the resolver
  const list = await server
    .get('/api/v1/corrections/finance-reviews')
    .set(org.owner.headers)
    .expect(200);
  const linkId = list.body.items[0].id;
  await post(org.pm2, `/corrections/finance-reviews/${linkId}/resolve`, {
    outcome: 'RELEASED',
    reason: 'ok',
  }).expect(403);
  await post(org.owner2, `/corrections/finance-reviews/${linkId}/resolve`, {
    outcome: 'RELEASED',
    reason: 'Owner reviewed the register',
  }).expect(200);
  await post(org.owner, `/corrections/finance-reviews/${linkId}/resolve`, {
    outcome: 'NO_SUPPORTED_REMEDY',
    reason: 'again',
  }).expect(409);

  // released: an issuing (scheduler-style) run still never auto-issues it; a non-issuing run may create a DRAFT; issue is explicit
  const issuing = await post(
    org.owner,
    '/finance/invoices/generate-monthly',
    { month: '2026-09', issue: true },
    null,
  ).expect(201);
  assert.equal(issuing.body.created, 0);
  const draftRun = await post(
    org.owner,
    '/finance/invoices/generate-monthly',
    { month: '2026-09' },
    null,
  ).expect(201);
  assert.equal(draftRun.body.created, 1);
  const draft = await one(`SELECT id, status, amount FROM invoices WHERE organization_id = $1`, [
    org.orgId,
  ]);
  assert.equal(draft.status, 'DRAFT');
  assert.equal(Number(draft.amount), 5000);
  await post(org.owner, `/finance/invoices/${draft.id}/issue`, {}, null).expect(201);
});

test('financial application is refused while the switch is off; the proposal stays pending', async () => {
  const org = await newOrg();
  const stay = await seedStay(org);
  const created = await post(org.pm, '/corrections', {
    targetType: 'BOOKING',
    targetId: stay.bookingId,
    fieldKey: 'monthlyPrice',
    proposedValue: '5500',
    reason: 'Recorded wrongly',
    effectiveAt: new Date().toISOString(),
    evidenceReference: 'Agreement register entry 42',
  }).expect(201);
  assert.equal(defaultCorrectionsConfig.financialApplyEnabled(), false, 'shipped flag stays OFF');
  financialTestApplication = false;
  try {
    const refused = await post(org.owner, `/corrections/${created.body.id}/approve`, {
      decisionReason: 'ok',
    }).expect(409);
    assert.equal(refused.body.code, 'FINANCE_CONFLICT');
  } finally {
    financialTestApplication = true;
  }
  assert.equal(
    (await one(`SELECT status FROM correction_proposals WHERE id = $1`, [created.body.id])).status,
    'PENDING',
  );
  assert.equal(
    Number(
      (await one(`SELECT monthly_price FROM bookings WHERE id = $1`, [stay.bookingId]))
        .monthly_price,
    ),
    5000,
  );
});

test('invariants: a check-in in the future, a price without evidence and a booking end that lengthens are refused', async () => {
  const org = await newOrg();
  const stay = await seedStay(org);
  const base = { reason: 'r', effectiveAt: new Date().toISOString() };
  const future = new Date(Date.now() + 5 * 86_400_000).toISOString();
  const a = await post(org.pm, '/corrections', {
    ...base,
    targetType: 'CHECK_IN',
    targetId: stay.checkInId,
    fieldKey: 'checkInAt',
    proposedValue: future,
    evidenceReference: 'e',
  }).expect(409);
  assert.equal(a.body.code, 'LIFECYCLE_CONFLICT');
  const b = await post(org.pm, '/corrections', {
    ...base,
    targetType: 'BOOKING',
    targetId: stay.bookingId,
    fieldKey: 'monthlyPrice',
    proposedValue: '6000',
  }).expect(400);
  assert.equal(b.body.code, 'INVALID_EVIDENCE');
  const c = await post(org.pm, '/corrections', {
    ...base,
    targetType: 'BOOKING',
    targetId: stay.bookingId,
    fieldKey: 'endDate',
    proposedValue: '2027-02-01',
    evidenceReference: 'e',
  }).expect(409);
  assert.equal(c.body.code, 'LIFECYCLE_CONFLICT');
  assert.equal(await proposalCount(org.orgId), 0, 'refused submissions store nothing');
});

test('price correction: draft recalculated, issued invoice untouched and flagged for review, even while a payment is recorded concurrently (no deadlock)', async () => {
  const before = await deadlocks();
  for (let round = 0; round < 4; round += 1) {
    const org = await newOrg();
    const stay = await seedStay(org);
    const issued = randomUUID();
    const draft = randomUUID();
    await withMigratorClient(async (c) => {
      await c.query(
        `INSERT INTO invoices (id, organization_id, resident_id, booking_id, number, period_start, period_end, amount, due_date, status, issued_at, updated_at) VALUES ($1,$2,$3,$4,'INV-2026-000001','2026-10-01','2026-10-31',5000,'2026-10-05','ISSUED',now(),now())`,
        [issued, org.orgId, org.residentId, stay.bookingId],
      );
      await c.query(
        `INSERT INTO invoices (id, organization_id, resident_id, booking_id, number, period_start, period_end, amount, due_date, status, updated_at) VALUES ($1,$2,$3,$4,'INV-2026-000002','2026-11-01','2026-11-30',5000,'2026-11-05','DRAFT',now())`,
        [draft, org.orgId, org.residentId, stay.bookingId],
      );
    });
    const created = await post(org.pm, '/corrections', {
      targetType: 'BOOKING',
      targetId: stay.bookingId,
      fieldKey: 'monthlyPrice',
      proposedValue: '5500',
      reason: 'Recorded wrongly',
      effectiveAt: new Date().toISOString(),
      evidenceReference: 'Agreement register entry 42',
    }).expect(201);
    const [approved, payment] = await Promise.all([
      post(org.owner, `/corrections/${created.body.id}/approve`, { decisionReason: 'ok' }),
      post(org.owner2, '/finance/payments', { invoiceId: issued, amount: 1000, method: 'CASH' }),
    ]);
    assert.equal(approved.status, 200, JSON.stringify(approved.body));
    assert.ok(payment.status === 200 || payment.status === 201, JSON.stringify(payment.body));
    const inv = await db(
      `SELECT id, amount, status FROM invoices WHERE organization_id = $1 ORDER BY number`,
      [org.orgId],
    );
    assert.equal(Number(inv[0].amount), 5000, 'the issued invoice amount is immutable');
    assert.equal(Number(inv[1].amount), 5500, 'the genuine draft was recalculated');
    const reviews = await db(
      `SELECT kind, invoice_id FROM correction_finance_links WHERE organization_id = $1 AND kind = 'INVOICE_REVIEW'`,
      [org.orgId],
    );
    assert.deepEqual(
      reviews.map((r) => r.invoice_id),
      [issued],
      'the issued invoice is flagged, not changed',
    );
  }
  assert.equal(
    (await deadlocks()) - before,
    0,
    'no deadlock between a correction and a payment on the same resident',
  );
});

test('race 9/10: a correction racing monthly generation never lets an unreviewed invoice appear for the corrected month', async () => {
  const before = await deadlocks();
  for (let round = 0; round < 6; round += 1) {
    const org = await newOrg();
    const stay = await seedStay(org);
    const created = await post(org.pm, '/corrections', {
      targetType: 'CHECK_IN',
      targetId: stay.checkInId,
      fieldKey: 'checkInAt',
      proposedValue: '2026-09-05T09:30:00+05:30',
      reason: 'Early arrival',
      effectiveAt: new Date().toISOString(),
      evidenceReference: 'Register',
    }).expect(201);
    const [approved, gen] = await Promise.all([
      post(org.owner, `/corrections/${created.body.id}/approve`, { decisionReason: 'ok' }),
      post(
        org.owner2,
        '/finance/invoices/generate-monthly',
        { month: '2026-09', issue: true },
        null,
      ),
    ]);
    assert.equal(approved.status, 200, JSON.stringify(approved.body));
    assert.equal(gen.status, 201, JSON.stringify(gen.body));
    assert.equal(
      (
        await db(
          `SELECT 1 FROM invoices WHERE organization_id = $1 AND to_char(period_start,'YYYY-MM') = '2026-09'`,
          [org.orgId],
        )
      ).length,
      0,
      `round ${round}: no September invoice`,
    );
  }
  assert.equal((await deadlocks()) - before, 0);
});

// ------------------------------------------------------------------------------- the gate under contention

test('A1: a held organization gate gives ordinary writers a clean retryable 409 within the lock timeout, never a 500, and writes nothing', async () => {
  const org = await newOrg();
  const holder = createMigratorClient();
  await holder.connect();
  try {
    await holder.query('BEGIN');
    await holder.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
      `nook:lifecycle-gate:${org.orgId}`,
    ]);
    const started = Date.now();
    const res = await post(
      org.owner,
      '/bookings',
      {
        residentId: org.residentId,
        bedId: org.bedId,
        startDate: '2027-01-01',
        endDate: '2027-02-01',
        monthlyPrice: 5000,
      },
      null,
    );
    const waited = Date.now() - started;
    assert.equal(res.status, 409, JSON.stringify(res.body));
    assert.equal(res.body.code, 'RETRY_REQUIRED');
    assert.ok(waited >= 2_500 && waited < 6_000, `waited ${waited} ms for a 3 s lock_timeout`);
    // names and checkout reasons do not take the gate: an unrelated organization and non-gated work are unaffected
    const other = await newOrg();
    await post(other.pm, '/corrections', nameBody(other)).expect(201);
  } finally {
    await holder.query('ROLLBACK');
    await holder.end();
  }
  assert.equal(
    (await db(`SELECT 1 FROM bookings WHERE organization_id = $1`, [org.orgId])).length,
    0,
  );
  // once released, the same request succeeds
  await post(
    org.owner,
    '/bookings',
    {
      residentId: org.residentId,
      bedId: org.bedId,
      startDate: '2027-01-01',
      endDate: '2027-02-01',
      monthlyPrice: 5000,
    },
    null,
  ).expect(201);
});

test('A6: a mixed concurrent workload (corrections, bookings, generation, payments, resident edits) produces no deadlock and no 5xx', async () => {
  const before = await deadlocks();
  for (let round = 0; round < 10; round += 1) {
    const org = await newOrg();
    const stay = await seedStay(org);
    const issued = randomUUID();
    await db(
      `INSERT INTO invoices (id, organization_id, resident_id, booking_id, number, period_start, period_end, amount, due_date, status, issued_at, updated_at) VALUES ($1,$2,$3,$4,'INV-2026-000001','2026-10-01','2026-10-31',5000,'2026-10-05','ISSUED',now(),now())`,
      [issued, org.orgId, org.residentId, stay.bookingId],
    );
    const price = await post(org.pm, '/corrections', {
      targetType: 'BOOKING',
      targetId: stay.bookingId,
      fieldKey: 'monthlyPrice',
      proposedValue: '5600',
      reason: 'r',
      effectiveAt: new Date().toISOString(),
      evidenceReference: 'e',
    }).expect(201);
    const name = await post(org.pm2, '/corrections', nameBody(org)).expect(201);
    const results = await Promise.all([
      post(org.owner, `/corrections/${price.body.id}/approve`, { decisionReason: 'ok' }),
      post(org.owner2, `/corrections/${name.body.id}/approve`, { decisionReason: 'ok' }),
      post(org.owner, '/finance/invoices/generate-monthly', { month: '2026-11' }, null),
      post(org.owner2, '/finance/payments', { invoiceId: issued, amount: 500, method: 'CASH' }),
      server
        .put(`/api/v1/residents/${org.residentId}`)
        .set(org.pm.headers)
        .send({ address: `Round ${round}` }),
      post(
        org.pm,
        '/bookings',
        {
          residentId: org.residentId,
          bedId: org.bedId,
          startDate: '2027-02-01',
          endDate: '2027-03-01',
          monthlyPrice: 5000,
        },
        null,
      ),
    ]);
    for (const r of results)
      assert.ok(r.status < 500, `round ${round}: ${r.status} ${JSON.stringify(r.body)}`);
  }
  assert.equal((await deadlocks()) - before, 0, 'zero deadlocks (A6)');
});

// ------------------------------------------------------- remaining correction-vs-ordinary-operation races

const priceProposal = (member: Member, bookingId: string, value = '5500') =>
  post(member, '/corrections', {
    targetType: 'BOOKING',
    targetId: bookingId,
    fieldKey: 'monthlyPrice',
    proposedValue: value,
    reason: 'Recorded wrongly',
    effectiveAt: new Date().toISOString(),
    evidenceReference: 'Agreement register entry 42',
  }).expect(201);

test('race 7: a check-in correction racing a check-out ends consistent (applied, or stale after the check-out) and never invalid', async () => {
  const before = await deadlocks();
  const outcomes = new Set<string>();
  for (let round = 0; round < 8; round += 1) {
    const org = await newOrg();
    const stay = await seedStay(org);
    const created = await post(org.pm, '/corrections', {
      targetType: 'CHECK_IN',
      targetId: stay.checkInId,
      fieldKey: 'checkInAt',
      proposedValue: '2026-09-20T10:00:00Z',
      reason: 'Early arrival',
      effectiveAt: new Date().toISOString(),
      evidenceReference: 'Register',
    }).expect(201);
    const [approve, checkout] = await Promise.all([
      post(org.owner, `/corrections/${created.body.id}/approve`, { decisionReason: 'ok' }),
      post(
        org.owner2,
        `/check-ins/${stay.checkInId}/check-out`,
        { checkOutAt: '2026-11-01T10:00:00Z' },
        null,
      ),
    ]);
    assert.equal(checkout.status, 201, JSON.stringify(checkout.body));
    assert.ok(
      approve.status === 200 || (approve.status === 409 && approve.body.code === 'STALE_SOURCE'),
      JSON.stringify(approve.body),
    );
    outcomes.add(String(approve.status));
    const row = await one(
      `SELECT c.check_in_at, o.check_out_at FROM check_ins c JOIN check_outs o ON o.check_in_id = c.id WHERE c.id = $1`,
      [stay.checkInId],
    );
    assert.ok(row.check_in_at <= row.check_out_at, 'the stay is never inverted');
    const applied = approve.status === 200;
    assert.equal(
      row.check_in_at.toISOString(),
      applied ? '2026-09-20T10:00:00.000Z' : '2026-10-01T04:00:00.000Z',
    );
    assert.equal(
      (await one(`SELECT status FROM correction_proposals WHERE id = $1`, [created.body.id]))
        .status,
      applied ? 'APPLIED' : 'STALE',
    );
  }
  assert.equal((await deadlocks()) - before, 0);
  assert.ok(outcomes.size >= 1);
});

test('race 11: a price correction racing invoice issue ends either applied-and-flagged or stale-and-untouched, never an unflagged stale issue', async () => {
  const before = await deadlocks();
  const seen = new Set<number>();
  for (let round = 0; round < 8; round += 1) {
    const org = await newOrg();
    const stay = await seedStay(org);
    const draftId = randomUUID();
    await db(
      `INSERT INTO invoices (id, organization_id, resident_id, booking_id, number, period_start, period_end, amount, due_date, status, updated_at) VALUES ($1,$2,$3,$4,'INV-2026-000002','2026-11-01','2026-11-30',5000,'2026-11-05','DRAFT',now())`,
      [draftId, org.orgId, org.residentId, stay.bookingId],
    );
    const created = await priceProposal(org.pm, stay.bookingId);
    const [approve, issue] = await Promise.all([
      post(org.owner, `/corrections/${created.body.id}/approve`, { decisionReason: 'ok' }),
      post(org.owner2, `/finance/invoices/${draftId}/issue`, {}, null),
    ]);
    seen.add(approve.status);
    assert.ok(
      approve.status === 200 || (approve.status === 409 && approve.body.code === 'STALE_SOURCE'),
      JSON.stringify(approve.body),
    );
    assert.ok(issue.status === 201 || issue.status === 409, JSON.stringify(issue.body));
    const inv = await one(`SELECT status, amount FROM invoices WHERE id = $1`, [draftId]);
    const price = Number(
      (await one(`SELECT monthly_price FROM bookings WHERE id = $1`, [stay.bookingId]))
        .monthly_price,
    );
    const flagged = (
      await db(
        `SELECT 1 FROM correction_finance_links WHERE organization_id = $1 AND kind = 'INVOICE_REVIEW' AND invoice_id = $2`,
        [org.orgId, draftId],
      )
    ).length;
    if (approve.status === 200) {
      assert.equal(price, 5500);
      if (inv.status === 'DRAFT')
        assert.equal(Number(inv.amount), 5500, 'an unissued draft follows the corrected price');
      else
        assert.ok(
          Number(inv.amount) === 5500 || flagged === 1,
          'an issued invoice at the old amount must be flagged for review',
        );
    } else {
      // The reviewer saw a draft slot that changed while they decided: nothing was applied, nothing was flagged.
      assert.equal(price, 5000);
      assert.equal(Number(inv.amount), 5000);
      assert.equal(flagged, 0);
      assert.equal(
        (await one(`SELECT status FROM correction_proposals WHERE id = $1`, [created.body.id]))
          .status,
        'STALE',
      );
    }
  }
  assert.equal((await deadlocks()) - before, 0);
  assert.ok(seen.size >= 1);
});

test('race 9: a price correction racing manual draft creation ends applied with the draft at the corrected price, or stale with nothing changed', async () => {
  const before = await deadlocks();
  for (let round = 0; round < 8; round += 1) {
    const org = await newOrg();
    const stay = await seedStay(org);
    const created = await priceProposal(org.pm, stay.bookingId);
    const [approve, draft] = await Promise.all([
      post(org.owner, `/corrections/${created.body.id}/approve`, { decisionReason: 'ok' }),
      post(
        org.owner2,
        '/finance/invoices',
        { residentId: org.residentId, bookingId: stay.bookingId, month: '2026-11' },
        null,
      ),
    ]);
    assert.equal(draft.status, 201, JSON.stringify(draft.body));
    assert.ok(
      approve.status === 200 || (approve.status === 409 && approve.body.code === 'STALE_SOURCE'),
      JSON.stringify(approve.body),
    );
    const inv = await one(
      `SELECT status, amount FROM invoices WHERE organization_id = $1 AND to_char(period_start,'YYYY-MM') = '2026-11'`,
      [org.orgId],
    );
    assert.equal(inv.status, 'DRAFT');
    const price = Number(
      (await one(`SELECT monthly_price FROM bookings WHERE id = $1`, [stay.bookingId]))
        .monthly_price,
    );
    assert.equal(Number(inv.amount), price, 'the draft always matches the booking price');
    assert.equal(price, approve.status === 200 ? 5500 : 5000);
  }
  assert.equal((await deadlocks()) - before, 0);
});

// ------------------------------------------------------------------------- races 4, 5, 6 and 8 (both winning orders)

async function addResident(org: Org, first = 'Second'): Promise<string> {
  const id = randomUUID();
  await db(
    `INSERT INTO residents (id, organization_id, first_name, last_name, updated_at) VALUES ($1,$2,$3,'Person',now())`,
    [id, org.orgId, first],
  );
  return id;
}
async function addBooking(
  org: Org,
  residentId: string,
  start: string,
  end: string,
  admitted: string | false = false,
) {
  const bookingId = randomUUID();
  await db(
    `INSERT INTO bookings (id, organization_id, resident_id, bed_id, start_date, end_date, monthly_price, updated_at) VALUES ($1,$2,$3,$4,$5,$6,5000,now())`,
    [bookingId, org.orgId, residentId, org.bedId, start, end],
  );
  let admissionId: string | null = null;
  if (admitted) {
    admissionId = randomUUID();
    await db(
      `INSERT INTO admissions (id, organization_id, booking_id, resident_id, bed_id, admission_date, status, updated_at) VALUES ($1,$2,$3,$4,$5,$6,'ADMITTED',now())`,
      [admissionId, org.orgId, bookingId, residentId, org.bedId, admitted],
    );
  }
  return { bookingId, admissionId };
}
const submit = (org: Org, body: object) => post(org.pm, '/corrections', body).expect(201);
const bookingCorrection = (org: Org, bookingId: string, fieldKey: string, value: string) =>
  submit(org, {
    targetType: 'BOOKING',
    targetId: bookingId,
    fieldKey,
    proposedValue: value,
    reason: 'Entered wrongly',
    effectiveAt: new Date().toISOString(),
    evidenceReference: 'Register',
  });
const approve = (org: Org, id: string, key: string = randomUUID()) =>
  post(
    org.owner,
    `/corrections/${id}/approve`,
    { decisionReason: 'ok', exceptionRationale: 'Verified against the register' },
    key,
  );

/** Applied: PENDING->APPLIED with exactly one applied audit and one APPROVE receipt. Conflict: untouched PENDING, no applied audit. */
async function assertProposalConsistent(
  org: Org,
  proposalId: string,
  res: { status: number; body: any },
  key: string,
) {
  const row = await one(`SELECT status FROM correction_proposals WHERE id = $1`, [proposalId]);
  const receipts = await db(
    `SELECT outcome_code FROM correction_command_receipts WHERE proposal_id = $1 AND action = 'APPROVE' AND idempotency_key = $2`,
    [proposalId, key],
  );
  const applied = await db(
    `SELECT 1 FROM audit_events WHERE organization_id = $1 AND action = 'correction.applied' AND metadata->>'proposalId' = $2`,
    [org.orgId, proposalId],
  ).catch(() => null);
  if (res.status === 200) {
    assert.equal(row.status, 'APPLIED');
    assert.equal(receipts.length, 1, 'one approve receipt');
    if (applied) assert.equal(applied.length, 1, 'one applied audit');
  } else {
    assert.equal(res.status, 409, JSON.stringify(res.body));
    assert.ok(
      ['LIFECYCLE_CONFLICT', 'STALE_SOURCE'].includes(res.body.code),
      JSON.stringify(res.body),
    );
    if (res.body.code === 'LIFECYCLE_CONFLICT') {
      assert.equal(row.status, 'PENDING', 'a lifecycle conflict leaves the proposal pending');
      assert.equal(receipts.length, 0, 'no receipt for a rolled-back decision');
    } else {
      assert.equal(row.status, 'STALE');
      assert.equal(receipts.length, 1);
    }
    if (applied) assert.equal(applied.length, 0, 'no applied audit');
  }
}
const noBedOverlap = async (bedId: string) =>
  assert.equal(
    (
      await one(
        `SELECT count(*)::int n FROM bookings a JOIN bookings b ON a.bed_id = b.bed_id AND a.id < b.id
         WHERE a.bed_id = $1 AND a.status = 'CONFIRMED' AND b.status = 'CONFIRMED'
           AND a.start_date < b.end_date AND b.start_date < a.end_date`,
        [bedId],
      )
    ).n,
    0,
    'no two confirmed bookings overlap on the bed',
  );
const noStayOverlap = async (bedId: string) =>
  assert.equal(
    (
      await one(
        `WITH s AS (SELECT c.id, c.check_in_at i, COALESCE(o.check_out_at,'infinity'::timestamptz) o FROM check_ins c LEFT JOIN check_outs o ON o.check_in_id = c.id WHERE c.bed_id = $1)
         SELECT count(*)::int n FROM s a JOIN s b ON a.id < b.id AND a.i < b.o AND b.i < a.o`,
        [bedId],
      )
    ).n,
    0,
    'no two stays overlap on the bed',
  );

/** Runs `rounds` concurrent races plus both deterministic orders; returns which outcomes were seen. */
async function bothOrders(
  name: string,
  rounds: number,
  build: () => Promise<{
    org: Org;
    proposalId: string;
    correction: () => Promise<{ status: number; body: any }>;
    ordinary: () => Promise<{ status: number; body: any }>;
    check: (c: { status: number; body: any }, o: { status: number; body: any }) => Promise<string>;
  }>,
) {
  const before = await deadlocks();
  const seen = new Map<string, number>();
  const t0 = Date.now();
  let slowest = 0;
  for (const order of ['correction-first', 'ordinary-first', ...Array(rounds).fill('concurrent')]) {
    const r = await build();
    const started = Date.now();
    let c: { status: number; body: any };
    let o: { status: number; body: any };
    if (order === 'correction-first') {
      c = await r.correction();
      o = await r.ordinary();
    } else if (order === 'ordinary-first') {
      o = await r.ordinary();
      c = await r.correction();
    } else {
      [c, o] = await Promise.all([r.correction(), r.ordinary()]);
    }
    slowest = Math.max(slowest, Date.now() - started);
    for (const res of [c, o])
      assert.ok(res.status < 500, `${name}: no 5xx: ${JSON.stringify(res.body)}`);
    const outcome = await r.check(c, o);
    seen.set(
      `${order === 'concurrent' ? 'concurrent' : order}:${outcome}`,
      (seen.get(`${order === 'concurrent' ? 'concurrent' : order}:${outcome}`) ?? 0) + 1,
    );
  }
  assert.ok(
    slowest < 20_000,
    `${name}: every round completed within bounded time (slowest ${slowest} ms)`,
  );
  assert.equal((await deadlocks()) - before, 0, `${name}: no deadlock`);
  console.log(
    `# ${name}: ${rounds + 2} rounds in ${Date.now() - t0} ms, slowest ${slowest} ms, outcomes ${JSON.stringify([...seen])}`,
  );
  return seen;
}

test('race 4: a booking start-date correction racing a booking creation never leaves two overlapping bookings (both winning orders)', async () => {
  const seen = await bothOrders('race 4', 12, async () => {
    const org = await newOrg();
    const a = await addBooking(org, org.residentId, '2026-09-01', '2027-01-01');
    const other = await addResident(org);
    const created = await bookingCorrection(org, a.bookingId, 'startDate', '2026-08-01');
    const key = randomUUID();
    return {
      org,
      proposalId: created.body.id,
      correction: () => approve(org, created.body.id, key),
      ordinary: () =>
        post(
          org.owner2,
          '/bookings',
          {
            residentId: other,
            bedId: org.bedId,
            startDate: '2026-08-10',
            endDate: '2026-08-25',
            monthlyPrice: 4000,
          },
          null,
        ),
      check: async (c, o) => {
        await assertProposalConsistent(org, created.body.id, c, key);
        await noBedOverlap(org.bedId);
        const start = (
          await one(`SELECT start_date FROM bookings WHERE id = $1`, [a.bookingId])
        ).start_date
          .toISOString()
          .slice(0, 10);
        if (c.status === 200) {
          assert.equal(o.status, 409, 'the creation lost to the applied correction');
          assert.equal(start, '2026-08-01');
          return 'correction-won';
        }
        assert.equal(c.body.code, 'LIFECYCLE_CONFLICT');
        assert.equal(o.status, 201, 'the creation won; the correction was refused');
        assert.equal(start, '2026-09-01', 'the target is untouched');
        return 'creation-won';
      },
    };
  });
  assert.ok([...seen.keys()].some((k) => k.startsWith('correction-first:correction-won')));
  assert.ok([...seen.keys()].some((k) => k.startsWith('ordinary-first:creation-won')));
});

test('race 5: a booking end-date correction racing an admission creation never leaves an admission outside its booking (both winning orders)', async () => {
  const seen = await bothOrders('race 5', 12, async () => {
    const org = await newOrg();
    const a = await addBooking(org, org.residentId, '2026-09-01', '2027-01-01');
    const created = await bookingCorrection(org, a.bookingId, 'endDate', '2026-12-01');
    const key = randomUUID();
    return {
      org,
      proposalId: created.body.id,
      correction: () => approve(org, created.body.id, key),
      ordinary: () =>
        post(
          org.owner2,
          '/admissions',
          {
            bookingId: a.bookingId,
            residentId: org.residentId,
            bedId: org.bedId,
            admissionDate: '2026-12-15',
          },
          null,
        ),
      check: async (c, o) => {
        await assertProposalConsistent(org, created.body.id, c, key);
        const end = (
          await one(`SELECT end_date FROM bookings WHERE id = $1`, [a.bookingId])
        ).end_date
          .toISOString()
          .slice(0, 10);
        const adm = await db(`SELECT admission_date FROM admissions WHERE booking_id = $1`, [
          a.bookingId,
        ]);
        if (c.status === 200) {
          assert.equal(
            o.status >= 400 && o.status < 500,
            true,
            'the admission was refused after the correction',
          );
          assert.equal(adm.length, 0);
          assert.equal(end, '2026-12-01');
          return 'correction-won';
        }
        assert.ok(
          ['LIFECYCLE_CONFLICT', 'STALE_SOURCE'].includes(c.body.code),
          JSON.stringify(c.body),
        );
        assert.equal(o.status, 201);
        assert.equal(adm.length, 1);
        assert.equal(end, '2027-01-01');
        return 'admission-won';
      },
    };
  });
  assert.ok([...seen.keys()].some((k) => k.startsWith('correction-first:correction-won')));
  assert.ok([...seen.keys()].some((k) => k.startsWith('ordinary-first:admission-won')));
});

test('race 6: an admission cancellation racing a check-in never leaves an active check-in on a cancelled admission (both winning orders)', async () => {
  const seen = await bothOrders('race 6', 12, async () => {
    const org = await newOrg();
    const a = await addBooking(org, org.residentId, '2026-09-01', '2027-01-01', '2026-09-01');
    return {
      org,
      proposalId: '',
      // "correction" slot = the admission update (cancel); "ordinary" slot = the check-in.
      correction: () =>
        server
          .put(`/api/v1/admissions/${a.admissionId}`)
          .set(org.owner.headers)
          .send({ status: 'CANCELLED' }) as any,
      ordinary: () =>
        post(
          org.owner2,
          '/check-ins',
          {
            admissionId: a.admissionId,
            residentId: org.residentId,
            bedId: org.bedId,
            bookingId: a.bookingId,
            checkInAt: '2026-10-01T04:00:00Z',
          },
          null,
        ),
      check: async (c, o) => {
        const adm = await one(`SELECT status FROM admissions WHERE id = $1`, [a.admissionId]);
        const ci = await db(`SELECT status FROM check_ins WHERE admission_id = $1`, [
          a.admissionId,
        ]);
        assert.ok(
          !(adm.status === 'CANCELLED' && ci.some((r: any) => r.status === 'ACTIVE')),
          'no active check-in on a cancelled admission',
        );
        const audits = await auditCount(org.orgId, 'checkin.created');
        assert.equal(audits, ci.length, 'one audit per persisted check-in; no partial write');
        if (o.status === 201) {
          assert.equal(ci.length, 1);
          return c.status === 200 ? 'checkin-then-cancel' : 'checkin-won';
        }
        assert.equal(ci.length, 0);
        assert.equal(adm.status, 'CANCELLED');
        assert.equal(c.status, 200);
        return 'cancel-won';
      },
    };
  });
  assert.ok([...seen.keys()].some((k) => k.startsWith('correction-first:cancel-won')));
  assert.ok([...seen.keys()].some((k) => k.startsWith('ordinary-first:checkin')));
});

test('race 8: a check-out correction racing a new stay on the same bed never leaves overlapping stays (both winning orders)', async () => {
  const seen = await bothOrders('race 8', 12, async () => {
    const org = await newOrg();
    const a = await addBooking(org, org.residentId, '2026-09-01', '2026-11-01', '2026-09-01');
    const ciId = randomUUID();
    await db(
      `INSERT INTO check_ins (id, organization_id, admission_id, resident_id, bed_id, booking_id, check_in_at, status, updated_at) VALUES ($1,$2,$3,$4,$5,$6,'2026-10-01 04:00:00+00','ACTIVE',now())`,
      [ciId, org.orgId, a.admissionId, org.residentId, org.bedId, a.bookingId],
    );
    await post(
      org.owner,
      `/check-ins/${ciId}/check-out`,
      { checkOutAt: '2026-11-01T10:00:00Z' },
      null,
    ).expect(201);
    const checkOutId = (await one(`SELECT id FROM check_outs WHERE check_in_id = $1`, [ciId])).id;
    const other = await addResident(org);
    const b = await addBooking(org, other, '2026-11-01', '2027-02-01', '2026-11-01');
    const created = await submit(org, {
      targetType: 'CHECK_OUT',
      targetId: checkOutId,
      fieldKey: 'checkOutAt',
      proposedValue: '2026-11-07T10:00:00Z',
      reason: 'Left later than recorded',
      effectiveAt: new Date().toISOString(),
      evidenceReference: 'Register',
    });
    const key = randomUUID();
    return {
      org,
      proposalId: created.body.id,
      correction: () => approve(org, created.body.id, key),
      ordinary: () =>
        post(
          org.owner2,
          '/check-ins',
          {
            admissionId: b.admissionId,
            residentId: other,
            bedId: org.bedId,
            bookingId: b.bookingId,
            checkInAt: '2026-11-05T10:00:00Z',
          },
          null,
        ),
      check: async (c, o) => {
        await assertProposalConsistent(org, created.body.id, c, key);
        await noStayOverlap(org.bedId);
        const out = (
          await one(`SELECT check_out_at FROM check_outs WHERE id = $1`, [checkOutId])
        ).check_out_at.toISOString();
        if (c.status === 200) {
          assert.equal(out, '2026-11-07T10:00:00.000Z');
          assert.ok(
            o.status >= 400 && o.status < 500,
            `the new stay was refused: ${JSON.stringify(o.body)}`,
          );
          return 'correction-won';
        }
        assert.equal(c.body.code, 'LIFECYCLE_CONFLICT');
        assert.equal(o.status, 201);
        assert.equal(out, '2026-11-01T10:00:00.000Z');
        return 'new-stay-won';
      },
    };
  });
  assert.ok([...seen.keys()].some((k) => k.startsWith('correction-first:correction-won')));
  assert.ok([...seen.keys()].some((k) => k.startsWith('ordinary-first:new-stay-won')));
});

// ---------------------------------------------------------------------------------------- A6: randomized interleavings
// Opt-in (A6_INTERLEAVINGS=1000): for each of the 15 scenarios in specification 16.3, N rounds with random launch order,
// random 0-12 ms jitter per request and a random approver. Zero deadlocks (SQLSTATE 40P01), zero 5xx, every final-state
// invariant of the scenario, and bounded completion. The seed is printed so a failing round can be replayed.

type Res = { status: number; body: any };
interface Round {
  a: () => Promise<Res>;
  b: () => Promise<Res>;
  check: (a: Res, b: Res) => Promise<string>;
}
const A6_N = Number(process.env.A6_INTERLEAVINGS ?? 0);
const A6_PARALLEL = Number(process.env.A6_PARALLEL ?? 4);
assert.ok(Number.isInteger(A6_N) && A6_N >= 0, 'A6 iteration count must be nonnegative');
assert.ok(
  Number.isInteger(A6_PARALLEL) && A6_PARALLEL >= 1 && A6_PARALLEL <= 10,
  'A6 concurrency must be 1–10',
);
if (A6_N)
  console.log(
    `# A6 seed=${process.env.A6_SEED ?? 20261108} iterationsPerPair=${A6_N} parallel=${A6_PARALLEL}`,
  );
let rngState = Number(process.env.A6_SEED ?? 20261108) >>> 0;
const rnd = () => {
  rngState = (Math.imul(rngState, 1664525) + 1013904223) >>> 0;
  return rngState / 2 ** 32;
};
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function interleave(name: string, build: () => Promise<Round>) {
  const before = await deadlocks();
  const outcomes = new Map<string, number>();
  let slowest = 0;
  let done = 0;
  const t0 = Date.now();
  const one1 = async () => {
    const round = await build();
    const order = rnd();
    const ja = Math.floor(rnd() * 13);
    const jb = Math.floor(rnd() * 13);
    const started = Date.now();
    const run = (fn: () => Promise<Res>, delay: number) => sleep(delay).then(fn);
    const [a, b] =
      order < 0.34
        ? await Promise.all([run(round.a, ja), run(round.b, jb)])
        : order < 0.67
          ? await Promise.all([run(round.a, 0), run(round.b, 8 + jb)])
          : await Promise.all([run(round.a, 8 + ja), run(round.b, 0)]);
    slowest = Math.max(slowest, Date.now() - started);
    for (const r of [a, b]) {
      assert.ok(r.status < 500, `${name}: 5xx ${r.status} ${JSON.stringify(r.body)}`);
    }
    const outcome = await round.check(a, b);
    outcomes.set(outcome, (outcomes.get(outcome) ?? 0) + 1);
    done += 1;
  };
  for (let i = 0; i < A6_N; i += A6_PARALLEL) {
    await Promise.all(Array.from({ length: Math.min(A6_PARALLEL, A6_N - i) }, one1));
  }
  const deadlockDelta = (await deadlocks()) - before;
  console.log(
    `# A6 ${name}: ${done} interleavings in ${Date.now() - t0} ms, slowest ${slowest} ms, deadlocks ${deadlockDelta}, outcomes ${JSON.stringify([...outcomes])}`,
  );
  assert.equal(done, A6_N);
  assert.equal(deadlockDelta, 0, `${name}: zero 40P01 deadlocks`);
  assert.ok(slowest < 25_000, `${name}: bounded completion (slowest ${slowest} ms)`);
}
const approver = (org: Org) => (rnd() < 0.5 ? org.owner : org.owner2);
const a6 = (title: string, fn: () => Promise<void>) =>
  test(`A6 ${title}`, { skip: A6_N === 0 }, fn);
const approveBody = { decisionReason: 'ok', exceptionRationale: 'Verified against the register' };

a6('scenario 1: same-field proposals, different keys', () =>
  interleave('scenario 1', async () => {
    const org = await newOrg();
    return {
      a: () => post(org.pm, '/corrections', nameBody(org, { proposedValue: 'Aarav' })),
      b: () => post(org.pm2, '/corrections', nameBody(org, { proposedValue: 'Arav' })),
      check: async (a, b) => {
        assert.deepEqual([a.status, b.status].sort(), [201, 409]);
        assert.equal((a.status === 409 ? a : b).body.code, 'PENDING_CONFLICT');
        assert.equal(await proposalCount(org.orgId), 1);
        assert.equal(await auditCount(org.orgId, 'correction.submitted'), 1);
        assert.equal(
          (
            await one(
              `SELECT count(*)::int n FROM correction_command_receipts WHERE organization_id = $1`,
              [org.orgId],
            )
          ).n,
          1,
        );
        return a.status === 201 ? 'first-won' : 'second-won';
      },
    };
  }),
);

a6('scenario 2: different-field proposals, one resident', () =>
  interleave('scenario 2', async () => {
    const org = await newOrg();
    return {
      a: () => post(org.pm, '/corrections', nameBody(org)),
      b: () =>
        post(
          org.pm2,
          '/corrections',
          nameBody(org, { fieldKey: 'lastName', proposedValue: 'Shaw' }),
        ),
      check: async (a, b) => {
        assert.deepEqual([a.status, b.status], [201, 201]);
        assert.equal(await proposalCount(org.orgId, 'PENDING'), 2);
        return 'both-persisted';
      },
    };
  }),
);

a6('scenario 3: independent name approvals', () =>
  interleave('scenario 3', async () => {
    const org = await newOrg();
    const first = await post(org.pm, '/corrections', nameBody(org)).expect(201);
    const last = await post(
      org.pm2,
      '/corrections',
      nameBody(org, { fieldKey: 'lastName', proposedValue: 'Shaw' }),
    ).expect(201);
    return {
      a: () => post(org.owner, `/corrections/${first.body.id}/approve`, { decisionReason: 'ok' }),
      b: () => post(org.owner2, `/corrections/${last.body.id}/approve`, { decisionReason: 'ok' }),
      check: async (a, b) => {
        assert.deepEqual([a.status, b.status], [200, 200]);
        const n = await residentName(org.residentId);
        assert.deepEqual([n.first_name, n.last_name], ['Aarav', 'Shaw']);
        return 'both-applied';
      },
    };
  }),
);

const stayRound = (name: string, orderKey: 'booking' | 'admission' | 'cancel' | 'checkout') =>
  a6(`scenario ${name}`, async () => {
    await interleave(`scenario ${name}`, async () => {
      const org = await newOrg();
      if (orderKey === 'booking') {
        const a = await addBooking(org, org.residentId, '2026-09-01', '2027-01-01');
        const other = await addResident(org);
        const created = await bookingCorrection(org, a.bookingId, 'startDate', '2026-08-01');
        const key = randomUUID();
        return {
          a: () => approve(org, created.body.id, key),
          b: () =>
            post(
              org.owner2,
              '/bookings',
              {
                residentId: other,
                bedId: org.bedId,
                startDate: '2026-08-10',
                endDate: '2026-08-25',
                monthlyPrice: 4000,
              },
              null,
            ),
          check: async (c, o) => {
            await assertProposalConsistent(org, created.body.id, c, key);
            await noBedOverlap(org.bedId);
            assert.equal(c.status === 200, o.status === 409, 'exactly one of the two wins');
            return c.status === 200 ? 'correction-won' : 'creation-won';
          },
        };
      }
      if (orderKey === 'admission') {
        const a = await addBooking(org, org.residentId, '2026-09-01', '2027-01-01');
        const created = await bookingCorrection(org, a.bookingId, 'endDate', '2026-12-01');
        const key = randomUUID();
        return {
          a: () => approve(org, created.body.id, key),
          b: () =>
            post(
              org.owner2,
              '/admissions',
              {
                bookingId: a.bookingId,
                residentId: org.residentId,
                bedId: org.bedId,
                admissionDate: '2026-12-15',
              },
              null,
            ),
          check: async (c, o) => {
            await assertProposalConsistent(org, created.body.id, c, key);
            const adm = await db(`SELECT 1 FROM admissions WHERE booking_id = $1`, [a.bookingId]);
            const end = (
              await one(`SELECT end_date FROM bookings WHERE id = $1`, [a.bookingId])
            ).end_date
              .toISOString()
              .slice(0, 10);
            assert.ok(
              !(end === '2026-12-01' && adm.length === 1),
              'no admission outside its booking',
            );
            assert.equal(c.status === 200, o.status >= 400, 'exactly one of the two wins');
            return c.status === 200 ? 'correction-won' : 'admission-won';
          },
        };
      }
      if (orderKey === 'cancel') {
        const a = await addBooking(org, org.residentId, '2026-09-01', '2027-01-01', '2026-09-01');
        return {
          a: () =>
            server
              .put(`/api/v1/admissions/${a.admissionId}`)
              .set(org.owner.headers)
              .send({ status: 'CANCELLED' }) as any,
          b: () =>
            post(
              org.owner2,
              '/check-ins',
              {
                admissionId: a.admissionId,
                residentId: org.residentId,
                bedId: org.bedId,
                bookingId: a.bookingId,
                checkInAt: '2026-10-01T04:00:00Z',
              },
              null,
            ),
          check: async (c, o) => {
            const adm = await one(`SELECT status FROM admissions WHERE id = $1`, [a.admissionId]);
            const ci = await db(`SELECT status FROM check_ins WHERE admission_id = $1`, [
              a.admissionId,
            ]);
            assert.ok(!(adm.status === 'CANCELLED' && ci.some((r: any) => r.status === 'ACTIVE')));
            assert.equal(await auditCount(org.orgId, 'checkin.created'), ci.length);
            assert.equal(o.status === 201, ci.length === 1);
            return o.status === 201
              ? c.status === 200
                ? 'checkin-then-cancel'
                : 'checkin-won'
              : 'cancel-won';
          },
        };
      }
      const a = await addBooking(org, org.residentId, '2026-09-01', '2026-11-01', '2026-09-01');
      const ciId = randomUUID();
      await db(
        `INSERT INTO check_ins (id, organization_id, admission_id, resident_id, bed_id, booking_id, check_in_at, status, updated_at) VALUES ($1,$2,$3,$4,$5,$6,'2026-10-01 04:00:00+00','ACTIVE',now())`,
        [ciId, org.orgId, a.admissionId, org.residentId, org.bedId, a.bookingId],
      );
      await post(
        org.owner,
        `/check-ins/${ciId}/check-out`,
        { checkOutAt: '2026-11-01T10:00:00Z' },
        null,
      ).expect(201);
      const checkOutId = (await one(`SELECT id FROM check_outs WHERE check_in_id = $1`, [ciId])).id;
      const other = await addResident(org);
      const b = await addBooking(org, other, '2026-11-01', '2027-02-01', '2026-11-01');
      const created = await submit(org, {
        targetType: 'CHECK_OUT',
        targetId: checkOutId,
        fieldKey: 'checkOutAt',
        proposedValue: '2026-11-07T10:00:00Z',
        reason: 'Left later than recorded',
        effectiveAt: new Date().toISOString(),
        evidenceReference: 'Register',
      });
      const key = randomUUID();
      return {
        a: () => approve(org, created.body.id, key),
        b: () =>
          post(
            org.owner2,
            '/check-ins',
            {
              admissionId: b.admissionId,
              residentId: other,
              bedId: org.bedId,
              bookingId: b.bookingId,
              checkInAt: '2026-11-05T10:00:00Z',
            },
            null,
          ),
        check: async (c, o) => {
          await assertProposalConsistent(org, created.body.id, c, key);
          await noStayOverlap(org.bedId);
          assert.equal(c.status === 200, o.status >= 400, 'exactly one of the two wins');
          return c.status === 200 ? 'correction-won' : 'new-stay-won';
        },
      };
    });
  });
stayRound('4: booking correction vs new booking', 'booking');
stayRound('5: booking correction vs admission creation', 'admission');
stayRound('6: admission update vs check-in', 'cancel');
stayRound('8: check-out correction vs new stay', 'checkout');

a6('scenario 7: check-in correction vs check-out', () =>
  interleave('scenario 7', async () => {
    const org = await newOrg();
    const stay = await seedStay(org);
    const created = await submit(org, {
      targetType: 'CHECK_IN',
      targetId: stay.checkInId,
      fieldKey: 'checkInAt',
      proposedValue: '2026-09-20T10:00:00Z',
      reason: 'Early arrival',
      effectiveAt: new Date().toISOString(),
      evidenceReference: 'Register',
    });
    return {
      a: () => post(approver(org), `/corrections/${created.body.id}/approve`, approveBody),
      b: () =>
        post(
          org.owner2,
          `/check-ins/${stay.checkInId}/check-out`,
          { checkOutAt: '2026-11-01T10:00:00Z' },
          null,
        ),
      check: async (a, b) => {
        assert.equal(b.status, 201, JSON.stringify(b.body));
        assert.ok(
          a.status === 200 || (a.status === 409 && a.body.code === 'STALE_SOURCE'),
          JSON.stringify(a.body),
        );
        const row = await one(
          `SELECT c.check_in_at, o.check_out_at FROM check_ins c JOIN check_outs o ON o.check_in_id = c.id WHERE c.id = $1`,
          [stay.checkInId],
        );
        assert.ok(row.check_in_at <= row.check_out_at);
        assert.equal(
          row.check_in_at.toISOString(),
          a.status === 200 ? '2026-09-20T10:00:00.000Z' : '2026-10-01T04:00:00.000Z',
        );
        return a.status === 200 ? 'applied' : 'stale';
      },
    };
  }),
);

const draftSql = `INSERT INTO invoices (id, organization_id, resident_id, booking_id, number, period_start, period_end, amount, due_date, status, updated_at) VALUES ($1,$2,$3,$4,'INV-2026-000002','2026-11-01','2026-11-30',5000,'2026-11-05','DRAFT',now())`;

a6('scenario 9: price correction vs createDraft', () =>
  interleave('scenario 9', async () => {
    const org = await newOrg();
    const stay = await seedStay(org);
    const created = await priceProposal(org.pm, stay.bookingId);
    return {
      a: () =>
        post(approver(org), `/corrections/${created.body.id}/approve`, { decisionReason: 'ok' }),
      b: () =>
        post(
          org.owner2,
          '/finance/invoices',
          { residentId: org.residentId, bookingId: stay.bookingId, month: '2026-11' },
          null,
        ),
      check: async (a, b) => {
        assert.equal(b.status, 201, JSON.stringify(b.body));
        assert.ok(
          a.status === 200 || (a.status === 409 && a.body.code === 'STALE_SOURCE'),
          JSON.stringify(a.body),
        );
        const inv = await one(
          `SELECT status, amount FROM invoices WHERE organization_id = $1 AND to_char(period_start,'YYYY-MM') = '2026-11'`,
          [org.orgId],
        );
        const price = Number(
          (await one(`SELECT monthly_price FROM bookings WHERE id = $1`, [stay.bookingId]))
            .monthly_price,
        );
        assert.equal(inv.status, 'DRAFT');
        assert.equal(Number(inv.amount), price, 'the draft always matches the booking price');
        return a.status === 200 ? 'applied' : 'stale';
      },
    };
  }),
);

a6('scenario 10: check-in correction vs monthly generation (billing gap)', () =>
  interleave('scenario 10', async () => {
    const org = await newOrg();
    const stay = await seedStay(org);
    const created = await submit(org, {
      targetType: 'CHECK_IN',
      targetId: stay.checkInId,
      fieldKey: 'checkInAt',
      proposedValue: '2026-09-05T09:30:00+05:30',
      reason: 'Early arrival',
      effectiveAt: new Date().toISOString(),
      evidenceReference: 'Register',
    });
    return {
      a: () => post(approver(org), `/corrections/${created.body.id}/approve`, approveBody),
      b: () =>
        post(
          org.owner2,
          '/finance/invoices/generate-monthly',
          { month: '2026-09', issue: true },
          null,
        ),
      check: async (a, b) => {
        assert.equal(b.status, 201, JSON.stringify(b.body));
        assert.equal(a.status, 200, JSON.stringify(a.body));
        assert.equal(
          (
            await db(
              `SELECT 1 FROM invoices WHERE organization_id = $1 AND to_char(period_start,'YYYY-MM') = '2026-09'`,
              [org.orgId],
            )
          ).length,
          0,
          'no unreviewed September invoice',
        );
        return 'gap-held';
      },
    };
  }),
);

a6('scenario 11: price correction vs invoice issue', () =>
  interleave('scenario 11', async () => {
    const org = await newOrg();
    const stay = await seedStay(org);
    const draftId = randomUUID();
    await db(draftSql, [draftId, org.orgId, org.residentId, stay.bookingId]);
    const created = await priceProposal(org.pm, stay.bookingId);
    return {
      a: () =>
        post(approver(org), `/corrections/${created.body.id}/approve`, { decisionReason: 'ok' }),
      b: () => post(org.owner2, `/finance/invoices/${draftId}/issue`, {}, null),
      check: async (a, b) => {
        assert.ok(
          a.status === 200 || (a.status === 409 && a.body.code === 'STALE_SOURCE'),
          JSON.stringify(a.body),
        );
        assert.ok(b.status === 201 || b.status === 409, JSON.stringify(b.body));
        const inv = await one(`SELECT status, amount FROM invoices WHERE id = $1`, [draftId]);
        const flagged = (
          await db(
            `SELECT 1 FROM correction_finance_links WHERE organization_id = $1 AND kind = 'INVOICE_REVIEW' AND invoice_id = $2`,
            [org.orgId, draftId],
          )
        ).length;
        if (a.status === 200) {
          if (inv.status === 'DRAFT') assert.equal(Number(inv.amount), 5500);
          else
            assert.ok(
              Number(inv.amount) === 5500 || flagged === 1,
              'issued at the old amount must be flagged',
            );
          return inv.status === 'DRAFT' ? 'applied-draft' : 'applied-issued-flagged';
        }
        assert.equal(Number(inv.amount), 5000);
        assert.equal(flagged, 0);
        return 'stale';
      },
    };
  }),
);

a6('scenario 12: price correction vs payment (Resident-Invoice lock order)', () =>
  interleave('scenario 12', async () => {
    const org = await newOrg();
    const stay = await seedStay(org);
    const issued = randomUUID();
    await db(
      `INSERT INTO invoices (id, organization_id, resident_id, booking_id, number, period_start, period_end, amount, due_date, status, issued_at, updated_at) VALUES ($1,$2,$3,$4,'INV-2026-000001','2026-10-01','2026-10-31',5000,'2026-10-05','ISSUED',now(),now())`,
      [issued, org.orgId, org.residentId, stay.bookingId],
    );
    const created = await priceProposal(org.pm, stay.bookingId);
    return {
      a: () =>
        post(approver(org), `/corrections/${created.body.id}/approve`, { decisionReason: 'ok' }),
      b: () =>
        post(
          org.owner2,
          '/finance/payments',
          { invoiceId: issued, amount: 1000, method: 'CASH' },
          randomUUID(),
        ),
      check: async (a, b) => {
        assert.ok(b.status === 200 || b.status === 201, JSON.stringify(b.body));
        assert.ok(
          a.status === 200 || (a.status === 409 && a.body.code === 'STALE_SOURCE'),
          JSON.stringify(a.body),
        );
        const inv = await one(`SELECT amount FROM invoices WHERE id = $1`, [issued]);
        assert.equal(Number(inv.amount), 5000, 'the issued invoice amount is never rewritten');
        assert.equal(
          Number(
            (await one(`SELECT count(*)::int n FROM payments WHERE invoice_id = $1`, [issued])).n,
          ),
          1,
        );
        return a.status === 200 ? 'applied' : 'stale';
      },
    };
  }),
);

a6('scenario 13: approve vs reject', () =>
  interleave('scenario 13', async () => {
    const org = await newOrg();
    const created = await post(org.pm, '/corrections', nameBody(org)).expect(201);
    return {
      a: () => post(org.owner, `/corrections/${created.body.id}/approve`, { decisionReason: 'ok' }),
      b: () => post(org.owner2, `/corrections/${created.body.id}/reject`, { reason: 'no' }),
      check: async (a, b) => {
        assert.deepEqual([a.status, b.status].sort(), [200, 409]);
        const row = await one(`SELECT status FROM correction_proposals WHERE id = $1`, [
          created.body.id,
        ]);
        const name = (await residentName(org.residentId)).first_name;
        assert.equal(row.status, a.status === 200 ? 'APPLIED' : 'REJECTED');
        assert.equal(name, a.status === 200 ? 'Aarav' : 'Arahv');
        return a.status === 200 ? 'approve-won' : 'reject-won';
      },
    };
  }),
);

a6('scenario 14: approve vs withdraw', () =>
  interleave('scenario 14', async () => {
    const org = await newOrg();
    const created = await post(org.pm, '/corrections', nameBody(org)).expect(201);
    return {
      a: () => post(org.owner, `/corrections/${created.body.id}/approve`, { decisionReason: 'ok' }),
      b: () => post(org.pm, `/corrections/${created.body.id}/withdraw`, { reason: 'mistake' }),
      check: async (a, b) => {
        assert.deepEqual([a.status, b.status].sort(), [200, 409]);
        const row = await one(`SELECT status FROM correction_proposals WHERE id = $1`, [
          created.body.id,
        ]);
        assert.equal(row.status, a.status === 200 ? 'APPLIED' : 'WITHDRAWN');
        return a.status === 200 ? 'approve-won' : 'withdraw-won';
      },
    };
  }),
);

a6('scenario 15: duplicate same-key approvals / lost response', () =>
  interleave('scenario 15', async () => {
    const org = await newOrg();
    const created = await post(org.pm, '/corrections', nameBody(org)).expect(201);
    const key = randomUUID();
    const go = () =>
      post(org.owner, `/corrections/${created.body.id}/approve`, { decisionReason: 'ok' }, key);
    return {
      a: go,
      b: go,
      check: async (a, b) => {
        assert.deepEqual([a.status, b.status], [200, 200], JSON.stringify([a.body, b.body]));
        assert.equal(
          [a.body, b.body].filter((x) => x.idempotentReplay).length,
          1,
          'exactly one replay',
        );
        assert.equal(await auditCount(org.orgId, 'correction.applied'), 1);
        const retry = await go();
        assert.equal(retry.status, 200);
        assert.equal(retry.body.idempotentReplay, true, 'a later retry is a replay');
        assert.equal(
          await auditCount(org.orgId, 'correction.applied'),
          1,
          'no duplicate application',
        );
        return 'applied-once';
      },
    };
  }),
);

// -------------------------------------------------------------------------- security and finance review (executed)

test('security: a client can never set the financial classification, approver identity, tenant or status', async () => {
  const org = await newOrg();
  const other = await newOrg();
  for (const extra of [
    { financialImpact: false },
    { financialImpact: true },
    { organizationId: other.orgId },
    { requestedBy: other.pm.userId },
    { requestedRole: 'OWNER' },
    { decidedBy: org.owner.userId },
    { status: 'APPLIED' },
    { originalValue: 'forged' },
    { correlationId: randomUUID() },
  ]) {
    const res = await post(org.pm, '/corrections', nameBody(org, extra)).expect(400);
    assert.equal(res.body.code, 'UNKNOWN_FIELD', JSON.stringify(extra));
  }
  assert.equal(await proposalCount(org.orgId), 0, 'nothing was written by a refused request');
  // The classification is computed on the server from the field: a price is financial, a name is not.
  const stay = await seedStay(org);
  const price = await priceProposal(org.pm, stay.bookingId);
  const name = await post(org.pm, '/corrections', nameBody(org)).expect(201);
  const rows = await db(
    `SELECT id, financial_impact, requested_by, requested_role, organization_id FROM correction_proposals WHERE organization_id = $1`,
    [org.orgId],
  );
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.equal(byId[price.body.id].financial_impact, true);
  assert.equal(byId[name.body.id].financial_impact, false);
  for (const r of rows) {
    assert.equal(r.requested_by, org.pm.userId, 'the requester is the session user');
    assert.equal(r.requested_role, 'PROPERTY_MANAGER');
    assert.equal(r.organization_id, org.orgId, 'the tenant is the session tenant');
  }
  for (const extra of [
    { approverId: org.owner2.userId },
    { decidedBy: org.owner2.userId },
    { organizationId: other.orgId },
    { financialImpact: false },
  ]) {
    const res = await post(org.owner, `/corrections/${name.body.id}/approve`, {
      decisionReason: 'ok',
      ...extra,
    }).expect(400);
    assert.equal(res.body.code, 'UNKNOWN_FIELD');
  }
  // A foreign tenant's session cannot reach this organization's records, and an organization id in the URL or query is ignored.
  await server.get(`/api/v1/corrections/${name.body.id}`).set(other.owner.headers).expect(404);
  const foreign = await server
    .get(`/api/v1/corrections?organizationId=${org.orgId}`)
    .set(other.owner.headers);
  assert.ok([200, 400].includes(foreign.status));
  if (foreign.status === 200) assert.equal(foreign.body.total, 0);
  await post(other.owner, `/corrections/${name.body.id}/approve`, { decisionReason: 'ok' }).expect(
    404,
  );
  assert.equal(
    (await one(`SELECT status FROM correction_proposals WHERE id = $1`, [name.body.id])).status,
    'PENDING',
  );
});

test('finance: applying a price correction never rewrites an issued or paid invoice, and the scheduler, manual run and createDraft all stop at an unresolved billing gap', async () => {
  const org = await newOrg();
  const stay = await seedStay(org);
  const issued = randomUUID();
  const paid = randomUUID();
  await db(
    `INSERT INTO invoices (id, organization_id, resident_id, booking_id, number, period_start, period_end, amount, due_date, status, issued_at, updated_at) VALUES ($1,$2,$3,$4,'INV-2026-000001','2026-10-01','2026-10-31',5000,'2026-10-05','ISSUED',now(),now())`,
    [issued, org.orgId, org.residentId, stay.bookingId],
  );
  await db(
    `INSERT INTO invoices (id, organization_id, resident_id, booking_id, number, period_start, period_end, amount, due_date, status, issued_at, paid_amount, updated_at) VALUES ($1,$2,$3,$4,'INV-2026-000002','2026-09-01','2026-09-30',5000,'2026-09-05','PAID',now(),5000,now())`,
    [paid, org.orgId, org.residentId, stay.bookingId],
  );
  const snapshot = async () =>
    db(`SELECT * FROM invoices WHERE id = ANY($1) ORDER BY number`, [[issued, paid]]);
  const before = JSON.stringify(await snapshot());
  const created = await priceProposal(org.pm, stay.bookingId, '5900');
  await approve(org, created.body.id).expect(200);
  assert.equal(
    JSON.stringify(await snapshot()),
    before,
    'issued and paid invoices are byte-for-byte unchanged',
  );

  // Billing gap: an earlier check-in creates a billable September that has no invoice yet.
  const gapOrg = await newOrg();
  const gapStay = await seedStay(gapOrg);
  const gap = await submit(gapOrg, {
    targetType: 'CHECK_IN',
    targetId: gapStay.checkInId,
    fieldKey: 'checkInAt',
    proposedValue: '2026-09-05T09:30:00+05:30',
    reason: 'Early arrival',
    effectiveAt: new Date().toISOString(),
    evidenceReference: 'Register',
  });
  const applied = await approve(gapOrg, gap.body.id).expect(200);
  assert.equal(applied.body.financeReviewStatus, 'REVIEW_REQUIRED');
  const scheduler = schedulerApp.get(InvoiceSchedulerService);
  const run = await scheduler.run({
    organizationIds: [gapOrg.orgId],
    now: new Date('2026-10-05T04:00:00Z'),
    lookbackMonths: 1,
    backoffMs: 1,
  });
  assert.equal(run.failed, 0);
  const septemberRun = run.results.filter((r: { month: string }) => r.month === '2026-09');
  assert.ok(septemberRun.length >= 1);
  assert.ok(
    septemberRun.every((r: { created?: number }) => (r.created ?? 0) === 0),
    'the scheduler created nothing for the held month',
  );
  assert.ok(
    septemberRun.some((r: { skippedPendingReview?: number }) => (r.skippedPendingReview ?? 0) >= 1),
    'the scheduler reported the hold',
  );
  const sept = () =>
    db(
      `SELECT 1 FROM invoices WHERE organization_id = $1 AND to_char(period_start,'YYYY-MM') = '2026-09'`,
      [gapOrg.orgId],
    );
  assert.equal((await sept()).length, 0);
  const manual = await post(
    gapOrg.owner,
    '/finance/invoices/generate-monthly',
    { month: '2026-09', issue: true },
    null,
  ).expect(201);
  assert.equal(manual.body.created, 0);
  await post(
    gapOrg.owner,
    '/finance/invoices',
    { residentId: gapOrg.residentId, bookingId: gapStay.bookingId, month: '2026-09' },
    null,
  ).expect(409);
  assert.equal((await sept()).length, 0, 'no invoice by any of the three paths');
});

test('finance: a billing review is resolved only by an independent OWNER, once, append-only', async () => {
  const org = await newOrg();
  const stay = await seedStay(org);
  // The OWNER requests the correction, so the requester is an owner and a different owner must decide and resolve.
  const created = await post(org.owner, '/corrections', {
    targetType: 'CHECK_IN',
    targetId: stay.checkInId,
    fieldKey: 'checkInAt',
    proposedValue: '2026-09-05T09:30:00+05:30',
    reason: 'Early arrival',
    effectiveAt: new Date().toISOString(),
    evidenceReference: 'Register',
  }).expect(201);
  await post(org.owner2, `/corrections/${created.body.id}/approve`, approveBody).expect(200);
  const links = await server
    .get('/api/v1/corrections/finance-reviews')
    .set(org.owner2.headers)
    .expect(200);
  const linkId = links.body.items[0].id;
  const resolve = (
    member: Member,
    body: object = { outcome: 'RELEASED', reason: 'Reviewed with the register' },
  ) => post(member, `/corrections/finance-reviews/${linkId}/resolve`, body);
  assert.equal((await resolve(org.pm)).status, 403, 'a manager cannot resolve');
  assert.equal((await resolve(org.pm2)).status, 403);
  const own = await resolve(org.owner);
  assert.equal(own.status, 403, 'the requester cannot resolve their own correction');
  assert.equal(own.body.code, 'SELF_REVIEW');
  assert.equal(
    (await resolve(org.owner2, { outcome: 'RELEASED', reason: 'x', resolvedBy: org.owner.userId }))
      .status,
    400,
    'the resolver identity cannot be supplied',
  );
  const open = await db(
    `SELECT 1 FROM correction_finance_links WHERE kind = 'RESOLUTION' AND organization_id = $1`,
    [org.orgId],
  );
  assert.equal(open.length, 0, 'nothing resolved by any refused attempt');
  await resolve(org.owner2).then((r) => assert.equal(r.status, 200, JSON.stringify(r.body)));
  const row = await one(
    `SELECT resolved_by, outcome FROM correction_finance_links WHERE kind = 'RESOLUTION' AND organization_id = $1`,
    [org.orgId],
  );
  assert.equal(row.resolved_by, org.owner2.userId, 'the resolver is the session owner');
  assert.equal((await resolve(org.owner2)).status, 409, 'a review resolves exactly once');
  await assert.rejects(
    db(`UPDATE correction_finance_links SET reason = 'x' WHERE organization_id = $1`, [org.orgId]),
    /append-only/,
  );
  await assert.rejects(
    db(`DELETE FROM correction_finance_links WHERE organization_id = $1`, [org.orgId]),
    /append-only/,
  );
});

test('idempotency: a response lost to a dropped connection is resolved by the same key and applies exactly once', async () => {
  const org = await newOrg();
  const created = await post(org.pm, '/corrections', nameBody(org)).expect(201);
  const key = randomUUID();
  const port = app.getHttpServer().address().port;
  // Send the approval and destroy the socket before any response is read: the client cannot know whether it was applied.
  const approveBody = { decisionReason: 'ok', exceptionRationale: 'Verified against the register' };
  await new Promise<void>((resolve) => {
    const body = JSON.stringify(approveBody);
    const req = http.request({
      host: '127.0.0.1',
      port,
      path: `/api/v1/corrections/${created.body.id}/approve`,
      method: 'POST',
      headers: {
        ...org.owner.headers,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Idempotency-Key': key,
      },
    });
    req.on('error', () => undefined);
    req.write(body);
    req.end();
    setTimeout(() => {
      req.destroy();
      resolve();
    }, 5);
  });
  // The retry with the same key returns the recorded result whether or not the first request reached the server.
  let retry = await approve(org, created.body.id, key);
  for (let i = 0; i < 20 && retry.status === 409 && retry.body.code === 'RETRY_REQUIRED'; i += 1) {
    await sleep(100);
    retry = await approve(org, created.body.id, key);
  }
  assert.equal(retry.status, 200, JSON.stringify(retry.body));
  assert.equal(await auditCount(org.orgId, 'correction.applied'), 1);
  assert.equal(
    (
      await db(
        `SELECT 1 FROM correction_command_receipts WHERE proposal_id = $1 AND action = 'APPROVE'`,
        [created.body.id],
      )
    ).length,
    1,
  );
  assert.equal((await residentName(org.residentId)).first_name, 'Aarav');
  const again = await approve(org, created.body.id, key);
  assert.equal(again.status, 200);
  assert.equal(again.body.idempotentReplay, true);
  assert.equal(await auditCount(org.orgId, 'correction.applied'), 1, 'no duplicate application');
});

// Section 16.3 pair 12 includes each settlement operation, not payment alone.
for (const operation of ['reversal', 'credit', 'void'] as const) {
  a6(`scenario 12-${operation}: price correction vs ${operation}`, () =>
    interleave(`scenario 12-${operation}`, async () => {
      const org = await newOrg();
      const stay = await seedStay(org);
      const invoiceId = randomUUID();
      await db(
        `INSERT INTO invoices (id, organization_id, resident_id, booking_id, number, period_start, period_end, amount, due_date, status, issued_at, updated_at)
        VALUES ($1,$2,$3,$4,'INV-2026-000001','2026-10-01','2026-10-31',5000,'2026-10-05','ISSUED',now(),now())`,
        [invoiceId, org.orgId, org.residentId, stay.bookingId],
      );
      let paymentId: string | undefined;
      if (operation === 'reversal') {
        const paid = await post(org.owner2, '/finance/payments', {
          invoiceId,
          amount: 1000,
          method: 'CASH',
        });
        assert.ok([200, 201].includes(paid.status), JSON.stringify(paid.body));
        paymentId = paid.body.payment.id;
      }
      const created = await priceProposal(org.pm, stay.bookingId);
      const route =
        operation === 'reversal'
          ? `/finance/payments/${paymentId}/reverse`
          : `/finance/invoices/${invoiceId}/${operation === 'credit' ? 'adjustments' : 'void'}`;
      return {
        a: () =>
          post(approver(org), `/corrections/${created.body.id}/approve`, {
            decisionReason: 'Verified price',
          }),
        b: () =>
          post(
            org.owner2,
            route,
            {
              reason: 'Independent settlement operation',
              ...(operation === 'credit' ? { amount: '-100' } : {}),
            },
            null,
          ),
        check: async (a, b) => {
          assert.ok([200, 201].includes(b.status), JSON.stringify(b.body));
          assert.ok(
            a.status === 200 || (a.status === 409 && a.body.code === 'STALE_SOURCE'),
            JSON.stringify(a.body),
          );
          const invoice = await one(
            'SELECT amount, paid_amount, adjustment_total, status FROM invoices WHERE id=$1',
            [invoiceId],
          );
          assert.equal(Number(invoice.amount), 5000, 'issued amount is immutable');
          const table = {
            reversal: 'payment_reversals',
            credit: 'invoice_adjustments',
            void: 'invoice_voids',
          }[operation];
          assert.equal(
            (await one(`SELECT count(*)::int n FROM ${table} WHERE invoice_id=$1`, [invoiceId])).n,
            1,
          );
          assert.equal(Number(invoice.paid_amount), operation === 'credit' ? 100 : 0);
          assert.equal(Number(invoice.adjustment_total), operation === 'credit' ? -100 : 0);
          assert.equal(invoice.status === 'CANCELLED', operation === 'void');
          assert.equal(await auditCount(org.orgId, 'correction.applied'), a.status === 200 ? 1 : 0);
          assert.equal(
            (
              await one(
                "SELECT count(*)::int n FROM correction_command_receipts WHERE proposal_id=$1 AND action='APPROVE'",
                [created.body.id],
              )
            ).n,
            1,
          );
          return a.status === 200 ? 'applied' : 'stale';
        },
      };
    }),
  );
}

a6('scenario 10-scheduler: check-in correction vs real scheduler with a billing gap', () =>
  interleave('scenario 10-scheduler', async () => {
    const org = await newOrg();
    const stay = await seedStay(org);
    const created = await submit(org, {
      targetType: 'CHECK_IN',
      targetId: stay.checkInId,
      fieldKey: 'checkInAt',
      proposedValue: '2026-09-05T09:30:00+05:30',
      reason: 'Register correction',
      effectiveAt: new Date().toISOString(),
      evidenceReference: 'Register',
    });
    return {
      a: () => post(approver(org), `/corrections/${created.body.id}/approve`, approveBody),
      b: async () => {
        const result = await schedulerApp.get(InvoiceSchedulerService).run({
          organizationIds: [org.orgId],
          now: new Date('2026-10-05T04:00:00Z'),
          lookbackMonths: 1,
          maxAttempts: 1,
        });
        return { status: result.failed ? 500 : 200, body: result };
      },
      check: async (a, b) => {
        assert.equal(a.status, 200, JSON.stringify(a.body));
        assert.equal(b.status, 200, JSON.stringify(b.body));
        assert.equal(
          (
            await one(
              "SELECT count(*)::int n FROM invoices WHERE organization_id=$1 AND period_start='2026-09-01'",
              [org.orgId],
            )
          ).n,
          0,
        );
        assert.equal(
          (
            await one(
              "SELECT count(*)::int n FROM correction_finance_links WHERE proposal_id=$1 AND kind='BILLING_GAP' AND period_start='2026-09-01'",
              [created.body.id],
            )
          ).n,
          1,
        );
        assert.equal(await auditCount(org.orgId, 'correction.applied'), 1);
        return 'gap-suppressed';
      },
    };
  }),
);
