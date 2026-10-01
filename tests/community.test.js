import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import vm from 'node:vm';import {parseHTML} from 'linkedom';
const flush=()=>new Promise(resolve=>setImmediate(resolve));
async function boot(ready){
 const html=await readFile(new URL('../index.html',import.meta.url),'utf8'),script=await readFile(new URL('../community.js',import.meta.url),'utf8');
 const {window,document}=parseHTML(html),store=new Map(),calls=[];
 for(const form of document.querySelectorAll('form')){form.elements={};for(const el of form.querySelectorAll('[name]'))form.elements[el.name]=el;}
 for(const select of document.querySelectorAll('select')){Object.defineProperty(select,'value',{get(){return this._value??this.querySelector('option')?.getAttribute('value')??this.querySelector('option')?.textContent??'';},set(value){this._value=value;}});select.add=o=>select.append(o);}
 function Option(label,value){const el=document.createElement('option');el.textContent=label;el.setAttribute('value',value);return el;}
 const uid='11111111-1111-4111-8111-111111111111',coach='22222222-2222-4222-8222-222222222222';let profile=null,suggestions=[];
 const fetch=async(url,options={})=>{
  const route=url.split('/').at(-1),body=options.body?JSON.parse(options.body):{};calls.push({route,body});let data;
  if(route==='config')data={ready,billing:false,moderation:false};
  if(route==='profiles')data={profiles:[{id:coach,display_name:'<img src=x onerror=alert(1)>',role:'coach',school:'Test School',sport:'Soccer',bio:'Coaching soccer.',premier:false}]};
  if(route==='login')data={access_token:'fake.jwt',refresh_token:'refresh-token'};
  if(route==='profile'){profile={id:uid,...body,moderation_status:body.role==='fan'?'approved':'pending',verified:false};data={profile};}
  if(route==='account')data={profile,unlimited:false,premier:false,used:suggestions.length,remaining:10-suggestions.length,month:'2026-10',admin:false};
  if(route==='suggestions'&&options.method==='POST'){const suggestion={id:coach,author_id:uid,recipient_id:body.recipient_id,body:body.body,status:'pending',created_at:'2026-10-01T00:00:00Z',replies:[]};suggestions.push(suggestion);data={suggestion};}
  if(route==='suggestions'&&!options.body)data={suggestions,user_id:uid};
  if(route==='logout')data={signed_out:true};
  return {ok:true,status:200,json:async()=>data};
 };
 vm.runInNewContext(script,{document,window,Option,fetch,sessionStorage:{getItem:k=>store.get(k),setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)},location:{search:''},URL,URLSearchParams});await flush();
 function submit(form,action='login'){const event=new window.Event('submit',{cancelable:true});Object.defineProperty(event,'submitter',{value:{value:action,disabled:false}});form.dispatchEvent(event);}
 return {document,window,calls,submit};
}
test('without account configuration, posting and payment controls are disabled',async()=>{const {document}=await boot(false);assert.match(document.getElementById('community-status').textContent,/coming soon/);assert.ok([...document.querySelectorAll('#fan-community button')].every(b=>b.disabled));});
test('account, profile, pending suggestion and usage UI work; user content renders as text',async()=>{
 const {document,submit,calls}=await boot(true);assert.equal(document.querySelectorAll('#community-directory img').length,0);
 const login=document.getElementById('community-auth-form');login.elements.email.value='test@example.org';login.elements.password.value='examplePassword';submit(login);await flush();
 assert.equal(document.getElementById('community-account').classList.contains('hidden'),false);
 const profile=document.getElementById('community-profile-form');profile.elements.display_name.value='Fan Name';profile.elements.role.value='fan';submit(profile);await flush();assert.match(document.getElementById('community-profile-status').textContent,/approved/);
 const form=document.getElementById('community-suggestion-form');form.elements.recipient_id.value='22222222-2222-4222-8222-222222222222';form.elements.body.value='<img src=x> Improve passing drills';submit(form);await flush();
 assert.match(document.getElementById('community-status').textContent,/held for moderator review/);
 assert.match(document.getElementById('community-usage').textContent,/9 of 10/);assert.equal(document.querySelectorAll('#community-inbox img').length,0);
 assert.equal(calls.filter(c=>c.route==='suggestions'&&c.body.body).length,1);
 document.getElementById('community-logout').click();await flush();assert.equal(document.getElementById('community-account').classList.contains('hidden'),true);
});
