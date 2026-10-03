import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseHTML} from 'linkedom';
import vm from 'node:vm';

test('Sports bar opens level choices, follows data teams, writes in custom sports and preserves Futbol languages',async()=>{
 const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
 const {window,document}=parseHTML(html);const store=new Map();
 const form=document.getElementById('team-form');form.elements={};for(const el of form.querySelectorAll('[name]'))form.elements[el.name]=el;form.reportValidity=()=>true;
 for(const el of document.querySelectorAll('*')){el.focus=()=>{};el.scrollIntoView=()=>{};}
 for(const select of document.querySelectorAll('select')){Object.defineProperty(select,'value',{get(){return this._value??this.querySelector('option')?.getAttribute('value')??this.querySelector('option')?.textContent??'';},set(value){this._value=value;}});select.add=o=>select.append(o);}
 function Option(label,value){const el=document.createElement('option');el.textContent=label;el.setAttribute('value',value);return el;}
 const context={document,Event:window.Event,Option,crypto:{randomUUID:()=>`new-${Math.random()}`},localStorage:{getItem:k=>store.get(k),setItem:(k,v)=>store.set(k,v)}};
 vm.runInNewContext(await readFile(new URL('../teams.js',import.meta.url),'utf8'),context);
 vm.runInNewContext(await readFile(new URL('../futbol-languages.js',import.meta.url),'utf8'),context);
 const panel=document.getElementById('sport-team-picker');
 for(const sport of ['Football','Baseball','Basketball','Ice Hockey','Soccer']){
  const nav=document.querySelector(`[data-sport-nav="${sport}"]`);nav.click();assert.equal(panel.hidden,false);assert.equal(nav.getAttribute('aria-expanded'),'true');
  assert.equal(document.getElementById('team-level-filter').value,'High School');assert.equal(document.getElementById('sport-team-choice').querySelectorAll('option').length,1);assert.equal(document.getElementById('sport-team-follow').disabled,true);
  document.querySelector('[data-picker-level="Professional"]').click();
  const choice=document.getElementById('sport-team-choice');assert.ok(choice.querySelectorAll('option').length>1);
  const id=choice.querySelectorAll('option')[1].value;choice.value=id;choice.dispatchEvent(new window.Event('change'));
  document.getElementById('sport-team-follow').click();assert.equal(JSON.parse(store.get('fanyou-school-teams-v1')).find(t=>t.id===id).followed,true);
 }
 document.getElementById('sport-picker-language').click();assert.equal(document.getElementById('futbol-languages').hidden,false);
 const select=document.getElementById('futbol-language');select.value='es';select.dispatchEvent(new window.Event('change'));assert.equal(document.getElementById('futbol').lang,'es');
 document.querySelector('[data-sport-nav="Football"]').click();document.querySelector('[data-picker-level="College"]').click();assert.match(document.getElementById('sport-team-choice').textContent,/Fresno State/);
 document.getElementById('sport-team-write').click();assert.equal(form.elements.level.value,'College');assert.equal(form.elements.sport.value,'Football');assert.equal(document.getElementById('team-write-in').open,true);
 document.querySelector('[data-sport-nav="Other"]').click();const custom=document.getElementById('sport-custom-name');custom.value='Cricket';custom.dispatchEvent(new window.Event('input'));
 document.querySelector('[data-picker-level="High School"]').click();document.getElementById('sport-team-write').click();assert.equal(form.elements.sport.value,'Other');assert.equal(form.elements.otherSport.value,'Cricket');assert.equal(form.elements.otherSport.required,true);
 form.elements.school.value='<img src=x> School';form.elements.mascot.value='';form.elements.city.value='Fresno';form.elements.region.value='CA';form.elements.area.value='Other';form.dispatchEvent(new window.Event('submit',{cancelable:true}));
 assert.ok(JSON.parse(store.get('fanyou-school-teams-v1')).some(t=>t.sport==='Cricket'&&t.level==='High School'));assert.equal(document.querySelectorAll('#team-list img').length,0);assert.match(document.getElementById('sport-team-choice').textContent,/School/);
 document.getElementById('sport-picker-close').click();assert.equal(panel.hidden,true);assert.ok([...document.querySelectorAll('[data-sport-nav]')].every(b=>b.getAttribute('aria-expanded')==='false'));
 assert.doesNotMatch(html,/chat-box|chat-input|sendChat|setSubscription|votePoll|appState|FanPulse|view-arch|1,250/);
});
