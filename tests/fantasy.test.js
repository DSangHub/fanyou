import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {PGlite} from '@electric-sql/pglite';
import {ageBand,fantasyPoints,fantasyDispatch,rules} from '../lib/fantasy.js';
const first='11111111-1111-4111-8111-111111111111',second='22222222-2222-4222-8222-222222222222',third='33333333-3333-4333-8333-333333333333';
test('13+ age eligibility handles exact birthdays, adult boundary and invalid dates',()=>{
 const now=new Date('2026-10-19T00:00:00Z');
 assert.equal(ageBand('2013-10-19',now),'13-17');assert.throws(()=>ageBand('2013-10-20',now),/13 and older/);
 assert.equal(ageBand('2008-10-19',now),'18+');assert.equal(ageBand('2008-10-20',now),'13-17');
 for(const date of ['2020-02-30','2028-01-01','1899-01-01','13+','',null])assert.throws(()=>ageBand(date,now));
 assert.equal(ageBand('2012-02-29',now),'13-17');
});
test('Node and Python share deterministic scoring for all five sports and reject invalid stats',()=>{
 for(const sport of Object.keys(rules.sports)){
  const stats=Object.fromEntries(Object.keys(rules.sports[sport]).map((key,index)=>[key,index+1]));
  const python=spawnSync('python3',['-c',"from python.fantasy_scores import points;import sys,json;d=json.load(sys.stdin);print(points(d['sport'],d['stats']))"],{cwd:new URL('../',import.meta.url),input:JSON.stringify({sport,stats}),encoding:'utf8'});
  assert.equal(python.status,0,python.stderr);assert.equal(fantasyPoints(sport,stats),Number(python.stdout));
 }
 assert.equal(fantasyPoints('Football',{passing_yards:250,passing_touchdowns:2,interceptions:1}),16);
 for(const stats of [{passing_yards:-1},{passing_yards:true},{passing_yards:1.5},{passing_yards:Infinity},{passing_yards:NaN},{unknown:1}])assert.throws(()=>fantasyPoints('Football',stats));
});
test('Fantasy API gates activation, checks age and discards DOB, disallows wagering and recalculates imported scores',async()=>{
 const oldFetch=global.fetch;const names=['FANTASY_ENABLED','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','SUPABASE_PUBLISHABLE_KEY'];const old=names.map(n=>process.env[n]);
 try{
  delete process.env.FANTASY_ENABLED;await assert.rejects(fantasyDispatch('fantasy-leagues',{method:'GET'},{},{id:first}),/activation/);
  process.env.FANTASY_ENABLED='true';process.env.SUPABASE_URL='https://example.supabase.co';process.env.SUPABASE_SERVICE_ROLE_KEY='test';process.env.SUPABASE_PUBLISHABLE_KEY='test';
  const calls=[];global.fetch=async(url,options)=>{const data=JSON.parse(options.body);calls.push(data);return {ok:true,json:async()=>data.p_action==='detail'?{league:{owner_id:first,sport:'Football'}}:{eligible:true}};};
  await assert.rejects(fantasyDispatch('fantasy-age',{method:'POST'},{date_of_birth:'2020-01-01',accept_rules:true},{id:first}),/13 and older/);assert.equal(calls.length,0);
  await fantasyDispatch('fantasy-age',{method:'POST'},{date_of_birth:'2000-01-01',accept_rules:true},{id:first});assert.deepEqual(calls[0].p_data,{age_band:'18+'});
  await assert.rejects(fantasyDispatch('fantasy-create',{method:'POST'},{sport:'Football',entry_fee:0},{id:first}),/free leagues/);
  const payload={league_id:second,period:'week-1',rules_version:rules.version,records:[{athlete_id:third,stats:{passing_yards:250},points:999}]};
  await assert.rejects(fantasyDispatch('fantasy-scores',{method:'POST'},payload,{id:first}),/do not match/);
  payload.records[0].points=10;await fantasyDispatch('fantasy-scores',{method:'POST'},payload,{id:first});assert.equal(calls.at(-1).p_data.records[0].points,10);
  payload.records.push(payload.records[0]);await assert.rejects(fantasyDispatch('fantasy-scores',{method:'POST'},payload,{id:first}),/Duplicate/);
 }finally{global.fetch=oldFetch;names.forEach((n,i)=>{if(old[i]===undefined)delete process.env[n];else process.env[n]=old[i];});}
});
test('Database keeps leagues private, caps membership/rosters, locks picks, corrects scores idempotently and blocks browser access',async()=>{
 const db=new PGlite();try{
  await db.exec('create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key)');
  await db.exec(await readFile(new URL('../database/fantasy.sql',import.meta.url),'utf8'));
  for(const user of [first,second,third])await db.query('insert into auth.users values($1)',[user]);
  const call=async(action,user,data={})=>(await db.query('select fanyou_fantasy_action($1,$2,$3::jsonb) as result',[action,user,JSON.stringify(data)])).rows[0].result;
  await assert.rejects(call('create',first,{name:'Private league',sport:'Football',capacity:2,roster_size:1,team_name:'Team A'}),/FANTASY_AGE_REQUIRED/);
  for(const user of [first,second,third])await call('enroll',user,{age_band:'13-17'});
  const {league_id:league}=await call('create',first,{name:'Private league',sport:'Football',capacity:2,roster_size:1,team_name:'Team A'});
  await assert.rejects(call('detail',third,{league_id:league}),/FANTASY_FORBIDDEN/);
  const detail=await call('detail',first,{league_id:league});const invite=detail.league.invite_code;
  await call('join',second,{invite_code:invite,team_name:'Team B'});await assert.rejects(call('join',third,{invite_code:invite,team_name:'Team C'}),/FANTASY_FULL/);
  assert.equal((await call('detail',second,{league_id:league})).league.invite_code,undefined);
  await assert.rejects(call('athlete',second,{league_id:league,name:'Pro One',team:'Club A',position:'QB'}),/FANTASY_FORBIDDEN/);
  const {athlete_id:a}=await call('athlete',first,{league_id:league,name:'Pro One',team:'Club A',position:'QB'});
  const {athlete_id:b}=await call('athlete',first,{league_id:league,name:'Pro Two',team:'Club B',position:'QB'});
  await call('pick',first,{league_id:league,athlete_id:a});await assert.rejects(call('pick',second,{league_id:league,athlete_id:a}),/FANTASY_PICK_TAKEN/);
  await assert.rejects(call('start',first,{league_id:league}),/FANTASY_INVALID/);await assert.rejects(call('pick',first,{league_id:league,athlete_id:b}),/FANTASY_FULL/);
  await call('pick',second,{league_id:league,athlete_id:b});await call('start',first,{league_id:league});
  await assert.rejects(call('pick',second,{league_id:league,athlete_id:a}),/FANTASY_LOCKED/);
  const score={league_id:league,period:'week-1',records:[{athlete_id:a,stats:{passing_yards:250},points:10}]};
  await assert.rejects(call('scores',second,score),/FANTASY_FORBIDDEN/);
  await call('scores',first,score);await call('scores',first,score);score.records[0].points=12;await call('scores',first,score);
  const scores=(await call('detail',first,{league_id:league})).scores;assert.equal(scores.length,1);assert.equal(Number(scores[0].points),12);
  score.records[0].points=13;await assert.rejects(call('scores',first,{...score,records:[score.records[0],{athlete_id:third,stats:{},points:1}]}),/FANTASY_FORBIDDEN/);const afterFailure=(await call('detail',first,{league_id:league})).scores;assert.equal(afterFailure.length,1);assert.equal(Number(afterFailure[0].points),12);
  await call('close',first,{league_id:league});await assert.rejects(call('scores',first,score),/FANTASY_LOCKED/);
  const tables=await db.query("select relrowsecurity from pg_class where relname like 'fanyou_fantasy_%' and relkind='r'");assert.equal(tables.rows.length,6);assert.ok(tables.rows.every(r=>r.relrowsecurity));
  await db.exec('set role authenticated');await assert.rejects(db.query('select * from fanyou_fantasy_eligibility'),/permission denied/);await assert.rejects(call('list',first),/permission denied/);
 }finally{await db.close();}
});
