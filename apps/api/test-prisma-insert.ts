import { PrismaClient } from './src/generated/client.js';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter, log: [{ emit: 'stdout', level: 'query' }] });

async function test() {
  try {
    const p = await prisma.property.create({
      data: {
        organizationId: '00000000-0000-4000-8000-000000000101',
        code: 'TESTX',
        name: 'Test X',
      },
    });
    console.log('Created:', p);
  } catch (e) {
    console.error('Error:', e);
  } finally {
    await prisma.$disconnect();
  }
}

test();