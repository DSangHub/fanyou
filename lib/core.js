export class HttpError extends Error { constructor(status,message) { super(message); this.status=status; } }
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function id(value) { if(typeof value!=='string'||!UUID.test(value)) throw new HttpError(400,'Invalid record ID.'); return value; }
export function text(value,min,max) {
 if(typeof value!=='string') throw new HttpError(400,'Please complete all required fields.');
 const result=value.normalize('NFKC').trim();
 if(result.length<min||result.length>max) throw new HttpError(400,`Text must be between ${min} and ${max} characters.`);
 return result;
}
export function monthStart(now=new Date()) { return new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1)).toISOString(); }
export function entitlement(rows,now=new Date()) {
 const active=rows.filter(s=>s.status==='active' && new Date(s.paid_through)>now);
 return {unlimited:active.length>0,premier:active.some(s=>s.tier==='premier')};
}
export function basicCheck(input) {
 const normalized=input.normalize('NFKC').toLowerCase().replace(/[\u200B-\u200D\uFEFF]/g,'');
 if(/\b(fuck\w*|shit\w*|bitch\w*|asshole\w*|cunt\w*|nigg\w*|faggot\w*)\b/i.test(normalized)) throw new HttpError(422,'Please remove profanity or abusive language.');
 if(/https?:\/\/|www\.|\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b|(?:\+?\d[\s().-]*){10,}/i.test(normalized)) throw new HttpError(422,'Please remove links and private contact information.');
 if(/\b(kill yourself|kill you|hurt you|rape you|your home address|shoot you)\b/i.test(normalized)) throw new HttpError(422,'Threats and harassment are not allowed.');
}
export function resultSafe(result) {
 const required=['harassment','harassment/threatening','hate','hate/threatening','sexual','sexual/minors','violence','violence/graphic','self-harm','self-harm/intent','self-harm/instructions'];
 if(!result||typeof result.flagged!=='boolean'||!result.category_scores||!result.categories) return false;
 if(result.flagged||Object.values(result.categories).some(Boolean)) return false;
 return required.every(k=>typeof result.category_scores[k]==='number' && Number.isFinite(result.category_scores[k]) && result.category_scores[k] < (k==='sexual/minors'||k.endsWith('threatening') ? 0.01 : 0.1));
}
export async function screen(input,premier,{key=process.env.OPENAI_API_KEY,fetcher=fetch}={}) {
 basicCheck(input);
 if(!premier) return {status:'pending',screening:'manual'};
 if(!key) return {status:'pending',screening:'manual'};
 try {
  const response=await fetcher('https://api.openai.com/v1/moderations',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({model:'omni-moderation-latest',input}),signal:AbortSignal.timeout(12000)});
  if(!response.ok) return {status:'pending',screening:'manual'};
  const data=await response.json(); const result=data.results?.[0];
  if(!result||typeof result.flagged!=='boolean'||!result.category_scores||!result.categories) return {status:'pending',screening:'manual'};
  if(!resultSafe(result)) throw new HttpError(422,'This content did not pass strict moderation. Please revise it.');
  return {status:'approved',screening:'openai'};
 } catch(error) {
  if(error instanceof HttpError) throw error;
  return {status:'pending',screening:'manual'};
 }
}
export function plan(tier,interval,env=process.env) {
 if(!['fan','premier'].includes(tier)||!['month','year'].includes(interval)) throw new HttpError(400,'Select a valid membership.');
 const prefix=tier==='fan'?'STRIPE_FAN':'STRIPE_PREMIER';
 const price=env[`${prefix}_${interval==='month'?'MONTHLY':'ANNUAL'}_PRICE_ID`];
 if(!price) throw new HttpError(503,'This membership is not available for checkout yet.');
 return {price,amount:interval==='month'?1000:9900,tier,interval};
}
export function validPrice(price,selection) {
 return price.active && price.currency==='usd' && price.unit_amount===selection.amount && price.recurring?.interval===selection.interval && price.recurring?.interval_count===1 && price.type==='recurring';
}
