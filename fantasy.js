(() => {
 'use strict';
 const $=id=>document.getElementById(id), status=$('fantasy-status');
 let enabled=false, currentId=null, detail=null, epoch=0;
 function session(){try{return JSON.parse(sessionStorage.getItem('fanyou-session')||'null');}catch{return null;}}
 function message(value){status.textContent=value;}
 function hideDetails(){$('fantasy-detail').hidden=true;$('fantasy-athletes').replaceChildren();$('fantasy-standings').replaceChildren();$('fantasy-invite').textContent='';detail=null;}
 async function api(route,body){
  const token=session()?.access_token;if(!token)throw Error('Sign in or create an account in the Fan Suggestion Box, then continue here.');
  const r=await fetch(`/api/${route}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const data=await r.json();if(!r.ok)throw Error(data.error||'Fantasy service unavailable.');return data;
 }
 async function action(button,work){
  const turn=epoch;if(button)button.disabled=true;
  try{await work();}catch(error){if(turn===epoch)message(error.message);}finally{if(button)button.disabled=false;}
 }
 function node(tag,value,css=''){const n=document.createElement(tag);n.textContent=value;n.className=css;return n;}
 function button(label,work){const b=node('button',label,'rounded-lg bg-indigo-600 px-3 py-2 text-sm');b.type='button';b.addEventListener('click',()=>action(b,work));return b;}
 async function refresh(){
  const turn=epoch;if(!enabled)return;
  $('fantasy-account').hidden=true;hideDetails();$('fantasy-list').replaceChildren();
  if(!session()){currentId=null;$('fantasy-age-form').hidden=false;message('Check your age, then sign in to create or join a free league.');return;}
  const data=await api('fantasy-leagues');if(turn!==epoch)return;
  $('fantasy-age-form').hidden=data.eligible;$('fantasy-account').hidden=!data.eligible;
  if(!data.eligible){message('Complete your age eligibility check to continue.');return;}
  data.leagues.forEach(l=>$('fantasy-list').append(button(`${l.name} · ${l.sport} · ${l.state}`,()=>openLeague(l.id))));
  message(data.leagues.length?'Your private leagues are ready.':'Create a league or join with a private invite code.');
  if(currentId&&data.leagues.some(l=>l.id===currentId))await openLeague(currentId);
 }
 async function openLeague(leagueId){
  const turn=epoch;const data=await api('fantasy-league',{league_id:leagueId});if(turn!==epoch)return;
  currentId=leagueId;detail=data;
  $('fantasy-detail').hidden=false;
  $('fantasy-league-title').textContent=data.league.name;
  $('fantasy-league-info').textContent=`${data.league.sport} · ${data.league.state} · ${data.members.length}/${data.league.capacity} teams · ${data.league.roster_size} players per roster · ${data.league.rules_version}`;
  const owner=data.league.owner_id===data.user_id;
  $('fantasy-owner').hidden=!owner;
  $('fantasy-invite').textContent=owner?`Private invite: ${data.league.invite_code} · League ID for scoring: ${data.league.id}`:'';
  $('fantasy-athlete-form').hidden=data.league.state!=='draft';$('fantasy-start').hidden=data.league.state!=='draft';$('fantasy-score-form').hidden=data.league.state!=='active';$('fantasy-close').hidden=data.league.state==='closed';
  $('fantasy-rules').textContent=Object.entries(data.scoring_rules).map(([key,value])=>`${key}: ${value} points`).join('\n')+'\nUnlisted stats do not score. Stats use whole numbers; baseball innings are supplied as pitching_outs. All periods count equally; no playoffs or automatic schedule.';
  const totals=new Map(data.members.map(m=>[m.user_id,0]));
  data.picks.forEach(p=>{const points=data.scores.filter(s=>s.athlete_id===p.athlete_id).reduce((sum,s)=>sum+Math.round(Number(s.points)*100),0);totals.set(p.user_id,totals.get(p.user_id)+points);});
  const sorted=[...data.members].sort((a,b)=>totals.get(b.user_id)-totals.get(a.user_id)||a.team_name.localeCompare(b.team_name));
  const table=document.createElement('table');table.className='w-full text-left text-sm';
  const caption=node('caption','League standings · Commissioner-entered stats','text-left text-slate-400 mb-2');table.append(caption);
  const head=document.createElement('thead'),hr=document.createElement('tr');['Rank','Team nickname','Roster','Fantasy points'].forEach(label=>{const cell=node('th',label,'p-2');cell.scope='col';hr.append(cell);});head.append(hr);table.append(head);
  const body=document.createElement('tbody');let last=null,rank=0;
  sorted.forEach((m,index)=>{const score=totals.get(m.user_id);if(score!==last)rank=index+1;last=score;const row=document.createElement('tr');[rank,`${m.team_name}${m.user_id===data.user_id?' (you)':''}`,`${data.picks.filter(p=>p.user_id===m.user_id).length}/${data.league.roster_size}`,(score/100).toFixed(2)].forEach(value=>row.append(node('td',value,'p-2 border-t border-slate-700 break-words')));body.append(row);});table.append(body);$('fantasy-standings').replaceChildren(table);
  const pool=$('fantasy-athletes');pool.replaceChildren();
  const mine=data.picks.filter(p=>p.user_id===data.user_id).length;
  data.athletes.forEach(a=>{
   const card=document.createElement('article');card.className='bg-slate-950 rounded-lg p-3 space-y-2 break-words';card.append(node('h5',a.name,'font-bold'),node('p',`${a.team} · ${a.position}`,'text-sm text-slate-400'));
   if(owner)card.append(node('p',`Player ID: ${a.id}`,'text-xs text-slate-400 break-all'));
   const pick=data.picks.find(p=>p.athlete_id===a.id);
   if(pick)card.append(node('p',`Roster: ${data.members.find(m=>m.user_id===pick.user_id)?.team_name||'Team'}`,'text-sm text-emerald-300'));
   else if(data.league.state==='draft'&&mine<data.league.roster_size)card.append(button('Pick player',async()=>{await api('fantasy-pick',{league_id:leagueId,athlete_id:a.id});if(turn===epoch){await openLeague(leagueId);message('Player added to your roster.');}}));
   pool.append(card);
  });
  if(!data.athletes.length)pool.append(node('p','The commissioner can add professional players before rosters are picked.','text-sm text-slate-400'));
 }
 const age=$('fantasy-age-form');age.elements.date_of_birth.max=new Date().toISOString().slice(0,10);
 age.addEventListener('submit',event=>{event.preventDefault();action(event.submitter,async()=>{
  const value=age.elements.date_of_birth.value;
  const now=new Date(),born=new Date(`${value}T00:00:00Z`);
  if(!value||!Number.isFinite(born.getTime())||born.toISOString().slice(0,10)!==value||born>now)throw Error('Enter a valid date of birth.');
  const ageYears=now.getUTCFullYear()-born.getUTCFullYear()-((now.getUTCMonth()<born.getUTCMonth()||(now.getUTCMonth()===born.getUTCMonth()&&now.getUTCDate()<born.getUTCDate()))?1:0);
  if(ageYears<13){age.elements.date_of_birth.value='';throw Error('Fantasy leagues are for ages 13 and older. Do not create a fantasy account.');}
  const turn=epoch;await api('fantasy-age',{date_of_birth:value,accept_rules:age.elements.accept_rules.checked});age.elements.date_of_birth.value='';if(turn===epoch)await refresh();
 });});
 for(const kind of ['create','join','athlete']){
  const form=$(`fantasy-${kind}-form`);
  form.addEventListener('submit',event=>{event.preventDefault();action(event.submitter,async()=>{
   const turn=epoch;const payload={};for(const el of form.querySelectorAll('[name]'))payload[el.name]=el.type==='number'?Number(el.value):el.value;
   if(kind==='athlete')payload.league_id=currentId;
   const result=await api(`fantasy-${kind}`,payload);if(turn!==epoch)return;
   if(result.league_id)currentId=result.league_id;
   if(kind==='athlete'){for(const el of form.querySelectorAll('input'))el.value='';await openLeague(currentId);message('Professional player added to the pool.');}else await refresh();
  });});
 }
 $('fantasy-score-form').addEventListener('submit',event=>{event.preventDefault();action(event.submitter,async()=>{
  const turn=epoch;let payload;try{payload=JSON.parse(event.currentTarget.elements.payload.value);}catch{throw Error('Paste valid scoring JSON.');}
  if(!payload||payload.league_id!==currentId)throw Error('The scoring JSON must identify this league.');
  const result=await api('fantasy-scores',payload);if(turn===epoch){await openLeague(currentId);message(`${result.updated} score records published. Reimports replace the same player and period.`);}
 });});
 $('fantasy-start').addEventListener('click',event=>action(event.currentTarget,async()=>{const turn=epoch;await api('fantasy-start',{league_id:currentId});if(turn===epoch){await refresh();message('League started. Rosters are locked.');}}));
 $('fantasy-close').addEventListener('click',event=>{if(!window.confirm('Close this league permanently? New picks and scoring updates will stop.'))return;action(event.currentTarget,async()=>{const turn=epoch;await api('fantasy-close',{league_id:currentId});if(turn===epoch)await refresh();});});
 $('fantasy-refresh').addEventListener('click',event=>action(event.currentTarget,refresh));
 document.addEventListener('fanyou-session-changed',()=>{epoch++;currentId=null;hideDetails();$('fantasy-account').hidden=true;action(null,refresh);});
 (async()=>{try{const response=await fetch('/api/config');const config=await response.json();enabled=config.fantasy===true;if(!enabled){message('Free fantasy leagues are coming soon. League creation will open after activation.');return;}await refresh();}catch{message('Fantasy leagues are temporarily unavailable.');}})();
})();
