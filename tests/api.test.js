import test from 'node:test';import assert from 'node:assert/strict';import {Readable} from 'node:stream';import handler,{dispatch} from '../api/index.js';import {auth} from '../lib/backend.js';
function request(method,path,body,headers={}){const req=Readable.from(body?[JSON.stringify(body)]:[]);req.method=method;req.url=path;req.headers=headers;return req;}
async function run(req){let output;const res={setHeader(){},end(v){output=JSON.parse(v);},statusCode:0};await handler(req,res);return {status:res.statusCode,body:output};}
test('unconfigured features fail closed without collecting data or payment',async()=>{assert.equal((await run(request('GET','/api/config'))).body.ready,false);const result=await run(request('POST','/api/checkout',{tier:'fan',interval:'month'},{'content-type':'application/json'}));assert.equal(result.status,503);assert.match(result.body.error,/activation/);});
test('malformed JSON, oversize input and unsafe origins are rejected',async()=>{let req=Readable.from(['not json']);Object.assign(req,{method:'POST',url:'/api/login',headers:{'content-type':'application/json'}});assert.equal((await run(req)).status,400);req=request('POST','/api/login',{email:'x'.repeat(40000)},{'content-type':'application/json'});assert.equal((await run(req)).status,413);assert.equal((await run(request('POST','/api/signup',{}, {'content-type':'application/json',origin:'https://attacker.example'}))).status,403);});
test('webhook rejects requests when signing secret is missing',async()=>{const result=await run(request('POST','/api/webhook',{}));assert.equal(result.status,503);});
test('auth validates email and user with Supabase instead of trusting JWT claims',async()=>{const previous={fetch:global.fetch,url:process.env.SUPABASE_URL,pub:process.env.SUPABASE_PUBLISHABLE_KEY,service:process.env.SUPABASE_SERVICE_ROLE_KEY};try{process.env.SUPABASE_URL='https://example.supabase.co';process.env.SUPABASE_PUBLISHABLE_KEY='test';process.env.SUPABASE_SERVICE_ROLE_KEY='test';global.fetch=async()=>({ok:true,json:async()=>({id:'11111111-1111-4111-8111-111111111111',is_anonymous:false,email_confirmed_at:null,app_metadata:{fanyou_admin:true}})});await assert.rejects(auth({headers:{authorization:'Bearer fake.jwt.value'}}),/verify your email/);global.fetch=async()=>({ok:false});await assert.rejects(auth({headers:{authorization:'Bearer fake.jwt.value'}}),/session expired/);}finally{global.fetch=previous.fetch;for(const [name,value] of [['SUPABASE_URL',previous.url],['SUPABASE_PUBLISHABLE_KEY',previous.pub],['SUPABASE_SERVICE_ROLE_KEY',previous.service]])if(value===undefined)delete process.env[name];else process.env[name]=value;}});
test('Fans joining the public points table require display-name review',async()=>{
 const originalFetch=global.fetch;const names=['SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY','SUPABASE_SERVICE_ROLE_KEY'];const previous=names.map(n=>process.env[n]);
 try{
 process.env.SUPABASE_URL='https://example.supabase.co';process.env.SUPABASE_PUBLISHABLE_KEY='test';process.env.SUPABASE_SERVICE_ROLE_KEY='test';let changed;
 global.fetch=async(url,options={})=>{
  if(url.includes('/auth/v1/user'))return {ok:true,json:async()=>({id:'11111111-1111-4111-8111-111111111111',email_confirmed_at:'2026-10-01',is_anonymous:false})};
  if(options.method==='PATCH'){changed=JSON.parse(options.body);return {ok:true,json:async()=>null};}
  return {ok:true,json:async()=>[{role:'fan',points_enabled:false,moderation_status:'approved'}]};
 };
 await dispatch('points-settings',{method:'POST',headers:{authorization:'Bearer fake.jwt'}},{enabled:true});assert.deepEqual(changed,{points_enabled:true,moderation_status:'pending'});
 await dispatch('points-settings',{method:'POST',headers:{authorization:'Bearer fake.jwt'}},{enabled:false});assert.deepEqual(changed,{points_enabled:false,moderation_status:'approved'});
 }finally{global.fetch=originalFetch;names.forEach((name,i)=>{if(previous[i]===undefined)delete process.env[name];else process.env[name]=previous[i];});}
});
test('Player profiles require Position and edits clear verification; optional bio needs no extra field',async()=>{
 const priorFetch=global.fetch,names=['SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY','SUPABASE_SERVICE_ROLE_KEY'],prior=names.map(n=>process.env[n]);let saved;
 try{
 process.env.SUPABASE_URL='https://example.supabase.co';process.env.SUPABASE_PUBLISHABLE_KEY='test';process.env.SUPABASE_SERVICE_ROLE_KEY='test';
 global.fetch=async(url,options={})=>{
  if(url.includes('/auth/v1/user'))return {ok:true,json:async()=>({id:'11111111-1111-4111-8111-111111111111',email_confirmed_at:'2026-10-01',is_anonymous:false})};
  if(options.method==='POST'){saved=JSON.parse(options.body);return {ok:true,json:async()=>null};}
  return {ok:true,json:async()=>url.includes('fanyou_profiles')?[{role:'player',verified:true,moderation_status:'approved'}]:[]};
 };
 const req={method:'POST',headers:{authorization:'Bearer token'}};
 const fields={role:'player',display_name:'Alex Smith',school:'Test School',sport:'Football'};
 await assert.rejects(dispatch('profile',req,fields),/required fields/);
 await assert.rejects(dispatch('profile',req,{...fields,position:'x'.repeat(81)}));
 const response=await dispatch('profile',req,{...fields,position:'Quarterback',verified:true,moderation_status:'approved'});
 assert.equal(response.profile.position,'Quarterback');assert.equal(saved.bio,'');assert.equal(saved.verified,false);assert.equal(saved.moderation_status,'pending');
 await assert.rejects(dispatch('profile',req,{...fields,position:'https://spam.example'}),/links/);
 }finally{global.fetch=priorFetch;names.forEach((n,i)=>{if(prior[i]===undefined)delete process.env[n];else process.env[n]=prior[i]});}
});
test('Game Tracker validates and screens all fields, tags only verified Players and uses the shared quota RPC',async()=>{
 const originalFetch=global.fetch,names=['SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY','SUPABASE_SERVICE_ROLE_KEY'],prior=names.map(n=>process.env[n]);let rpc,available=true;
 try{
 process.env.SUPABASE_URL='https://example.supabase.co';process.env.SUPABASE_PUBLISHABLE_KEY='test';process.env.SUPABASE_SERVICE_ROLE_KEY='test';
 global.fetch=async(url,options={})=>{
  if(url.includes('/auth/v1/user'))return {ok:true,json:async()=>({id:'11111111-1111-4111-8111-111111111111',email_confirmed_at:'2026-10-01',is_anonymous:false})};
  if(url.includes('rpc/fanyou_submit_suggestion')){rpc=JSON.parse(options.body);return {ok:true,json:async()=>[{id:'saved',body:rpc.p_body,status:rpc.p_status}]};}
  if(url.includes('verified=eq.true')){assert.match(url,/role=eq.player/);return {ok:true,json:async()=>available?[{id:'22222222-2222-4222-8222-222222222222'}]:[]};}
  return {ok:true,json:async()=>url.includes('fanyou_profiles')?[{role:'fan',moderation_status:'approved'}]:[]};
 };
 const req={method:'POST',headers:{authorization:'Bearer token'}},body={game:'Friday football',opponent:'Visiting team',comment:'How did you prepare for the game?',recipient_id:'22222222-2222-4222-8222-222222222222'};
 const result=await dispatch('game-comments',req,body);assert.equal(result.suggestion.status,'pending');assert.equal(rpc.p_recipient,body.recipient_id);assert.equal(rpc.p_body,`Game: ${body.game}\nOpponent: ${body.opponent}\nComment: ${body.comment}`);
 for(const field of ['game','opponent','comment'])await assert.rejects(dispatch('game-comments',req,{...body,[field]:''}));
 await assert.rejects(dispatch('game-comments',req,{...body,game:'https://spam.example'}),/links/);
 available=false;await assert.rejects(dispatch('game-comments',req,body),/verified Player/);
 }finally{global.fetch=originalFetch;names.forEach((n,i)=>{if(prior[i]===undefined)delete process.env[n];else process.env[n]=prior[i]});}
});
