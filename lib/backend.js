import {HttpError,entitlement,monthStart,id} from './core.js';
export function configured() { return Boolean(process.env.SUPABASE_URL&&process.env.SUPABASE_PUBLISHABLE_KEY&&process.env.SUPABASE_SERVICE_ROLE_KEY); }
export async function db(path,{method='GET',body,prefer}={}) {
 if(!configured()) throw new HttpError(503,'Accounts and suggestions are awaiting backend activation.');
 const response=await fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`,{method,headers:{apikey:process.env.SUPABASE_SERVICE_ROLE_KEY,Authorization:`Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,'Content-Type':'application/json',...(prefer?{Prefer:prefer}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(12000)});
 const data=await response.json().catch(()=>null);
 if(!response.ok){
  const message=data?.message||'';
  if(message.includes('MONTHLY_LIMIT')) throw new HttpError(429,'You have used your 10 free suggestions this month. Upgrade for unlimited suggestions.');
  if(message.includes('RATE_LIMIT')) throw new HttpError(429,'Please wait a minute before posting again.');
  if(message.includes('RECIPIENT_UNAVAILABLE')) throw new HttpError(400,'Choose an approved Player or Coach profile.');
  if(message.includes('PROFILE_REQUIRED')) throw new HttpError(403,'Create your account profile first.');
  if(message.includes('REPLY_FORBIDDEN')) throw new HttpError(403,'Only the verified recipient can reply to this suggestion.');
  if(message.includes('NOT_FOUND')) throw new HttpError(404,'Record not found.');
  throw new HttpError(503,'The account service is temporarily unavailable.');
 }
 return data;
}
export async function auth(req) {
 if(!configured()) throw new HttpError(503,'Accounts are awaiting backend activation.');
 const token=req.headers.authorization?.match(/^Bearer ([A-Za-z0-9_.-]+)$/)?.[1];
 if(!token) throw new HttpError(401,'Please sign in first.');
 const response=await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`,{headers:{apikey:process.env.SUPABASE_PUBLISHABLE_KEY,Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(10000)});
 if(!response.ok) throw new HttpError(401,'Your session expired. Please sign in again.');
 const user=await response.json();
 if(!user.email_confirmed_at||user.is_anonymous) throw new HttpError(403,'Please verify your email before posting.');
 id(user.id); return user;
}
export async function subscription(userId) {
 return entitlement(await db(`fanyou_subscriptions?user_id=eq.${id(userId)}&select=tier,status,paid_through`));
}
export async function account(userId) {
 const [profiles,access,usage]=await Promise.all([db(`fanyou_profiles?id=eq.${id(userId)}&select=*`),subscription(userId),db(`fanyou_suggestions?author_id=eq.${id(userId)}&created_at=gte.${encodeURIComponent(monthStart())}&select=id`)]);
 return {profile:profiles[0]||null,...access,used:usage.length,remaining:access.unlimited?null:Math.max(0,10-usage.length),month:monthStart().slice(0,7)};
}
export async function ownProfile(userId) { return (await db(`fanyou_profiles?id=eq.${id(userId)}&select=*`))[0]; }
