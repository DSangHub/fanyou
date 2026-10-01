import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {PGlite} from '@electric-sql/pglite';import {parseHTML} from 'linkedom';import vm from 'node:vm';
const fan='11111111-1111-4111-8111-111111111111',manager='22222222-2222-4222-8222-222222222222';
test('Managers receive moderated suggestions, earn reply points, and receive paid Fan stars; opted-in Fans earn suggestion points',async()=>{
 const db=new PGlite();try{
 await db.exec('create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key)');
 for(const file of ['setup.sql','points-stars.sql','futbol.sql'])await db.exec(await readFile(new URL(`../database/${file}`,import.meta.url),'utf8'));
 await db.query('insert into auth.users values ($1),($2)',[fan,manager]);
 await db.query(`insert into fanyou_profiles(id,display_name,role,verified,moderation_status,points_enabled)values($1,'Fan','fan',false,'approved',true),($2,'Manager','manager',false,'pending',true)`,[fan,manager]);
 const submit=()=>db.query(`select * from fanyou_submit_suggestion($1,$2,'Please improve passing drills','pending','manual')`,[fan,manager]);
 await assert.rejects(submit(),/RECIPIENT_UNAVAILABLE/);
 await db.query(`select fanyou_review($1,'profile',$2,'approved',true)`,[fan,manager]);
 assert.equal((await db.query('select verified from fanyou_profiles where id=$1',[manager])).rows[0].verified,true);
 const sid=(await submit()).rows[0].id;
 const points=async uid=>Number((await db.query('select points from fanyou_profile_scores where profile_id=$1',[uid])).rows[0].points);
 assert.equal(await points(fan),0);
 await db.query(`update fanyou_suggestions set status='approved' where id=$1`,[sid]);assert.equal(await points(fan),10);
 await db.query(`update fanyou_suggestions set status='approved' where id=$1`,[sid]);assert.equal(await points(fan),10);
 const rid=(await db.query(`select * from fanyou_submit_reply($1,$2,'We will add more passing drills','approved','openai')`,[manager,sid])).rows[0].id;assert.equal(await points(manager),10);
 await db.query(`insert into fanyou_subscriptions values('sub_fan',$1,'fan','active',now()+interval '1 month',now())`,[fan]);
 await db.query('select fanyou_rate_reply($1,$2,5)',[fan,rid]);assert.equal(Number((await db.query('select average_stars from fanyou_profile_scores where profile_id=$1',[manager])).rows[0].average_stars),5);
 await db.query(`update fanyou_suggestions set status='rejected' where id=$1`,[sid]);assert.equal(await points(fan),0);assert.equal(await points(manager),0);
 await db.query(`update fanyou_suggestions set status='approved' where id=$1`,[sid]);assert.equal(await points(fan),10);assert.equal(await points(manager),10);
 await db.query(`update fanyou_profiles set points_enabled=false where id=$1`,[fan]);assert.equal((await db.query('select * from fanyou_profile_scores where profile_id=$1 and points_enabled=true',[fan])).rows.length,0);
 await db.exec('set role authenticated');await assert.rejects(db.query('select * from fanyou_fan_points'),/permission denied/);
 }finally{await db.close();}
});
test('Futbol team directory lists professional starter clubs, filters regions, adds school/college/professional teams and preserves old teams',async()=>{
 const html=await readFile(new URL('../index.html',import.meta.url),'utf8'),script=await readFile(new URL('../teams.js',import.meta.url),'utf8');
 const {window,document}=parseHTML(html),saved=new Map();
 const legacy={id:'old',school:'Existing High School',mascot:'Tigers',sport:'Basketball',level:'High School',category:'Boys',division:'Varsity',city:'Fresno',region:'CA',followed:true};saved.set('fanyou-school-teams-v1',JSON.stringify([legacy]));
 const form=document.getElementById('team-form');form.elements={};for(const el of form.querySelectorAll('[name]'))form.elements[el.name]=el;form.reportValidity=()=>true;
 for(const select of document.querySelectorAll('select')){Object.defineProperty(select,'value',{get(){return this._value??this.querySelector('option')?.getAttribute('value')??this.querySelector('option')?.textContent??'';},set(value){this._value=value;}});select.add=o=>select.append(o);}
 function Option(label,value){const el=document.createElement('option');el.textContent=label;el.setAttribute('value',value);return el;}
 vm.runInNewContext(script,{document,window,Event:window.Event,Option,crypto:{randomUUID:()=>`new-${Math.random()}`},localStorage:{getItem:k=>saved.get(k),setItem:(k,v)=>saved.set(k,v)}});
 assert.equal(document.querySelectorAll('#team-list article').length,5);
 const area=document.getElementById('team-area-filter');area.value='South America';area.dispatchEvent(new window.Event('change'));assert.equal(document.querySelectorAll('#team-list article').length,2);
 for(const level of ['School','College','Professional']){
  const set=(k,v)=>form.elements[k].value=v;set('school',`${level} Futbol Team`);set('mascot','');set('level',level);form.elements.level.dispatchEvent(new window.Event('change'));set('sport','Soccer');set('city','Test City');set('region','Argentina');set('area','South America');form.dispatchEvent(new window.Event('submit',{cancelable:true}));
  assert.equal(document.querySelectorAll('#team-list article').length,level==='Professional'?3:1);assert.match(document.getElementById('team-list').textContent,/Futbol Team/);
 }
 const teams=JSON.parse(saved.get('fanyou-school-teams-v1'));assert.ok(teams.some(t=>t.id==='old'));assert.equal(teams.filter(t=>t.sport==='Soccer').length,7);
 assert.ok(document.querySelector('[data-futbol-profile="manager"]'));assert.match(document.getElementById('futbol').textContent,/Conditions apply/);
});
