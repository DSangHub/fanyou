import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {PGlite} from '@electric-sql/pglite';
const fan='11111111-1111-4111-8111-111111111111',coach='22222222-2222-4222-8222-222222222222',other='33333333-3333-4333-8333-333333333333';
async function fixture(){
 const db=new PGlite();await db.exec('create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key)');
 for(const file of ['setup.sql','points-stars.sql'])await db.exec(await readFile(new URL(`../database/${file}`,import.meta.url),'utf8'));
 await db.query('insert into auth.users values ($1),($2),($3)',[fan,coach,other]);
 await db.query(`insert into fanyou_profiles(id,display_name,role,verified,moderation_status) values($1,'Fan','fan',false,'approved'),($2,'Coach','coach',true,'approved'),($3,'Other Fan','fan',false,'approved')`,[fan,coach,other]);
 const sid=(await db.query(`insert into fanyou_suggestions(author_id,recipient_id,body,status,screening)values($1,$2,'More passing drills','approved','manual')returning id`,[fan,coach])).rows[0].id;
 return {db,sid};
}
test('optional points count only approved interactions and do not duplicate or count self replies',async()=>{
 const {db,sid}=await fixture();try{
 const reply=async(status)=> (await db.query(`insert into fanyou_replies(author_id,suggestion_id,body,status,screening)values($1,$2,'Thanks for the suggestion',$3,'manual')returning id`,[coach,sid,status])).rows[0].id;
 const points=async()=>Number((await db.query('select points from fanyou_profile_scores where profile_id=$1',[coach])).rows[0].points);
 await reply('approved');assert.equal(await points(),0); // Not participating.
 await db.query('update fanyou_profiles set points_enabled=true where id=$1',[coach]);
 const rid=await reply('pending');assert.equal(await points(),0);
 await db.query(`update fanyou_replies set status='approved' where id=$1`,[rid]);assert.equal(await points(),10);
 await db.query(`update fanyou_replies set status='approved' where id=$1`,[rid]);assert.equal(await points(),10);
 await db.query(`update fanyou_replies set status='rejected' where id=$1`,[rid]);assert.equal(await points(),0);
 await db.query(`update fanyou_replies set status='approved' where id=$1`,[rid]);assert.equal(await points(),10);
 await db.query('update fanyou_profiles set points_enabled=false where id=$1',[coach]);await reply('approved');assert.equal(await points(),10);
 assert.equal((await db.query('select * from fanyou_profile_scores where points_enabled=true')).rows.length,0);
 await db.query('update fanyou_profiles set points_enabled=true where id=$1',[coach]);
 const self=(await db.query(`insert into fanyou_suggestions(author_id,recipient_id,body,status,screening)values($1,$1,'My own suggestion','approved','manual')returning id`,[coach])).rows[0].id;
 await db.query(`insert into fanyou_replies(author_id,suggestion_id,body,status,screening)values($1,$2,'My own reply','approved','manual')`,[coach,self]);assert.equal(await points(),10);
 await db.query(`update fanyou_suggestions set status='rejected' where id=$1`,[sid]);assert.equal(await points(),0);
 }finally{await db.close();}
});
test('stars require paid Fan ownership, approved content and integers 1–5; editing updates a single rating',async()=>{
 const {db,sid}=await fixture();try{
 const rid=(await db.query(`insert into fanyou_replies(author_id,suggestion_id,body,status,screening)values($1,$2,'Thanks for the suggestion','approved','manual')returning id`,[coach,sid])).rows[0].id;
 const rate=(who,stars)=>db.query('select * from fanyou_rate_reply($1,$2,$3)',[who,rid,stars]);
 await assert.rejects(rate(fan,5),/PAID_FAN_REQUIRED/);
 await db.query(`insert into fanyou_subscriptions values('sub_fan',$1,'fan','active',now()+interval '1 month',now()),('sub_other',$2,'fan','active',now()+interval '1 month',now())`,[fan,other]);
 for(const stars of [0,6,null])await assert.rejects(rate(fan,stars),/INVALID_STARS/);
 await assert.rejects(rate(other,5),/RATING_FORBIDDEN/);
 await assert.rejects(rate(coach,5),/FAN_REQUIRED/);
 await rate(fan,5);await rate(fan,3);
 assert.equal((await db.query('select count(*)::int as count from fanyou_star_ratings')).rows[0].count,1);
 const score=(await db.query('select rating_count,average_stars from fanyou_profile_scores where profile_id=$1',[coach])).rows[0];assert.equal(Number(score.rating_count),1);assert.equal(Number(score.average_stars),3);
 await db.query(`update fanyou_subscriptions set paid_through=now()-interval '1 minute' where user_id=$1`,[fan]);await assert.rejects(rate(fan,4),/PAID_FAN_REQUIRED/);
 await db.query(`update fanyou_subscriptions set paid_through=now()+interval '1 month' where user_id=$1`,[fan]);
 await db.query(`update fanyou_replies set status='pending' where id=$1`,[rid]);await assert.rejects(rate(fan,4),/RATING_FORBIDDEN/);
 assert.equal(Number((await db.query('select rating_count from fanyou_profile_scores where profile_id=$1',[coach])).rows[0].rating_count),0);
 await db.exec('set role authenticated');await assert.rejects(rate(fan,5),/permission denied/);
 for(const table of ['fanyou_interaction_points','fanyou_star_ratings','fanyou_profile_scores'])await assert.rejects(db.query(`select * from public.${table}`),/permission denied/);
 }finally{await db.close();}
});
