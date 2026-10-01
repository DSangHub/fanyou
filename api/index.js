import {HttpError,text,id,screen,basicCheck} from '../lib/core.js';
import {configured,db,auth,account,subscription,ownProfile} from '../lib/backend.js';
import {checkout,portal,webhook,appUrl} from '../lib/billing.js';
export const config={api:{bodyParser:false}};
async function rawBody(req,limit=32768) {
 let size=0;const chunks=[];
 for await(const chunk of req){const buffer=Buffer.from(chunk);size+=buffer.length;if(size>limit) throw new HttpError(413,'Request is too large.');chunks.push(buffer);}
 return Buffer.concat(chunks);
}
function admin(user){ if(user.app_metadata?.fanyou_admin!==true) throw new HttpError(403,'Moderator access is required.'); }
async function authAction(route,body){
 if(!configured())throw new HttpError(503,'Accounts are awaiting backend activation.');
 const email=text(body.email,3,254),password=body.password;
 if(typeof password!=='string'||password.length<8||password.length>128)throw new HttpError(400,'Password must have 8 to 128 characters.');
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new HttpError(400,'Enter a valid email address.');
 const path=route==='signup'?`signup?redirect_to=${encodeURIComponent(appUrl())}`:'token?grant_type=password';
 const response=await fetch(`${process.env.SUPABASE_URL}/auth/v1/${path}`,{method:'POST',headers:{apikey:process.env.SUPABASE_PUBLISHABLE_KEY,'Content-Type':'application/json'},body:JSON.stringify({email,password}),signal:AbortSignal.timeout(12000)});
 const data=await response.json();
 if(!response.ok)throw new HttpError(400,route==='signup'?'Unable to create an account. Check your email and password or try signing in.':'Unable to sign in. Check your details and verify your email.');
 return {access_token:data.access_token||null,refresh_token:data.refresh_token||null,expires_in:data.expires_in||null,confirmation_required:!data.access_token};
}
export async function dispatch(route,req,body){
 if(route==='config'&&req.method==='GET')return {ready:configured(),billing:configured()&&process.env.BILLING_ENABLED==='true'&&Boolean(process.env.STRIPE_SECRET_KEY&&process.env.STRIPE_WEBHOOK_SECRET),moderation:configured()&&Boolean(process.env.OPENAI_API_KEY)};
 if(['login','signup'].includes(route)&&req.method==='POST')return authAction(route,body);
 if(route==='refresh'&&req.method==='POST'){
  if(!configured())throw new HttpError(503,'Accounts are awaiting activation.');
  const response=await fetch(`${process.env.SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`,{method:'POST',headers:{apikey:process.env.SUPABASE_PUBLISHABLE_KEY,'Content-Type':'application/json'},body:JSON.stringify({refresh_token:text(body.refresh_token,10,4096)}),signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw new HttpError(401,'Please sign in again.');
  const data=await response.json();return {access_token:data.access_token,refresh_token:data.refresh_token,expires_in:data.expires_in};
 }
 if(route==='points-table'&&req.method==='GET'){
  return {scores:await db('fanyou_profile_scores?points_enabled=eq.true&select=*&order=points.desc,display_name.asc&limit=100')};
 }
 if(route==='profiles'&&req.method==='GET'){
  const rows=await db('fanyou_profiles?verified=eq.true&moderation_status=eq.approved&role=in.(player,coach)&select=id,display_name,role,school,sport,bio&order=display_name&limit=100');
  const access=rows.length?await db(`fanyou_subscriptions?user_id=in.(${rows.map(p=>id(p.id)).join(',')})&tier=eq.premier&status=eq.active&paid_through=gt.${encodeURIComponent(new Date().toISOString())}&select=user_id`):[];
  const premier=new Set(access.map(s=>s.user_id));const scores=rows.length?await db(`fanyou_profile_scores?profile_id=in.(${rows.map(p=>p.id).join(',')})&select=profile_id,points_enabled,points,rating_count,average_stars`):[];
  return {profiles:rows.map(p=>({...p,premier:premier.has(p.id),score:scores.find(s=>s.profile_id===p.id)||null}))};
 }
 const user=await auth(req);
 if(route==='logout'&&req.method==='POST'){
  await fetch(`${process.env.SUPABASE_URL}/auth/v1/logout`,{method:'POST',headers:{apikey:process.env.SUPABASE_PUBLISHABLE_KEY,Authorization:req.headers.authorization},signal:AbortSignal.timeout(10000)});
  return {signed_out:true};
 }
 if(route==='account'&&req.method==='GET')return {...await account(user.id),admin:user.app_metadata?.fanyou_admin===true};
 if(route==='points-settings'&&req.method==='POST'){
  if(typeof body.enabled!=='boolean')throw new HttpError(400,'Choose whether to participate in points.');
  const profile=await ownProfile(user.id);
  if(!profile||!['player','coach'].includes(profile.role))throw new HttpError(403,'Points participation is for Player and Coach profiles.');
  await db(`fanyou_profiles?id=eq.${user.id}`,{method:'PATCH',body:{points_enabled:body.enabled},prefer:'return=minimal'});
  return {points_enabled:body.enabled};
 }
 if(route==='rate-reply'&&req.method==='POST'){
  if(!Number.isInteger(body.stars)||body.stars<1||body.stars>5)throw new HttpError(400,'Choose a whole number from 1 to 5 stars.');
  const rating=await db('rpc/fanyou_rate_reply',{method:'POST',body:{p_fan:user.id,p_reply:id(body.reply_id),p_stars:body.stars}});
  return {rating:Array.isArray(rating)?rating[0]:rating};
 }
 if(route==='profile'&&req.method==='POST'){
  const role=body.role;if(!['fan','player','coach'].includes(role))throw new HttpError(400,'Select Fan, Player, or Coach.');
  const display_name=text(body.display_name,2,80);
  const school=role==='fan'?'':text(body.school,2,100),sport=role==='fan'?'':text(body.sport,2,60),bio=role==='fan'?'':text(body.bio,5,600);
  const previous=await ownProfile(user.id);
  if(previous&&previous.role!==role)throw new HttpError(409,'Ask an administrator to change your profile role.');
  await screen([display_name,school,sport,bio].join('\n'),(await subscription(user.id)).premier);
  // Fan names are private to their inbox. Claimed Player/Coach identities always require human verification.
  const profile={id:user.id,display_name,role,school,sport,bio,verified:false,moderation_status:role==='fan'?'approved':'pending'};
  await db('fanyou_profiles?on_conflict=id',{method:'POST',body:profile,prefer:'resolution=merge-duplicates,return=minimal'});
  return {profile};
 }
 if(route==='suggestions'&&req.method==='POST'){
  const author=await ownProfile(user.id);if(!author||author.moderation_status!=='approved')throw new HttpError(403,'Create your profile and wait for verification if required.');
  const recipient=id(body.recipient_id);
  const target=(await db(`fanyou_profiles?id=eq.${recipient}&verified=eq.true&moderation_status=eq.approved&role=in.(player,coach)&select=id`))[0];
  if(!target)throw new HttpError(400,'Choose a verified Player or Coach.');
  const message=text(body.body,5,1500);
  const moderation=await screen(message,(await subscription(recipient)).premier);
  const result=await db('rpc/fanyou_submit_suggestion',{method:'POST',body:{p_author:user.id,p_recipient:recipient,p_body:message,p_status:moderation.status,p_screening:moderation.screening}});
  return {suggestion:Array.isArray(result)?result[0]:result};
 }
 if(route==='suggestions'&&req.method==='GET'){
  const suggestions=await db(`fanyou_suggestions?or=(author_id.eq.${user.id},and(recipient_id.eq.${user.id},status.eq.approved))&select=*&order=created_at.desc&limit=100`);
  const replies=suggestions.length?await db(`fanyou_replies?suggestion_id=in.(${suggestions.map(s=>id(s.id)).join(',')})&or=(status.eq.approved,author_id.eq.${user.id})&select=id,suggestion_id,body,status,created_at,author_id&order=created_at.asc&limit=500`):[];
  const ratings=replies.length?await db(`fanyou_star_ratings?reply_id=in.(${replies.map(r=>id(r.id)).join(',')})&select=reply_id,stars`):[];
  return {suggestions:suggestions.map(s=>({...s,replies:replies.filter(r=>r.suggestion_id===s.id).map(r=>({...r,stars:ratings.find(v=>v.reply_id===r.id)?.stars||null}))})),user_id:user.id};
 }
 if(route==='reply'&&req.method==='POST'){
  const suggestion=id(body.suggestion_id),message=text(body.body,2,1500);
  const owned=(await db(`fanyou_suggestions?id=eq.${suggestion}&recipient_id=eq.${user.id}&status=eq.approved&select=id`))[0];
  const profile=await ownProfile(user.id);
  if(!owned||!profile?.verified||profile.moderation_status!=='approved')throw new HttpError(403,'Only the verified recipient can reply.');
  const moderation=await screen(message,(await subscription(user.id)).premier);
  const result=await db('rpc/fanyou_submit_reply',{method:'POST',body:{p_author:user.id,p_suggestion:suggestion,p_body:message,p_status:moderation.status,p_screening:moderation.screening}});
  return {reply:Array.isArray(result)?result[0]:result};
 }
 if(route==='checkout'&&req.method==='POST')return checkout(user,body);
 if(route==='portal'&&req.method==='POST')return portal(user);
 if(route==='review-queue'&&req.method==='GET'){
  admin(user);const [profiles,suggestions,replies]=await Promise.all([db('fanyou_profiles?role=in.(player,coach)&moderation_status=eq.pending&select=*&limit=100'),db('fanyou_suggestions?status=eq.pending&select=*&order=created_at&limit=100'),db('fanyou_replies?status=eq.pending&select=*&order=created_at&limit=100')]);
  return {profiles,suggestions,replies};
 }
 if(route==='review'&&req.method==='POST'){
  admin(user);const contentId=id(body.id),type=body.type,decision=body.decision;
  const tables={profile:'fanyou_profiles',suggestion:'fanyou_suggestions',reply:'fanyou_replies'};
  if(!tables[type]||!['approved','rejected'].includes(decision))throw new HttpError(400,'Invalid moderation decision.');
  const record=(await db(`${tables[type]}?id=eq.${contentId}&select=*`))[0];if(!record)throw new HttpError(404,'Record not found.');
  if(decision==='approved'){
   const content=type==='profile'?[record.display_name,record.school,record.sport,record.bio].join('\n'):record.body;
   basicCheck(content);
   const recipient=type==='suggestion'?record.recipient_id:record.author_id||record.id;
   if((await subscription(recipient)).premier){const check=await screen(content,true);if(check.status!=='approved')throw new HttpError(503,'OpenAI screening must succeed before Premier content can be approved.');}
   if(type==='profile'&&body.verify!==true)throw new HttpError(400,'Confirm that you independently verified the Player or Coach identity.');
  }
  await db('rpc/fanyou_review',{method:'POST',body:{p_reviewer:user.id,p_type:type,p_id:contentId,p_decision:decision,p_verify:type==='profile'&&body.verify===true}});
  return {reviewed:true};
 }
 throw new HttpError(404,'Endpoint not found.');
}
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
 try{
  const url=new URL(req.url,'http://localhost');
  const route=req.query?.route||url.searchParams.get('route')||url.pathname.replace(/^\/api\/?/,'');
  const origin=req.headers.origin;
  if(req.method!=='GET'&&route!=='webhook'&&origin&&origin!==appUrl())throw new HttpError(403,'Request origin is not allowed.');
  if(!['GET','POST'].includes(req.method))throw new HttpError(405,'Method not allowed.');
  let result;
  if(route==='webhook'){
   if(req.method!=='POST')throw new HttpError(405,'Method not allowed.');
   result=await webhook(await rawBody(req,262144),req.headers['stripe-signature']);
  }else{
   let body={};if(req.method==='POST'){
    if(!req.headers['content-type']?.includes('application/json'))throw new HttpError(415,'Use JSON content.');
    try{body=JSON.parse((await rawBody(req)).toString('utf8'));}catch(e){if(e instanceof HttpError)throw e;throw new HttpError(400,'Invalid JSON.');}
    if(!body||typeof body!=='object'||Array.isArray(body))throw new HttpError(400,'Invalid request.');
   }
   result=await dispatch(route,req,body);
  }
  res.statusCode=200;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));
 }catch(error){res.statusCode=error instanceof HttpError?error.status:500;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:error instanceof HttpError?error.message:'Service temporarily unavailable.'}));}
}
