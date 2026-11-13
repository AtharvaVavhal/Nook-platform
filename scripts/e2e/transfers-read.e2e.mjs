/** T6 and T9 read subsets: real Chrome, real session/API, fresh PostgreSQL. No mocked responses or execution gates. */
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import pg from 'pg';
import puppeteer from 'puppeteer-core';
import { hashTestPassword, TEST_PASSWORD } from '../../apps/api/test/integration/helpers/fixtures.ts';

const root = resolve(import.meta.dirname, '../..');
const children = [], pages = [], cases = [], failures = [];
let browser, admin, hash;
const requests = [], pageDiagnostics = [];
const q = async (sql, params = []) => (await admin.query(sql, params)).rows;
const isolatedUrl = (raw, role) => {
  const u = new URL(raw);
  assert.equal(u.hostname, '127.0.0.1');
  assert.ok(u.port && !['5432','5433'].includes(u.port));
  assert.match(u.pathname, /^\/nook_integration_[a-z0-9]+$/);
  assert.equal(u.username, role);
  return u;
};
const migrator = isolatedUrl(process.env.E2E_MIGRATOR_URL, 'nook_ci_full_migrator');
const runtime = isolatedUrl(process.env.E2E_RUNTIME_URL, 'nook_ci_full_runtime');
assert.equal(runtime.host, migrator.host); assert.equal(runtime.pathname, migrator.pathname);
assert.equal(process.env.NOOK_ALLOW_DISPOSABLE_INTEGRATION_DB, '1');
assert.notEqual(process.env.CORRECTIONS_FINANCIAL_APPLY_ENABLED, '1');
async function freePort() {
  const server = createServer();
  await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
  const port = server.address().port;
  await new Promise(done => server.close(done));
  return port;
}
const api = `http://127.0.0.1:${await freePort()}`, web = `http://127.0.0.1:${await freePort()}`;
const base = { PATH: process.env.PATH, HOME: process.env.HOME, APP_ENV: 'test', DOTENV_CONFIG_PATH: '/dev/null', NOOK_ISOLATED_TEST_RUN: '1', CHECKPOINT_DISABLE: '1' };
function start(name, args, cwd, env) {
  const child = spawn(process.execPath, args, { cwd, env, stdio: ['ignore','pipe','pipe'] });
  const item = { name, child, errors: 0 };
  for (const pipe of [child.stdout, child.stderr]) pipe.on('data', data => { if (/"status":5\d\d|unhandled exception/.test(String(data))) item.errors++; });
  child.on('error', () => failures.push(`${name} process failed`));
  children.push(item);
}
async function waitReady(url, name) {
  const limit = Date.now() + 60000;
  while (Date.now() < limit) {
    assert.equal(children.find(c => c.name === name).child.exitCode, null, `${name} exited`);
    try { if ((await fetch(url)).status < 500) return; } catch { /* startup */ }
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error(`${name} startup timeout`);
}
async function seedOrg(label) {
  const orgId = randomUUID();
  const people = ['OWNER', 'OWNER', 'PROPERTY_MANAGER', 'PROPERTY_MANAGER'].map((role, i) => ({
    role,
    userId: randomUUID(),
    email: `e2e-${label}-${i}-${randomUUID().slice(0, 8)}@nook.test.invalid`.toLowerCase(),
    name: `${role === 'OWNER' ? 'Owner' : 'Manager'} ${label}${i}`,
  }));
  const ids = { property: randomUUID(), floor: randomUUID(), room: randomUUID(), bed: randomUUID() };
  await q('BEGIN');
  await q(`INSERT INTO organizations (id, name, updated_at) VALUES ($1,$2,now())`, [orgId, `E2E ${label}`]);
  for (const p of people) {
    await q(`INSERT INTO users (id, login_identifier, password_hash, display_name, updated_at) VALUES ($1,$2,$3,$4,now())`, [p.userId, p.email, hash, p.name]);
    await q(`INSERT INTO memberships (id, organization_id, user_id, role, status) VALUES ($1,$2,$3,$4,'ACTIVE')`, [randomUUID(), orgId, p.userId, p.role]);
  }
  await q(`INSERT INTO properties (id, organization_id, code, name, updated_at) VALUES ($1,$2,$3,'Main',now())`, [ids.property, orgId, `P-${ids.property.slice(0, 8)}`]);
  await q(`INSERT INTO floors (id, organization_id, property_id, label, ordinal, updated_at) VALUES ($1,$2,$3,'F',0,now())`, [ids.floor, orgId, ids.property]);
  await q(`INSERT INTO rooms (id, organization_id, property_id, floor_id, label, updated_at) VALUES ($1,$2,$3,$4,'R',now())`, [ids.room, orgId, ids.property, ids.floor]);
  await q(`INSERT INTO beds (id, organization_id, property_id, room_id, label, updated_at) VALUES ($1,$2,$3,$4,'B1',now())`, [ids.bed, orgId, ids.property, ids.room]);
  await q('COMMIT');
  const [owner, owner2, pm, pm2] = people;
  return { orgId, bedId: ids.bed, owner, owner2, pm, pm2 };
}
async function addResident(orgId, first, last) {
  const id = randomUUID();
  await q(`INSERT INTO residents (id, organization_id, first_name, last_name, updated_at) VALUES ($1,$2,$3,$4,now())`, [id, orgId, first, last]);
  return id;
}

async function history(org, label, count) {
  const resident = await addResident(org.orgId, label, 'Read acceptance');
  const empty = await addResident(org.orgId, `${label}Empty`, 'Read acceptance');
  const loc = (await q('SELECT property_id,room_id FROM beds WHERE id=$1', [org.bedId]))[0];
  const other = randomUUID(), booking = randomUUID(), admission = randomUUID(), checkin = randomUUID();
  await q("INSERT INTO beds(id,organization_id,property_id,room_id,label,updated_at) VALUES($1,$2,$3,$4,$5,now())", [other,org.orgId,loc.property_id,loc.room_id,`${label}-Destination`]);
  await q("INSERT INTO bookings(id,organization_id,resident_id,bed_id,start_date,end_date,monthly_price,updated_at) VALUES($1,$2,$3,$4,'2020-01-01','2090-01-01',5000,now())",[booking,org.orgId,resident,org.bedId]);
  await q("INSERT INTO admissions(id,organization_id,booking_id,resident_id,bed_id,admission_date,status,updated_at) VALUES($1,$2,$3,$4,$5,'2020-01-01','ADMITTED',now())",[admission,org.orgId,booking,resident,org.bedId]);
  await q("INSERT INTO check_ins(id,organization_id,admission_id,resident_id,bed_id,booking_id,check_in_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,'2020-01-01',now())",[checkin,org.orgId,admission,resident,org.bedId,booking]);
  const instant = day => new Date(Date.UTC(2020,0,1+day)).toISOString();
  // Insert synthetic historical records only; never invoke transfer/adoption/correction commands.
  for (let i=0; i<=count; i++) {
    const bed = i%2 ? other : org.bedId, transfer = i ? randomUUID() : null;
    if (i) await q("INSERT INTO transfers(id,organization_id,resident_id,booking_id,type,source_bed_id,source_room_id,source_property_id,destination_bed_id,destination_room_id,destination_property_id,reason,effective_at,recorded_at,actor_user_id,actor_role,idempotency_key) VALUES($1,$2,$3,$4,'BED_TRANSFER',$5,$6,$7,$8,$6,$7,$9,$10,$10,$11,'OWNER',$12)",[transfer,org.orgId,resident,booking,i%2?org.bedId:other,loc.room_id,loc.property_id,bed,`${label}-history-${String(i).padStart(2,'0')}`,instant(i),org.owner.userId,randomUUID()]);
    await q("INSERT INTO stay_assignments(organization_id,booking_id,resident_id,bed_id,kind,status,start_at,end_at,transfer_id) VALUES($1,$2,$3,$4,$5::\"StayAssignmentKind\",$6::\"StayAssignmentStatus\",$7,$8,$9)",[org.orgId,booking,resident,bed,i?'TRANSFER':'ORIGINAL',i===count?'ACTIVE':'COMPLETED',instant(i),i===count?null:instant(i+1),transfer]);
  }
  return { resident, empty, other };
}
async function snapshot() {
  const tables=['bookings','admissions','check_ins','check_outs','stay_assignments','stay_assignment_replacements','transfers','transfer_command_receipts','transfer_finance_reviews','transfer_finance_resolutions','correction_proposals','correction_command_receipts','correction_finance_links','invoices','payments','payment_reversals','invoice_adjustments','invoice_voids'];
  const out={};
  for (const table of tables) {
    const rows=await q(`SELECT to_jsonb(t) AS value FROM ${table} t ORDER BY id`);
    out[table]={count:rows.length,sha256:createHash('sha256').update(JSON.stringify(rows)).digest('hex')};
  }
  return out;
}
async function session(user) {
  const context=await browser.createBrowserContext(), page=await context.newPage(); pages.push(page);
  page.on('pageerror',e=>{failures.push('browser page error');pageDiagnostics.push(String(e.message).replace(/https?:\/\/[^\s]+/g,'[local URL]').slice(0,300));});
  page.on('response',r=>{if(r.url().startsWith(api) || r.url().startsWith(web)) requests.push({path:new URL(r.url()).pathname,status:r.status()});});
  page.on('response',r=>{if(r.url().startsWith(api) && r.status()>=500) failures.push(`API ${r.status()}`);});
  // Observe, never intercept. Only authentication may write in these read-only acceptance cases.
  page.on('request',r=>{if(r.url().startsWith(api) && !['GET','OPTIONS'].includes(r.method()) && !new URL(r.url()).pathname.startsWith('/api/v1/auth/')) failures.push('unexpected business write request');});
  await page.goto(web,{waitUntil:'domcontentloaded'});
  if (user) {
    await page.waitForSelector('#login-email'); await page.type('#login-email',user.email); await page.type('#login-password',TEST_PASSWORD);
    await Promise.all([page.waitForSelector('#login-email',{hidden:true}),page.keyboard.press('Enter')]);
  }
  return page;
}
async function get(page,path) {
  return page.evaluate(async url=>{const r=await fetch(url,{credentials:'include'});return {status:r.status,body:await r.json()};},`${api}/api/v1${path}`);
}
async function click(page,label) {
  const button=await page.waitForSelector(`xpath/.//button[normalize-space()="${label}"]`);
  await button.click();
}
async function profile(page,id) {
  await page.goto(`${web}/#residents/${id}/profile`,{waitUntil:'domcontentloaded'});
  await click(page,'Corrections');
}
async function waitText(page,value) { await page.waitForFunction(t=>document.body.innerText.includes(t),{timeout:15000},value); }
async function scenario(id,fn) {
  const startedAt=new Date().toISOString();
  try { await fn();cases.push({id,status:'PASS',startedAt,finishedAt:new Date().toISOString()}); }
  catch(e) { cases.push({id,status:'FAIL',startedAt,finishedAt:new Date().toISOString(),error:String(e.message).replaceAll(process.env.E2E_MIGRATOR_URL,'[redacted]').replaceAll(process.env.E2E_RUNTIME_URL,'[redacted]').replaceAll(TEST_PASSWORD,'[redacted]').slice(0,1000)}); }
}
try {
  admin=new pg.Client({connectionString:migrator.href}); await admin.connect();
  const marker=(await q("SELECT shobj_description(oid,'pg_database') c FROM pg_database WHERE datname=current_database()"))[0].c;
  assert.match(marker,/nook-integration-isolated: disposable/);
  hash=await hashTestPassword();
  const A=await seedOrg('A'),B=await seedOrg('B');
  const a=await history(A,'TenantAlpha',21),b=await history(B,'TenantBetaPrivate',1);
  const before=await snapshot();
  start('api',['--import','tsx','src/main.ts'],resolve(root,'apps/api'),{...base,TSX_TSCONFIG_PATH:resolve(root,'apps/api/tsconfig.json'),PORT:new URL(api).port,WEB_ORIGIN:web,DATABASE_URL:runtime.href,CORRECTION_RECEIPT_SECRET:randomUUID()+randomUUID()});
  start('web',[resolve(root,'node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port',new URL(web).port,'--strictPort'],resolve(root,'apps/web'),{...base,VITE_API_BASE:`${api}/api/v1`});
  await Promise.all([waitReady(`${api}/api/v1/health`,'api'),waitReady(web,'web')]);
  browser=await puppeteer.launch({executablePath:process.env.NOOK_BROWSER_EXECUTABLE,headless:true});
  const owner=await session(A.owner),manager=await session(A.pm),foreign=await session(B.owner),anonymous=await session();
  await scenario('T6-read',async()=>{
    for (const page of [owner,manager]) {
      await profile(page,a.resident); await waitText(page,'TenantAlpha-history-21');
      const first=await get(page,`/transfers/history?residentId=${a.resident}&page=1&limit=20`);
      assert.equal(first.status,200);assert.equal(first.body.total,21);assert.equal(first.body.items.length,20);assert.equal(first.body.totalPages,2);
      const rendered=await page.$eval('[aria-label="Transfer history"]',el=>el.innerText);
      for (const item of first.body.items) {
        for (const value of [item.reason,item.actor.displayName,item.source.bedLabel,item.destination.bedLabel]) assert.ok(rendered.includes(value));
        const times=await page.evaluate(item=>[item.effectiveAt,item.recordedAt].map(t=>`${new Date(t).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',dateStyle:'medium',timeStyle:'short'})} IST`),item);
        for(const value of times) assert.ok(rendered.includes(value));
      }
      await click(page,'Next');await waitText(page,'Page 2 of 2');
      const second=await get(page,`/transfers/history?residentId=${a.resident}&page=2&limit=20`);
      assert.equal(second.status,200);assert.equal(second.body.items.length,1);assert.equal(second.body.items[0].reason,'TenantAlpha-history-01');
      assert.ok(!(await page.$eval('[aria-label="Transfer history"]',el=>el.innerText)).includes('TenantAlpha-history-21'));
      await click(page,'Previous');await waitText(page,'TenantAlpha-history-21');
      assert.deepEqual((await get(page,`/transfers/history?residentId=${a.resident}&page=1&limit=20`)).body,first.body);
      await profile(page,a.empty);await waitText(page,'No transfers');
    }
  });
  await scenario('T9-read',async()=>{
    for (const page of [owner,manager]) {
      const paths=[`/residents/${b.resident}/stay-summary`,`/residents/${b.resident}/history`,`/transfers/history?residentId=${b.resident}`,`/transfers/preview?residentId=${b.resident}&destinationBedId=${a.other}`,`/transfers/preview?residentId=${a.resident}&destinationBedId=${b.other}`];
      for(const path of paths) {const r=await get(page,path);assert.equal(r.status,404);assert.ok(!JSON.stringify(r.body).includes('TenantBetaPrivate'));}
      assert.equal((await get(page,`/transfers/history?residentId=${b.resident}&organizationId=${B.orgId}`)).status,400);
      await page.goto(`${web}/#residents/${b.resident}/profile`,{waitUntil:'domcontentloaded'});
      await page.waitForFunction(()=>/not found/i.test(document.body.innerText));
      assert.ok(!(await page.evaluate(()=>document.body.innerText)).includes('TenantBetaPrivate'));
      assert.equal((await get(page,`/transfers/history?residentId=${a.resident}`)).status,200);
    }
    await profile(foreign,b.resident);await waitText(foreign,'TenantBetaPrivate-history-01');
    assert.equal((await get(foreign,`/transfers/history?residentId=${a.resident}`)).status,404);
    for(const path of [`/transfers/history?residentId=${a.resident}`,`/residents/${a.resident}/history`,`/residents/${a.resident}/stay-summary`,`/transfers/preview?residentId=${a.resident}&destinationBedId=${a.other}`]) assert.equal((await get(anonymous,path)).status,401);
    await anonymous.goto(`${web}/#residents/${a.resident}/profile`,{waitUntil:'domcontentloaded'});await anonymous.waitForSelector('#login-email');
    assert.ok(!(await anonymous.evaluate(()=>document.body.innerText)).includes('TenantAlpha-history'));
    assert.equal((await get(manager,'/transfers/finance-reviews')).status,403);
    for(const page of [owner,foreign]) {const r=await get(page,'/transfers/finance-reviews');assert.equal(r.status,200);assert.equal(r.body.total,0);}
  });
  const after=await snapshot();
  assert.deepEqual(after,before,'Read acceptance changed business data');
  assert.deepEqual(failures,[]);assert.ok(children.every(c=>c.errors===0));
  console.log('TRANSFER_ACCEPTANCE '+JSON.stringify({cases,requests:requests.filter(r=>r.path.startsWith("/api/")),businessSnapshotUnchanged:true,businessTables:before,api5xx:0,pageErrors:0,businessWriteRequests:0,gates:'unchanged-disabled',seed:'synthetic historical rows in fresh disposable PostgreSQL; no transfer/adoption execution'}));
  if(cases.length!==2 || cases.some(c=>c.status!=='PASS')) process.exitCode=1;
} catch(e) {
  console.log('TRANSFER_ACCEPTANCE '+JSON.stringify({cases,status:'FAIL',requests,pageDiagnostics,error:String(e.message).replaceAll(process.env.E2E_MIGRATOR_URL,'[redacted]').replaceAll(process.env.E2E_RUNTIME_URL,'[redacted]').replaceAll(TEST_PASSWORD,'[redacted]').slice(0,1000)}));process.exitCode=1;
} finally {
  await browser?.close().catch(()=>{});
  for(const {child} of children) if(child.exitCode===null) child.kill('SIGTERM');
  await new Promise(r=>setTimeout(r,800));
  for(const {child} of children) if(child.exitCode===null) child.kill('SIGKILL');
  await admin?.end().catch(()=>{});
}
