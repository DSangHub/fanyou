import {HttpError, id, text, basicCheck} from './core.js';
import {db} from './backend.js';
import rules from '../fantasy/rules.json' with {type:'json'};
export {rules};
export function ageBand(value, now=new Date()) {
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))throw new HttpError(400,'Enter a valid date of birth.');
 const birth=new Date(`${value}T00:00:00Z`);
 if(!Number.isFinite(birth.getTime())||birth.toISOString().slice(0,10)!==value||birth>now||birth.getUTCFullYear()<1900)throw new HttpError(400,'Enter a valid date of birth.');
 const birthdayPassed=now.getUTCMonth()>birth.getUTCMonth()||(now.getUTCMonth()===birth.getUTCMonth()&&now.getUTCDate()>=birth.getUTCDate());
 const age=now.getUTCFullYear()-birth.getUTCFullYear()-(birthdayPassed?0:1);
 if(age<13)throw new HttpError(403,'Fantasy leagues are for ages 13 and older.');
 return age<18?'13-17':'18+';
}
export function fantasyPoints(sport, stats) {
 const weights=Object.hasOwn(rules.sports,sport)?rules.sports[sport]:null;
 if(!weights||!stats||typeof stats!=='object'||Array.isArray(stats))throw new HttpError(400,'Select a supported sport and provide statistics.');
 let hundredths=0;
 for(const [key,value] of Object.entries(stats)){
  if(!Object.hasOwn(weights,key)||typeof value!=='number'||!Number.isFinite(value)||!Number.isInteger(value)||value<0||value>100000)throw new HttpError(400,'Statistics must be supported nonnegative whole numbers up to 100000.');
  hundredths+=Math.round(weights[key]*100)*value;
 }
 if(Math.abs(hundredths)>1000000000)throw new HttpError(400,'Score is outside the permitted range.');
 return hundredths/100;
}
const clean=(value,min,max)=>{const result=text(value,min,max);basicCheck(result);return result;};
const integer=(value,min,max)=>{if(!Number.isInteger(value)||value<min||value>max)throw new HttpError(400,`Choose a whole number between ${min} and ${max}.`);return value;};
async function rpc(action,user,data={}){return db('rpc/fanyou_fantasy_action',{method:'POST',body:{p_action:action,p_user:user.id,p_data:data}});}
export async function fantasyDispatch(route,req,body,user){
 if(process.env.FANTASY_ENABLED!=='true')throw new HttpError(503,'Fantasy leagues are awaiting activation.');
 if(route==='fantasy-age'&&req.method==='POST'){
  if(body.accept_rules!==true)throw new HttpError(400,'Accept the free fantasy rules.');
  // Discard DOB after calculating eligibility; never persist or return it.
  return rpc('enroll',user,{age_band:ageBand(body.date_of_birth)});
 }
 if(route==='fantasy-leagues'&&req.method==='GET')return rpc('list',user);
 if(route==='fantasy-create'&&req.method==='POST'){
  const sport=body.sport;if(!Object.hasOwn(rules.sports,sport))throw new HttpError(400,'Select a supported sport.');
  if(Object.hasOwn(body,'entry_fee')||Object.hasOwn(body,'prize')||Object.hasOwn(body,'wager'))throw new HttpError(400,'Only free leagues without wagers or prizes are supported.');
  return rpc('create',user,{name:clean(body.name,3,60),team_name:clean(body.team_name,2,40),sport,capacity:integer(body.capacity,2,20),roster_size:integer(body.roster_size,1,10)});
 }
 if(route==='fantasy-join'&&req.method==='POST')return rpc('join',user,{invite_code:id(body.invite_code),team_name:clean(body.team_name,2,40)});
 if(route==='fantasy-league'&&req.method==='POST'){const result=await rpc('detail',user,{league_id:id(body.league_id)});return {...result,scoring_rules:rules.sports[result.league.sport]};}
 if(route==='fantasy-athlete'&&req.method==='POST')return rpc('athlete',user,{league_id:id(body.league_id),name:clean(body.name,2,80),team:clean(body.team,2,80),position:clean(body.position,1,40)});
 if(route==='fantasy-pick'&&req.method==='POST')return rpc('pick',user,{league_id:id(body.league_id),athlete_id:id(body.athlete_id)});
 if(route==='fantasy-start'&&req.method==='POST')return rpc('start',user,{league_id:id(body.league_id)});
 if(route==='fantasy-close'&&req.method==='POST')return rpc('close',user,{league_id:id(body.league_id)});
 if(route==='fantasy-scores'&&req.method==='POST'){
  const leagueId=id(body.league_id);
  const detail=await rpc('detail',user,{league_id:leagueId});
  if(detail.league.owner_id!==user.id)throw new HttpError(403,'Only the commissioner can publish stats.');
  const period=text(body.period,1,24);if(!/^[A-Za-z0-9_-]+$/.test(period))throw new HttpError(400,'Use letters, numbers, hyphens or underscores for the period.');
  if(body.rules_version!==rules.version||!Array.isArray(body.records)||body.records.length<1||body.records.length>100)throw new HttpError(400,'Provide 1–100 score records using the current rules version.');
  const seen=new Set();const records=body.records.map(record=>{
   if(!record||typeof record!=='object')throw new HttpError(400,'Invalid score record.');
   const athlete_id=id(record.athlete_id);if(seen.has(athlete_id))throw new HttpError(400,'Duplicate athlete score.');seen.add(athlete_id);
   const points=fantasyPoints(detail.league.sport,record.stats);
   if(record.points!==undefined&&record.points!==points)throw new HttpError(400,'Points do not match the published scoring rules.');
   return {athlete_id,stats:record.stats,points};
  });
  return rpc('scores',user,{league_id:leagueId,period,records});
 }
 throw new HttpError(404,'Fantasy endpoint not found.');
}
