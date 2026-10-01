(() => {
 'use strict';
 const $=id=>document.getElementById(id), status=$('community-status');
 const profileForm=$('community-profile-form');
 let session=null, current=null, config=null, profiles=[];
 try{session=JSON.parse(sessionStorage.getItem('fanyou-session')||'null');}catch{}
 function message(value){status.textContent=value;}
 function storeSession(data){session=data;try{if(data)sessionStorage.setItem('fanyou-session',JSON.stringify(data));else sessionStorage.removeItem('fanyou-session');}catch{}}
 async function api(route,body,requireAuth=true,retry=true){
  const response=await fetch(`/api/${route}`,{method:body?'POST':'GET',headers:{...(body?{'Content-Type':'application/json'}:{}),...(requireAuth&&session?.access_token?{Authorization:`Bearer ${session.access_token}`}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const data=await response.json().catch(()=>({error:'The account service is not available yet.'}));
  if(response.status===401&&requireAuth&&session?.refresh_token&&retry){
   try{storeSession(await api('refresh',{refresh_token:session.refresh_token},false,false));return api(route,body,true,false);}catch{storeSession(null);current=null;authUI();throw new Error('Please sign in again.');}
  }
  if(!response.ok)throw new Error(data.error||'Please try again.');
  return data;
 }
 async function action(button,work){
  const buttons=button?[button]:[];buttons.forEach(b=>b.disabled=true);
  try{await work();}catch(error){message(error.message);}finally{buttons.forEach(b=>b.disabled=false);}
 }
 function paragraph(value,css='text-sm text-slate-400'){const p=document.createElement('p');p.className=css;p.textContent=value;return p;}
 function authUI(){
  $('community-auth').classList.toggle('hidden',Boolean(session));$('community-account').classList.toggle('hidden',!session);
  $('community-admin').classList.toggle('hidden',!current?.admin);
 }
 function profileFields(){
  const active=profileForm.elements.role.value!=='fan';
  profileForm.querySelectorAll('[data-profile-field]').forEach(el=>el.classList.toggle('hidden',!active));
  for(const name of ['school','sport','bio']){profileForm.elements[name].required=active;profileForm.elements[name].disabled=!active;}
 }
 async function loadAccount(){
  if(!session){authUI();return;}
  current=await api('account');authUI();
  $('community-usage').textContent=current.unlimited?`${current.premier?'Premier':'Unlimited Fan'} · Unlimited suggestions · ${current.used} submitted this month`:`Free Fan · ${current.remaining} of 10 suggestions remaining for ${current.month}`;
  const p=current.profile;
  if(p){for(const name of ['display_name','role','school','sport','bio'])profileForm.elements[name].value=p[name]||'';}
  profileForm.elements.role.disabled=Boolean(p);
  profileFields();
  $('community-profile-status').textContent=p?`${p.role} profile · ${p.moderation_status}${p.verified?' · Identity verified':''}`:'Save a Fan profile to start, or submit your Player / Coach / Manager profile for verification.';
  $('community-profile-details').open=!p||p.moderation_status!=='approved';
  const eligible=Boolean(p);
  $('community-points-settings').classList.toggle('hidden',!eligible);
  $('community-points-enabled').checked=Boolean(p?.points_enabled);
  $('community-points-total').textContent=current.score?`${current.score.points} points · ${current.score.rating_count} fan ratings${current.score.average_stars?` · ${current.score.average_stars}/5 stars`:''}`:'Join the table to earn points for approved suggestions (Fans) or approved replies (Players, Coaches, and Managers).';
  await loadInbox();
 }
 async function loadDirectory(){
  const data=await api('profiles',null,false);profiles=data.profiles;
  const directory=$('community-directory');directory.replaceChildren();
  const select=$('community-recipient'), selected=select.value;select.replaceChildren(new Option('Choose a verified profile',''));
  if(!profiles.length)directory.append(paragraph('No verified profiles yet. Players, Coaches, and Managers can create a profile above.'));
  for(const p of profiles){
   const card=document.createElement('article');card.className='bg-slate-950 border border-slate-700 rounded-xl p-4 space-y-2 break-words';
   const title=document.createElement('h4');title.className='font-bold';title.textContent=p.display_name;
   card.append(title,paragraph(`${p.role==='player'?'Player':p.role==='manager'?'Manager':'Coach'} · ${p.school} · ${p.sport}`),paragraph(p.bio),paragraph(p.premier?'Premier · OpenAI content screening':'Basic · Moderator review','text-xs text-indigo-300'));
   if(p.score?.rating_count)card.append(paragraph(`★ ${p.score.average_stars}/5 · ${p.score.rating_count} fan ratings`,'text-sm text-amber-300'));
   if(p.score?.points_enabled)card.append(paragraph(`${p.score.points} interaction points`,'text-sm text-indigo-300'));
   directory.append(card);select.add(new Option(`${p.display_name} — ${p.role}, ${p.school}, ${p.sport}`,p.id));
  }
  if(profiles.some(p=>p.id===selected))select.value=selected;
 }
 async function loadInbox(){
  const {suggestions,user_id}=await api('suggestions');const inbox=$('community-inbox');inbox.replaceChildren();
  if(!suggestions.length)inbox.append(paragraph('Your submitted suggestions and approved incoming suggestions will appear here.'));
  for(const s of suggestions){
   const card=document.createElement('article');card.className='bg-slate-950 border border-slate-700 rounded-xl p-4 space-y-2 break-words';
   const target=profiles.find(p=>p.id===s.recipient_id)?.display_name||'Player / Coach / Manager';
   card.append(paragraph(`${s.author_id===user_id?`To ${target}`:'Incoming fan suggestion'} · ${s.status} · ${new Date(s.created_at).toLocaleDateString()}`,'text-xs text-indigo-300'),paragraph(s.body,'text-sm text-slate-200 whitespace-pre-wrap'));
   for(const r of s.replies){
    card.append(paragraph(`Reply (${r.status}): ${r.body}`,'text-sm text-emerald-300 whitespace-pre-wrap'));
    if(r.stars)card.append(paragraph(`${r.stars} of 5 stars awarded`,'text-sm text-amber-300'));
    if(current?.unlimited&&current?.profile?.role==='fan'&&s.author_id===user_id&&s.status==='approved'&&r.status==='approved'&&r.author_id!==user_id){
     const form=document.createElement('form');form.className='flex flex-wrap gap-2 items-end';form.dataset.starRating=r.id;
     const label=document.createElement('label');label.className='text-sm text-amber-300';label.textContent='Reward this interaction (optional)';
     const select=document.createElement('select');select.className='block mt-1 rounded-lg bg-slate-900 border border-slate-700 p-2';select.required=true;select.append(new Option('Choose 1–5 stars',''));
     for(let n=1;n<=5;n++)select.append(new Option(`${n} ${n===1?'star':'stars'}`,String(n)));
     if(r.stars)select.value=String(r.stars);label.append(select);
     const button=document.createElement('button');button.type='submit';button.textContent=r.stars?'Update stars':'Award stars';button.className='rounded-lg bg-amber-600 px-3 py-2 text-sm';
     form.append(label,button);form.addEventListener('submit',e=>{e.preventDefault();action(button,async()=>{await api('rate-reply',{reply_id:r.id,stars:Number(select.value)});message('Star rating saved.');await loadInbox();await loadDirectory();await loadPoints();});});card.append(form);
    }
   }
   if(s.recipient_id===user_id&&s.status==='approved'){
    const form=document.createElement('form');form.className='space-y-2';const label=document.createElement('label');label.className='block text-sm';label.textContent='Your reply';const input=document.createElement('textarea');input.required=true;input.minLength=2;input.maxLength=1500;input.rows=3;input.className='mt-1 w-full rounded-lg bg-slate-900 border border-slate-700 p-2';label.append(input);
    const button=document.createElement('button');button.type='submit';button.textContent='Submit moderated reply';button.className='rounded-lg bg-indigo-600 px-3 py-2 text-sm';
    form.append(label,button);form.addEventListener('submit',e=>{e.preventDefault();action(button,async()=>{const data=await api('reply',{suggestion_id:s.id,body:input.value});message(`Reply ${data.reply.status==='approved'?'delivered after OpenAI screening':'held for moderator review'}.`);await loadInbox();});});card.append(form);
   }
   inbox.append(card);
  }
 }
 async function loadPoints(){
  const {scores}=await api('points-table',null,false);const rows=$('community-points-rows');rows.replaceChildren();
  $('community-points-empty').textContent=scores.length?'':'No participating profiles yet.';
  for(const score of scores){const row=document.createElement('tr');row.className='border-b border-slate-800';
   for(const value of [`${score.display_name} (${score.role})`,`${score.school} · ${score.sport}`,score.points,score.rating_count?`${score.average_stars}/5`:'No ratings',score.rating_count]){const cell=document.createElement('td');cell.className='p-2 break-words';cell.textContent=String(value);row.append(cell);}rows.append(row);
  }
 }
 async function loadReviews(){
  const queue=await api('review-queue');const list=$('community-review-list');list.replaceChildren();
  for(const [key,type] of [['profiles','profile'],['suggestions','suggestion'],['replies','reply']])for(const item of queue[key]){
   const card=document.createElement('article');card.className='rounded-xl bg-slate-950 border border-slate-700 p-4 space-y-2 break-words';
   card.append(paragraph(`${type} · ${item.id}`,'text-xs text-indigo-300'),paragraph(type==='profile'?`${item.display_name} · ${item.role} · ${item.school} · ${item.sport}\n${item.bio}`:item.body,'text-sm text-slate-200 whitespace-pre-wrap'));
   const verify=document.createElement('input');verify.type='checkbox';
   if(type==='profile'&&item.role!=='fan'){const label=document.createElement('label');label.className='flex gap-2 items-center text-sm';label.append(verify,document.createTextNode('I independently verified this person’s identity and school affiliation.'));card.append(label);}
   for(const decision of ['approved','rejected']){const button=document.createElement('button');button.type='button';button.textContent=decision==='approved'?'Approve':'Reject';button.className='rounded-lg bg-slate-700 px-3 py-2 text-sm mr-2';button.addEventListener('click',()=>action(button,async()=>{await api('review',{type,id:item.id,decision,verify:verify.checked});message('Moderation decision saved.');await loadReviews();await loadDirectory();await loadPoints();}));card.append(button);}
   list.append(card);
  }
  if(!list.children.length)list.append(paragraph('No pending reviews.'));
 }
 $('community-auth-form').addEventListener('submit',e=>{e.preventDefault();const form=e.currentTarget;const route=e.submitter?.value||'login';action(e.submitter,async()=>{const data=await api(route,{email:form.elements.email.value,password:form.elements.password.value},false);form.elements.password.value='';if(data.confirmation_required){message('Check your email to confirm your account, then sign in here.');return;}storeSession(data);await loadAccount();message('Signed in.');});});
 document.querySelectorAll('[data-futbol-profile]').forEach(button=>button.addEventListener('click',()=>{
  const role=button.dataset.futbolProfile;
  if(!config?.ready){message('Futbol profiles are awaiting account activation. Browse teams or add your team on this device.');$('community-status').scrollIntoView({behavior:'smooth'});return;}
  if(!session){message('Create an account or sign in, then choose your Futbol profile.');$('community-auth').scrollIntoView({behavior:'smooth'});return;}
  if(current?.profile&&current.profile.role!==role){message('Your account already has a profile. Contact an administrator to change its role.');return;}
  profileForm.elements.role.value=role;profileFields();$('community-profile-details').open=true;$('community-profile-details').scrollIntoView({behavior:'smooth'});
 }));
 profileForm.elements.role.addEventListener('change',profileFields);
 profileForm.addEventListener('submit',e=>{e.preventDefault();action(e.submitter,async()=>{const body={};for(const name of ['display_name','role','school','sport','bio'])body[name]=profileForm.elements[name].value;const data=await api('profile',body);await loadAccount();await loadDirectory();message(data.profile.role==='fan'?'Fan profile saved.':'Profile submitted for moderation and identity verification.');});});
 $('community-suggestion-form').addEventListener('submit',e=>{e.preventDefault();const form=e.currentTarget;action(e.submitter,async()=>{const data=await api('suggestions',{recipient_id:form.elements.recipient_id.value,body:form.elements.body.value});form.elements.body.value='';await loadAccount();message(data.suggestion.status==='approved'?'Suggestion delivered after OpenAI screening.':'Suggestion held for moderator review.');});});
 document.querySelectorAll('[data-buy]').forEach(button=>button.addEventListener('click',()=>action(button,async()=>{if(!session){message('Create an account or sign in before subscribing.');$('community-auth').scrollIntoView({behavior:'smooth'});return;}const [tier,interval]=button.dataset.buy.split(':');const {url}=await api('checkout',{tier,interval});if(new URL(url).hostname!=='checkout.stripe.com')throw new Error('Unexpected checkout address.');window.location.assign(url);}))); 
 $('community-billing').addEventListener('click',e=>action(e.currentTarget,async()=>{const {url}=await api('portal',{});if(new URL(url).hostname!=='billing.stripe.com')throw new Error('Unexpected billing address.');window.location.assign(url);}));
 $('community-logout').addEventListener('click',e=>action(e.currentTarget,async()=>{try{await api('logout',{});}finally{storeSession(null);current=null;authUI();$('community-inbox').replaceChildren();message('Signed out.');}}));
 $('community-points-save').addEventListener('click',e=>action(e.currentTarget,async()=>{await api('points-settings',{enabled:$('community-points-enabled').checked});await loadAccount();await loadDirectory();await loadPoints();message(current?.profile?.role==='fan'&&current?.profile?.moderation_status==='pending'?'Points preference saved. Your public display name is awaiting moderator review.':'Points preference saved.');}));
 $('community-refresh').addEventListener('click',e=>action(e.currentTarget,async()=>{await loadAccount();await loadDirectory();await loadPoints();}));
 $('community-review-refresh').addEventListener('click',e=>action(e.currentTarget,loadReviews));
 profileFields();authUI();
 (async()=>{try{config=await api('config',null,false);if(!config.ready){message('Accounts and suggestions are coming soon. Paid checkout will open after activation.');document.querySelectorAll('#fan-community button').forEach(b=>b.disabled=true);return;}await loadDirectory();await loadPoints();await loadAccount();if(!config.billing)message('Free accounts are available. Paid checkout is awaiting activation.');const billing=new URLSearchParams(location.search).get('billing');if(billing==='success')message('Checkout received. Paid access appears after payment confirmation; use Refresh to check.');if(billing==='cancelled')message('Checkout cancelled. Your free membership remains available.');}catch(error){message(error.message);}})();
})();
