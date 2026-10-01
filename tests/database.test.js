import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {PGlite} from '@electric-sql/pglite';
const fan='11111111-1111-4111-8111-111111111111',coach='22222222-2222-4222-8222-222222222222',other='33333333-3333-4333-8333-333333333333';
test('database enforces quota, paid access, reply ownership and API isolation',async()=>{
 const db=new PGlite();try{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);`);
 await db.exec(await readFile(new URL('../database/setup.sql',import.meta.url),'utf8'));
 await db.query('insert into auth.users values ($1),($2),($3)',[fan,coach,other]);
 await db.query(`insert into fanyou_profiles(id,display_name,role,verified,moderation_status) values($1,'Fan','fan',false,'approved'),($2,'Coach','coach',true,'approved'),($3,'Other','coach',true,'approved')`,[fan,coach,other]);
 const submit=()=>db.query(`select * from public.fanyou_submit_suggestion($1,$2,'More passing drills please','pending','manual')`,[fan,coach]);
 // Space out fixtures so the separate anti-spam policy doesn't mask the monthly quota.
 for(let i=0;i<10;i++){await submit();await db.query(`update fanyou_suggestions set created_at=date_trunc('month',now() at time zone 'UTC') at time zone 'UTC' where author_id=$1`,[fan]);}
 await assert.rejects(submit(),/MONTHLY_LIMIT/);
 // Prior month entries do not count against a new month.
 await db.query(`update fanyou_suggestions set created_at=created_at-interval '1 month' where author_id=$1`,[fan]);await submit();
 await db.query(`update fanyou_suggestions set status='approved',created_at=date_trunc('month',now() at time zone 'UTC') at time zone 'UTC'`);
 const suggestion=(await db.query('select id from fanyou_suggestions limit 1')).rows[0].id;
 await assert.rejects(db.query(`select fanyou_submit_reply($1,$2,'Great idea','pending','manual')`,[other,suggestion]),/REPLY_FORBIDDEN/);
 await db.query(`select fanyou_submit_reply($1,$2,'Great idea','pending','manual')`,[coach,suggestion]);
 await db.query(`insert into fanyou_subscriptions values('sub_test',$1,'fan','active',now()+interval '1 year',now())`,[fan]);
 for(let i=0;i<12;i++){await submit();await db.query(`update fanyou_suggestions set created_at=date_trunc('month',now() at time zone 'UTC') at time zone 'UTC'`);}
 assert.equal((await db.query('select count(*)::int as total from fanyou_suggestions')).rows[0].total,23);
 await db.query(`update fanyou_subscriptions set status='canceled'`);await assert.rejects(submit(),/MONTHLY_LIMIT/);

 // A hold cannot be removed by a later normal subscription event, and old snapshots cannot overwrite new ones.
 await db.query(`select fanyou_sync_subscription('sub_sync',$1,'fan','active',now()+interval '1 year',now())`,[fan]);
 await db.query(`select fanyou_hold_subscription('sub_sync','charge.dispute.created')`);
 await db.query(`select fanyou_sync_subscription('sub_sync',$1,'fan','active',now()+interval '1 year',now()+interval '1 minute')`,[fan]);
 assert.equal((await db.query(`select status from fanyou_subscriptions where stripe_subscription_id='sub_sync'`)).rows[0].status,'restricted');
 await db.query(`select fanyou_sync_subscription('sub_order',$1,'fan','canceled',now(),now()+interval '1 minute')`,[fan]);
 await db.query(`select fanyou_sync_subscription('sub_order',$1,'fan','active',now()+interval '1 year',now())`,[fan]);
 assert.equal((await db.query(`select status from fanyou_subscriptions where stripe_subscription_id='sub_order'`)).rows[0].status,'canceled');
 // Invalid or unverified recipients cannot receive suggestions.
 await db.query(`update fanyou_profiles set verified=false where id=$1`,[coach]);await assert.rejects(submit(),/RECIPIENT_UNAVAILABLE/);
 await db.exec('set role authenticated');
 await assert.rejects(db.query('select * from public.fanyou_subscriptions'),/permission denied/);
 await assert.rejects(submit(),/permission denied/);
 await db.exec('reset role');
 const rls=(await db.query(`select relrowsecurity from pg_class where relname like 'fanyou_%' and relkind='r'`)).rows;
 assert.ok(rls.length>=6&&rls.every(row=>row.relrowsecurity));
 }finally{await db.close();}
});
