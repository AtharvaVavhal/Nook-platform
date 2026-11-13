/* eslint-disable @typescript-eslint/no-explicit-any -- HTTP/pg fixture boundaries */
import '../../apps/api/test/integration/helpers/preflight.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { withMigratorClient } from '../../apps/api/test/integration/helpers/db.js';
import { PrismaService } from '../../apps/api/src/database/prisma.service.js';
import { CheckInService } from '../../apps/api/src/checkin/checkin.service.js';
import { BookingService } from '../../apps/api/src/booking/booking.service.js';
import { TransferService } from '../../apps/api/src/transfer/transfer.service.js';
import { TransferController } from '../../apps/api/src/transfer/transfer.controller.js';
import { SessionGuard, RoleGuard, OriginGuard, CsrfGuard } from '../../apps/api/src/auth/auth.guards.js';
import { SessionService } from '../../apps/api/src/auth/session.service.js';
import { CsrfService } from '../../apps/api/src/auth/csrf.service.js';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import request from 'supertest';

const ids = {org:randomUUID(), actor:randomUUID(), property:randomUUID(),floor:randomUUID(),room:randomUUID()};
const prisma = new PrismaService();
const sql = <T=any>(query:string,params:unknown[]=[]) => withMigratorClient(async c => (await c.query(query,params)).rows as T[]);
const stays: {resident:string;bed:string;booking:string;checkin:string}[]=[];
test.before(async()=>{
  await sql('INSERT INTO organizations(id,name,updated_at) VALUES($1,\'Disposable transfer verification\',now())',[ids.org]);
  await sql('INSERT INTO users(id,login_identifier,password_hash,display_name,updated_at) VALUES($1,$2,\'not-a-login-fixture\',\'Fixture\',now())',[ids.actor,`${ids.actor}@nook.test.invalid`]);
  await sql('INSERT INTO properties(id,organization_id,code,name,updated_at) VALUES($1,$2,$3,\'P\',now())',[ids.property,ids.org,ids.property]);
  await sql('INSERT INTO floors(id,organization_id,property_id,label,ordinal,updated_at) VALUES($1,$2,$3,\'F\',0,now())',[ids.floor,ids.org,ids.property]);
  await sql('INSERT INTO rooms(id,organization_id,property_id,floor_id,label,updated_at) VALUES($1,$2,$3,$4,\'R\',now())',[ids.room,ids.org,ids.property,ids.floor]);
  for(const kind of ['active','completed','orphan']) {
    const row={resident:randomUUID(),bed:randomUUID(),booking:randomUUID(),checkin:randomUUID()}; stays.push(row);
    await sql('INSERT INTO beds(id,organization_id,property_id,room_id,label,updated_at) VALUES($1,$2,$3,$4,$5,now())',[row.bed,ids.org,ids.property,ids.room,kind]);
    await sql('INSERT INTO residents(id,organization_id,first_name,last_name,updated_at) VALUES($1,$2,\'Test\',\'Resident\',now())',[row.resident,ids.org]);
    await sql("INSERT INTO bookings(id,organization_id,resident_id,bed_id,start_date,end_date,monthly_price,updated_at) VALUES($1,$2,$3,$4,'2020-01-01','2090-01-01',5000,now())",[row.booking,ids.org,row.resident,row.bed]);
    const admission=randomUUID();
    await sql("INSERT INTO admissions(id,organization_id,booking_id,resident_id,bed_id,admission_date,status,updated_at) VALUES($1,$2,$3,$4,$5,'2020-01-01','ADMITTED',now())",[admission,ids.org,row.booking,row.resident,row.bed]);
    await sql("INSERT INTO check_ins(id,organization_id,admission_id,resident_id,bed_id,booking_id,check_in_at,status,updated_at) VALUES($1,$2,$3,$4,$5,$6,'2020-01-01',$7,now())",[row.checkin,ids.org,admission,row.resident,row.bed,row.booking,kind==='active'?'ACTIVE':'CHECKED_OUT']);
    if(kind==='completed') await sql("INSERT INTO check_outs(id,organization_id,check_in_id,resident_id,bed_id,booking_id,check_out_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,'2021-01-01',now())",[randomUUID(),ids.org,row.checkin,row.resident,row.bed,row.booking]);
  }
});
test.after(async()=>{await prisma.onModuleDestroy();});

function backfill(dryRun:boolean) {
  const result=spawnSync(process.execPath,['--import','tsx','scripts/backfill-stay-assignments.mjs',...(dryRun?['--dry-run']:[])],{env:process.env,encoding:'utf8',timeout:30000});
  assert.equal(result.status,0,'Backfill command failed; driver output withheld');
  const count=(key:string)=>Number(new RegExp(`${key}: (\\d+)`).exec(result.stdout)?.[1]);
  return {created:count('Total created'),skipped:count('Total skipped'),quarantined:count('Quarantined')};
}

