import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import {
  Controller,
  Module,
  UseGuards,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  Req,
  INestApplication,
  NotFoundException,
  Inject,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import request from 'supertest';
import { SessionGuard, RoleGuard } from '../src/auth/auth.guards.js';
import { SessionService } from '../src/auth/session.service.js';
import type { AuthenticatedContext } from '../src/auth/auth.types.js';
import { ResidentHistoryService } from '../src/resident-history/resident-history.service.js';
import { AllExceptionsFilter } from '../src/observability/all-exceptions.filter.js';

const WEB_ORIGIN = 'http://localhost:5173';
const API_PREFIX = 'api/v1';

interface MockRequest {
  auth?: AuthenticatedContext;
  headers: { cookie?: string };
  query: Record<string, unknown>;
  params: Record<string, string>;
}

const TEST_ORG = randomUUID();
const TEST_RESIDENT_ID = randomUUID();
const OTHER_ORG = randomUUID();

function makeSessionServiceMock(authContext: AuthenticatedContext | null) {
  return {
    authenticate: async (secret: string): Promise<AuthenticatedContext | null> => {
      if (!secret || secret === 'invalid') return null;
      return authContext;
    },
  };
}

function makeHistoryServiceMock(shouldThrowNotFound = false) {
  return {
    getHistory: async (orgId: string, residentId: string, query: Record<string, unknown>) => {
      if (shouldThrowNotFound || orgId === OTHER_ORG) {
        throw new NotFoundException('Resident not found');
      }
      return {
        items: [
          {
            id: randomUUID(),
            action: 'booking.created',
            targetType: 'booking',
            targetId: randomUUID(),
            occurredAt: new Date().toISOString(),
            actor: { userId: randomUUID(), displayName: 'Test Actor' },
            metadata: { residentId: TEST_RESIDENT_ID },
          },
        ],
        total: 1,
        page: Number(query.page) || 1,
        limit: Number(query.limit) || 20,
        totalPages: 1,
      };
    },
  };
}

function makeEmptyHistoryServiceMock() {
  return {
    getHistory: async () => ({
      items: [],
      total: 0,
      page: 1,
      limit: 20,
      totalPages: 0,
    }),
  };
}

function makeErrorServiceMock() {
  return {
    getHistory: async () => {
      throw new Error('Database connection lost');
    },
  };
}

@Controller('residents')
class TestResidentHistoryController {
  constructor(
    @Inject(ResidentHistoryService) private readonly historyService: ResidentHistoryService,
  ) {}

  @UseGuards(SessionGuard, RoleGuard)
  @Get(':residentId/history')
  async getHistory(
    @Req() req: MockRequest,
    @Param('residentId', ParseUUIDPipe) residentId: string,
    @Query() query: Record<string, unknown>,
  ) {
    try {
      const organizationId = req.auth!.organizationId;
      const result = await this.historyService.getHistory(organizationId, residentId, query);
      return result;
    } catch (error) {
      console.error('Controller error:', error);
      throw error;
    }
  }
}

async function createTestApp(
  sessionAuthContext: AuthenticatedContext | null,
  historyServiceMock: ReturnType<typeof makeHistoryServiceMock>,
): Promise<INestApplication> {
  const sessionServiceMock = makeSessionServiceMock(sessionAuthContext);

  @Module({
    controllers: [TestResidentHistoryController],
    providers: [
      { provide: SessionService, useValue: sessionServiceMock },
      { provide: ResidentHistoryService, useValue: historyServiceMock },
      SessionGuard,
      RoleGuard,
    ],
  })
  class TestModule {}

  const app = await NestFactory.create(TestModule, { logger: false });
  app.useGlobalFilters(new AllExceptionsFilter());
  app.setGlobalPrefix(API_PREFIX);
  await app.init();
  return app;
}

const OWNER_CONTEXT: AuthenticatedContext = {
  sessionId: randomUUID(),
  userId: randomUUID(),
  organizationId: TEST_ORG,
  organizationName: 'Test Org',
  displayName: 'Test Owner',
  role: 'OWNER',
  passwordChangeRequired: false,
};

const PM_CONTEXT: AuthenticatedContext = {
  ...OWNER_CONTEXT,
  role: 'PROPERTY_MANAGER',
  displayName: 'Test PM',
};

const VIEWER_CONTEXT: AuthenticatedContext = {
  ...OWNER_CONTEXT,
  role: 'VIEWER' as never,
  displayName: 'Test Viewer',
};

const STAFF_CONTEXT: AuthenticatedContext = {
  ...OWNER_CONTEXT,
  role: 'STAFF' as never,
  displayName: 'Test Staff',
};

const ADMIN_CONTEXT: AuthenticatedContext = {
  ...OWNER_CONTEXT,
  role: 'ADMIN' as never,
  displayName: 'Test Admin',
};

function makeCookie(secret: string): string {
  return `nook_session=${secret}`;
}

const validCookie = makeCookie('valid-secret');
const invalidCookie = makeCookie('invalid');

test('1. Unauthenticated request returns 401', async () => {
  const app = await createTestApp(null, makeHistoryServiceMock());
  try {
    await request(app.getHttpServer())
      .get(`/api/v1/residents/${TEST_RESIDENT_ID}/history`)
      .set('Origin', WEB_ORIGIN)
      .expect(401);
  } finally {
    await app.close();
  }
});

test('2. Invalid session returns 401', async () => {
  const app = await createTestApp(null, makeHistoryServiceMock());
  try {
    await request(app.getHttpServer())
      .get(`/api/v1/residents/${TEST_RESIDENT_ID}/history`)
      .set('Origin', WEB_ORIGIN)
      .set('Cookie', invalidCookie)
      .expect(401);
  } finally {
    await app.close();
  }
});

test('3. OWNER role is permitted', async () => {
  const app = await createTestApp(OWNER_CONTEXT, makeHistoryServiceMock());
  try {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/residents/${TEST_RESIDENT_ID}/history`)
      .set('Origin', WEB_ORIGIN)
      .set('Cookie', validCookie)
      .expect(200);

    assert.equal(res.body.total, 1);
    assert.ok(Array.isArray(res.body.items));
  } finally {
    await app.close();
  }
});

test('4. PROPERTY_MANAGER role is permitted', async () => {
  const app = await createTestApp(PM_CONTEXT, makeHistoryServiceMock());
  try {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/residents/${TEST_RESIDENT_ID}/history`)
      .set('Origin', WEB_ORIGIN)
      .set('Cookie', validCookie)
      .expect(200);

    assert.equal(res.body.total, 1);
  } finally {
    await app.close();
  }
});

