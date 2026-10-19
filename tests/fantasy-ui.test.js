import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {parseHTML} from 'linkedom';import vm from 'node:vm';import {PGlite} from '@electric-sql/pglite';import {dispatch} from '../api/index.js';
const first='11111111-1111-4111-8111-111111111111',second='22222222-2222-4222-8222-222222222222';
const until=async predicate=>{for(let i=0;i<200;i++){if(predicate())return;await new Promise(r=>setTimeout(r,10));}throw Error('Expected UI state did not appear');};
test('Free fantasy UI: age block, create/invite/join, two rosters, Python-format stats and private standings',async()=>{
 const originalFetch=global.fetch,names=['FANTASY_ENABLED','SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY','SUPABASE_SERVICE_ROLE_KEY'],old=names.map(n=>process.env[n]);const db=new PGlite();
 try{
  await db.exec('create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key)');await db.exec(await readFile(new URL('../database/fantasy.sql',import.meta.url),'utf8'));await db.query('insert into auth.users values($1),($2)',[first,second]);
  process.env.FANTASY_ENABLED='true';process.env.SUPABASE_URL='https://example.supabase.co';process.env.SUPABASE_PUBLISHABLE_KEY='test';process.env.SUPABASE_SERVICE_ROLE_KEY='test';
  global.fetch=async(url,options={})=>{
   if(url.includes('/auth/v1/user'))return {ok:true,json:async()=>({id:options.headers.Authorization.includes('second')?second:first,email_confirmed_at:'2026-01-01',is_anonymous:false})};
   assert.match(url,/rpc\/fanyou_fantasy_action$/);const payload=JSON.parse(options.body);
   try{const r=await db.query('select fanyou_fantasy_action($1,$2,$3::jsonb) as data',[payload.p_action,payload.p_user,JSON.stringify(payload.p_data)]);return {ok:true,json:async()=>r.rows[0].data};}catch(error){return {ok:false,json:async()=>({message:error.message})};}
  };
  const html=await readFile(new URL('../index.html',import.meta.url),'utf8'),script=await readFile(new URL('../fantasy.js',import.meta.url),'utf8');
  function boot(token){
   const {window,document}=parseHTML(html);const saved=new Map(token?[['fanyou-session',JSON.stringify({access_token:token})]]:[]),calls=[];
   for(const form of document.querySelectorAll('form')){form.elements={};for(const el of form.querySelectorAll('[name]'))form.elements[el.name]=el;}
   for(const select of document.querySelectorAll('select'))Object.defineProperty(select,'value',{get(){return this._value??this.querySelector('option')?.textContent??'';},set(v){this._value=v;}});
   const localFetch=async(url,options={})=>{
    const route=url.split('/').at(-1);calls.push(route);
    try{const headers=Object.fromEntries(Object.entries(options.headers||{}).map(([k,v])=>[k.toLowerCase(),v]));const result=await dispatch(route,{method:options.method||'GET',headers},options.body?JSON.parse(options.body):{});return {ok:true,json:async()=>result};}catch(error){return {ok:false,json:async()=>({error:error.message})};}
   };
   window.confirm=()=>true;vm.runInNewContext(script,{document,window,fetch:localFetch,sessionStorage:{getItem:k=>saved.get(k)},Date});
   function submit(id,values){const form=document.getElementById(id);for(const [name,value]of Object.entries(values)){if(name==='accept_rules')form.elements[name].checked=value;else form.elements[name].value=String(value);}const event=new window.Event('submit',{cancelable:true});Object.defineProperty(event,'submitter',{value:form.querySelector('button')});form.dispatchEvent(event);}
   return {document,window,saved,calls,submit};
  }
  const a=boot('first');await until(()=>!a.document.getElementById('fantasy-age-form').hidden);
  a.submit('fantasy-age-form',{date_of_birth:'2020-01-01',accept_rules:true});await until(()=>/13 and older/.test(a.document.getElementById('fantasy-status').textContent));assert.ok(!a.calls.includes('fantasy-age'));
  a.submit('fantasy-age-form',{date_of_birth:'2000-01-01',accept_rules:true});await until(()=>!a.document.getElementById('fantasy-account').hidden);
  a.submit('fantasy-create-form',{name:'Friends league',team_name:'Team One',sport:'Football',capacity:2,roster_size:1});await until(()=>a.document.getElementById('fantasy-league-title').textContent==='Friends league');
  const league=(await db.query('select * from fanyou_fantasy_leagues')).rows[0];
  const b=boot('second');await until(()=>!b.document.getElementById('fantasy-age-form').hidden);b.submit('fantasy-age-form',{date_of_birth:'2000-01-01',accept_rules:true});await until(()=>!b.document.getElementById('fantasy-account').hidden);
  b.submit('fantasy-join-form',{invite_code:league.invite_code,team_name:'Team Two'});await until(()=>b.document.getElementById('fantasy-league-title').textContent==='Friends league');assert.equal(b.document.getElementById('fantasy-owner').hidden,true);
  for(const name of ['Pro One','Pro Two']){a.submit('fantasy-athlete-form',{name,team:'Professional Club',position:'QB'});await until(()=>[...a.document.querySelectorAll('#fantasy-athletes h5')].some(n=>n.textContent===name));}
  a.document.querySelector('#fantasy-athletes button').click();await until(()=>/Roster: Team One/.test(a.document.getElementById('fantasy-athletes').textContent));
  b.document.getElementById('fantasy-refresh').click();await until(()=>b.document.querySelectorAll('#fantasy-athletes button').length===1);b.document.querySelector('#fantasy-athletes button').click();await until(()=>/Roster: Team Two/.test(b.document.getElementById('fantasy-athletes').textContent));
  a.document.getElementById('fantasy-start').click();await until(()=>/active/.test(a.document.getElementById('fantasy-league-info').textContent));
  const athlete=(await db.query('select athlete_id from fanyou_fantasy_picks where user_id=$1',[first])).rows[0].athlete_id;
  a.submit('fantasy-score-form',{payload:JSON.stringify({league_id:league.id,rules_version:'fanyou-free-v1',period:'week-1',records:[{athlete_id:athlete,stats:{passing_yards:250},points:10}]})});await until(()=>/10.00/.test(a.document.getElementById('fantasy-standings').textContent));
  b.document.getElementById('fantasy-refresh').click();await until(()=>/10.00/.test(b.document.getElementById('fantasy-standings').textContent));assert.equal(b.document.querySelectorAll('#fantasy-athletes button').length,0);
  a.saved.clear();a.document.dispatchEvent(new a.window.Event('fanyou-session-changed'));assert.equal(a.document.getElementById('fantasy-account').hidden,true);assert.equal(a.document.getElementById('fantasy-invite').textContent,'');
  assert.equal((await db.query("select count(*)as n from information_schema.columns where table_name='fanyou_fantasy_eligibility' and column_name in ('date_of_birth','birth_date')")).rows[0].n,0);
 }finally{await db.close();global.fetch=originalFetch;names.forEach((n,i)=>{if(old[i]===undefined)delete process.env[n];else process.env[n]=old[i];});}
});