test('all migrations and legacy occupancy; dry/live/repeated backfill preserves legacy behavior',async()=>{
  assert.equal((await sql('SELECT count(*)::int n FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL'))[0].n,23);
  const occupancy=new CheckInService(prisma), booking=new BookingService(prisma);
  const before=await occupancy.occupancy(ids.org);
  assert.deepEqual(before.occupiedBedIds,[stays[0]!.bed]);
  const availableBefore=await booking.getAvailableBeds(ids.org,new Date(),new Date('2080-01-01'));
  const dry=backfill(true);assert.equal(dry.created,2);assert.equal(dry.quarantined,1);
  assert.equal((await sql('SELECT count(*)::int n FROM stay_assignments'))[0].n,0);
  const live=backfill(false);assert.equal(live.created,2);assert.equal(live.quarantined,1);
  const repeat=backfill(false);assert.equal(repeat.created,0);assert.equal(repeat.quarantined,1);
  assert.equal((await sql('SELECT count(*)::int n FROM stay_assignments'))[0].n,2);
  assert.deepEqual(await occupancy.occupancy(ids.org),before);
  assert.deepEqual(await booking.getAvailableBeds(ids.org,new Date(),new Date('2080-01-01')),availableBefore);
  console.log(JSON.stringify({probe:'transfer-backfill',dry,live,repeat,legacyOccupancyUnchanged:true,legacyAvailabilityUnchanged:true}));
});

test('transfer-specific receipts enforce identity, idempotency uniqueness and immutability',async()=>{
  const source=stays[0]!,dest=stays[1]!,event=randomUUID(),key=randomUUID(),receipt=randomUUID();
  await sql("INSERT INTO transfers(id,organization_id,resident_id,booking_id,type,source_bed_id,source_room_id,source_property_id,destination_bed_id,destination_room_id,destination_property_id,reason,effective_at,actor_user_id,actor_role,idempotency_key) VALUES($1,$2,$3,$4,'BED_TRANSFER',$5,$6,$7,$8,$6,$7,'Fixture only',now(),$9,'OWNER',$10)",[event,ids.org,source.resident,source.booking,source.bed,ids.room,ids.property,dest.bed,ids.actor,key]);
  const insert='INSERT INTO transfer_command_receipts(id,organization_id,actor_id,idempotency_key,transfer_id,request_check,response_body) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)';
  const params=[receipt,ids.org,ids.actor,key,event,'a'.repeat(64),JSON.stringify({id:event})];
  await assert.rejects(sql(insert,[...params.slice(0,3),randomUUID(),...params.slice(4)]),(e:any)=>e.code==='23503');
  await sql(insert,params);
  await assert.rejects(sql(insert,[randomUUID(),...params.slice(1)]),(e:any)=>e.code==='23505');
  for(const command of ['UPDATE transfer_command_receipts SET response_version=1 WHERE id=$1','DELETE FROM transfer_command_receipts WHERE id=$1']) {
    await assert.rejects(sql(command,[receipt]),(e:any)=>e.code==='23001');
  }
  assert.equal((await sql('SELECT request_check FROM transfer_command_receipts WHERE id=$1',[receipt]))[0].request_check,'a'.repeat(64));
  console.log(JSON.stringify({probe:'transfer-receipts',migrationCount:23,identitySqlState:'23503',duplicateSqlState:'23505',updateDeleteSqlState:'23001',unchanged:true}));
});

test('HTTP execution stays 503 and changes zero database rows on same-key retry',async()=>{
  @Module({controllers:[TransferController],providers:[{provide:TransferService,useValue:new TransferService(prisma)},
    {provide:SessionService,useValue:{authenticate:async()=>({organizationId:ids.org,userId:ids.actor,role:'OWNER',passwordChangeRequired:false})}},
    SessionGuard,RoleGuard,OriginGuard,CsrfGuard,CsrfService]})
  class VerificationModule {}
  process.env.WEB_ORIGIN='http://localhost:5173';
  const app=await NestFactory.create(VerificationModule,{logger:false});await app.init();
  const fingerprint=async()=>{
    const result:Record<string,string>={};
    for(const {tablename} of await sql("SELECT tablename FROM pg_tables WHERE schemaname='public'")) {
      assert.match(tablename,/^[a-z_]+$/);
      result[tablename]=(await sql(`SELECT md5(coalesce(string_agg(to_jsonb(t)::text, '' ORDER BY to_jsonb(t)::text),'')) hash FROM "${tablename}" t`))[0].hash;
    }
    return result;
  };
  try {
    const before=await fingerprint(),key=randomUUID();
    for(let i=0;i<2;i++) {
      const res=await request(app.getHttpServer()).post('/transfers').set('Cookie','nook_session=fixture; nook_csrf=fixture').set('X-CSRF-Token','fixture').set('Origin','http://localhost:5173').set('Idempotency-Key',key).send({residentId:stays[0]!.resident,destinationBedId:stays[1]!.bed,reason:'Unavailable transfer',effectiveAt:new Date().toISOString()}).expect(503);
      assert.equal(res.body.code,'TRANSFER_EXECUTION_UNAVAILABLE');
    }
    assert.deepEqual(await fingerprint(),before);
    console.log(JSON.stringify({probe:'transfer-http-blocked',requests:2,status:503,allDatabaseRowsUnchanged:true,authorization:'real guards; fixture session authenticator'}));
  } finally {await app.close();}
});