test('5. VIEWER role is denied with 403 INSUFFICIENT_ROLE', async () => {
  const app = await createTestApp(VIEWER_CONTEXT, makeHistoryServiceMock());
  try {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/residents/${TEST_RESIDENT_ID}/history`)
      .set('Origin', WEB_ORIGIN)
      .set('Cookie', validCookie)
      .expect(403);

    assert.equal(res.body.code, 'INSUFFICIENT_ROLE');
  } finally {
    await app.close();
  }
});

test('6. STAFF role is denied with 403 INSUFFICIENT_ROLE', async () => {
  const app = await createTestApp(STAFF_CONTEXT, makeHistoryServiceMock());
  try {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/residents/${TEST_RESIDENT_ID}/history`)
      .set('Origin', WEB_ORIGIN)
      .set('Cookie', validCookie)
      .expect(403);

    assert.equal(res.body.code, 'INSUFFICIENT_ROLE');
  } finally {
    await app.close();
  }
});

test('7. ADMIN role is denied with 403 INSUFFICIENT_ROLE', async () => {
  const app = await createTestApp(ADMIN_CONTEXT, makeHistoryServiceMock());
  try {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/residents/${TEST_RESIDENT_ID}/history`)
      .set('Origin', WEB_ORIGIN)
      .set('Cookie', validCookie)
      .expect(403);

    assert.equal(res.body.code, 'INSUFFICIENT_ROLE');
  } finally {
    await app.close();
  }
});

test('8. Role from query parameter does not override authenticated session role', async () => {
  const app = await createTestApp(VIEWER_CONTEXT, makeHistoryServiceMock());
  try {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/residents/${TEST_RESIDENT_ID}/history?role=OWNER`)
      .set('Origin', WEB_ORIGIN)
      .set('Cookie', validCookie)
      .expect(403);

    assert.equal(res.body.code, 'INSUFFICIENT_ROLE');
  } finally {
    await app.close();
  }
});

test('9. Cross-organization resident returns 404', async () => {
  const app = await createTestApp(OWNER_CONTEXT, makeHistoryServiceMock(true));
  try {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/residents/${TEST_RESIDENT_ID}/history`)
      .set('Origin', WEB_ORIGIN)
      .set('Cookie', validCookie)
      .expect(404);

    assert.equal(res.body.message, 'Resident not found');
  } finally {
    await app.close();
  }
});

test('10. Empty history returns correct structure', async () => {
  const app = await createTestApp(OWNER_CONTEXT, makeEmptyHistoryServiceMock());
  try {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/residents/${TEST_RESIDENT_ID}/history`)
      .set('Origin', WEB_ORIGIN)
      .set('Cookie', validCookie)
      .expect(200);

    assert.equal(res.body.items.length, 0);
    assert.equal(res.body.total, 0);
    assert.equal(res.body.page, 1);
    assert.equal(res.body.limit, 20);
    assert.equal(res.body.totalPages, 0);
    assert.ok(Array.isArray(res.body.items));
  } finally {
    await app.close();
  }
});

test('11. Pagination parameters work through controller', async () => {
  const app = await createTestApp(OWNER_CONTEXT, makeHistoryServiceMock());
  try {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/residents/${TEST_RESIDENT_ID}/history?page=2&limit=10`)
      .set('Origin', WEB_ORIGIN)
      .set('Cookie', validCookie)
      .expect(200);

    assert.equal(res.body.page, 2);
    assert.equal(res.body.limit, 10);
  } finally {
    await app.close();
  }
});

test('12. Service error propagates as 500', async () => {
  const app = await createTestApp(OWNER_CONTEXT, makeErrorServiceMock());
  try {
    await request(app.getHttpServer())
      .get(`/api/v1/residents/${TEST_RESIDENT_ID}/history`)
      .set('Origin', WEB_ORIGIN)
      .set('Cookie', validCookie)
      .expect(500);
  } finally {
    await app.close();
  }
});
