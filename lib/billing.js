import Stripe from 'stripe';
import {randomBytes} from 'node:crypto';
import {HttpError,plan,validPrice,id} from './core.js';
import {db,subscription,ownProfile} from './backend.js';
export function stripeClient() { if(!process.env.STRIPE_SECRET_KEY) throw new HttpError(503,'Billing is awaiting activation.'); return new Stripe(process.env.STRIPE_SECRET_KEY,{apiVersion:'2026-08-26.dahlia',timeout:10000,maxNetworkRetries:1}); }
export function appUrl() { const url=new URL(process.env.APP_URL||'http://localhost:3000'); if(process.env.NODE_ENV==='production'&&url.protocol!=='https:') throw new HttpError(503,'Secure application URL is not configured.'); return url.origin; }
export async function checkout(user,body) {
 if(process.env.BILLING_ENABLED!=='true'||!process.env.STRIPE_WEBHOOK_SECRET) throw new HttpError(503,'Paid memberships are awaiting activation.');
 const selection=plan(body.tier,body.interval);
 if((await subscription(user.id)).unlimited) throw new HttpError(409,'You already have a paid membership. Manage it from Billing.');
 if(selection.tier==='premier') {
  const profile=await ownProfile(user.id);
  if(!profile||!['player','coach'].includes(profile.role)||!profile.verified||profile.moderation_status!=='approved') throw new HttpError(403,'Your Player or Coach profile must be verified before subscribing to Premier.');
 }
 const stripe=stripeClient(); const price=await stripe.prices.retrieve(selection.price);
 if(!validPrice(price,selection)) throw new HttpError(503,'Membership price configuration needs review.');
 const existing=(await db(`fanyou_customers?user_id=eq.${user.id}&select=stripe_customer_id`))[0];
 let customer=existing?.stripe_customer_id;
 if(!customer){
  customer=(await stripe.customers.create({email:user.email},{idempotencyKey:`fanyou-customer-${user.id}`})).id;
  await db('fanyou_customers?on_conflict=user_id',{method:'POST',body:{user_id:user.id,stripe_customer_id:customer},prefer:'resolution=merge-duplicates,return=minimal'});
 }
 const open=await stripe.checkout.sessions.list({customer,status:'open',limit:10});
 if(open.data.some(s=>s.metadata?.app==='fanyou')) throw new HttpError(409,'A checkout is already open. Complete it or wait for it to expire before starting another.');
 const suffix=[...randomBytes(8)].map(n=>String.fromCharCode(97+n%26)).join('');
 const session=await stripe.checkout.sessions.create({customer,mode:'subscription',line_items:[{price:selection.price,quantity:1}],subscription_data:{metadata:{app:'fanyou',tier:selection.tier}},metadata:{app:'fanyou'},success_url:`${appUrl()}/?billing=success#fan-community`,cancel_url:`${appUrl()}/?billing=cancelled#fan-community`,integration_identifier:`fanyou_${suffix}`},{idempotencyKey:`fanyou-checkout-${user.id}-${selection.price}-${Math.floor(Date.now()/60000)}`});
 return {url:session.url};
}
export async function portal(user) {
 const customer=(await db(`fanyou_customers?user_id=eq.${user.id}&select=stripe_customer_id`))[0];
 if(!customer) throw new HttpError(404,'No billing account yet.');
 return {url:(await stripeClient().billingPortal.sessions.create({customer:customer.stripe_customer_id,return_url:`${appUrl()}/#fan-community`})).url};
}
export async function synchronize(stripe,subId) {
 // Retrieve current state so delayed or replayed webhook events cannot restore old access.
 const fetchedAt=new Date().toISOString();
 const sub=await stripe.subscriptions.retrieve(subId,{expand:['items.data.price','latest_invoice']});
 const existing=(await db(`fanyou_subscriptions?stripe_subscription_id=eq.${encodeURIComponent(sub.id)}&select=user_id`))[0];
 if(sub.metadata?.app!=='fanyou'&&!existing) return;
 const customerId=typeof sub.customer==='string'?sub.customer:sub.customer.id;
 const owner=(await db(`fanyou_customers?stripe_customer_id=eq.${encodeURIComponent(customerId)}&select=user_id`))[0];
 if(!owner) throw new HttpError(503,'Subscription owner is not available yet.');
 if(existing&&existing.user_id!==owner.user_id) throw new HttpError(503,'Subscription ownership mismatch.');
 const item=sub.items.data[0]; let authorized=false;
 for(const tier of ['fan','premier'])for(const interval of ['month','year']) {
  let choice;try{choice=plan(tier,interval);}catch{continue;}
  if(sub.items.data.length===1&&item?.price?.id===choice.price&&sub.metadata.tier===tier&&item.quantity===1&&validPrice(item.price,choice)) authorized=true;
 }
 if(sub.metadata.tier==='premier'){
  const profile=await ownProfile(owner.user_id);
  if(!profile||!['player','coach'].includes(profile.role)||!profile.verified||profile.moderation_status!=='approved')authorized=false;
 }
 const invoice=sub.latest_invoice;
 const paid=invoice&&typeof invoice==='object'&&invoice.status==='paid';
 const paidThrough=item?.current_period_end||sub.current_period_end||0;
 await db('rpc/fanyou_sync_subscription',{method:'POST',body:{p_subscription:sub.id,p_user:id(owner.user_id),p_tier:sub.metadata.tier==='premier'?'premier':'fan',p_status:authorized&&paid&&!sub.pause_collection?sub.status:'inactive',p_paid_through:new Date(paidThrough*1000).toISOString(),p_fetched_at:fetchedAt}});
}
export async function riskEvent(stripe,event) {
 const object=event.data.object;
 // Partial refunds retain membership; a full refund, dispute or fraud warning puts it on hold.
 if(event.type==='charge.refunded'&&!object.refunded)return;
 let paymentIntent=typeof object.payment_intent==='string'?object.payment_intent:object.payment_intent?.id;
 if(!paymentIntent&&object.charge){const charge=await stripe.charges.retrieve(typeof object.charge==='string'?object.charge:object.charge.id);paymentIntent=typeof charge.payment_intent==='string'?charge.payment_intent:charge.payment_intent?.id;}
 if(!paymentIntent)return;
 const payments=stripe.invoicePayments.list({payment:{type:'payment_intent',payment_intent:paymentIntent},status:'paid',limit:100});
 for await(const payment of payments){
  const invoice=await stripe.invoices.retrieve(typeof payment.invoice==='string'?payment.invoice:payment.invoice.id);
  const subscription=invoice.parent?.type==='subscription_details'?invoice.parent.subscription_details.subscription:null;
  const subId=typeof subscription==='string'?subscription:subscription?.id;if(!subId)continue;
  const sub=await stripe.subscriptions.retrieve(subId);
  const owned=(await db(`fanyou_subscriptions?stripe_subscription_id=eq.${encodeURIComponent(subId)}&select=user_id`))[0];
  if(sub.metadata?.app!=='fanyou'&&!owned)continue;
  await db('rpc/fanyou_hold_subscription',{method:'POST',body:{p_subscription:subId,p_reason:event.type}});
  await synchronize(stripe,subId);
 }
}
export async function webhook(raw,signature) {
 if(!process.env.STRIPE_WEBHOOK_SECRET) throw new HttpError(503,'Webhook is awaiting activation.');
 const stripe=stripeClient();let event;
 try{event=stripe.webhooks.constructEvent(raw,signature,process.env.STRIPE_WEBHOOK_SECRET);}catch{throw new HttpError(400,'Invalid webhook signature.');}
 if(['charge.refunded','charge.dispute.created','radar.early_fraud_warning.created'].includes(event.type)){await riskEvent(stripe,event);return {received:true};}
 const object=event.data.object; let subId;
 if(event.type.startsWith('customer.subscription.')) subId=object.id;
 if(['checkout.session.completed','checkout.session.async_payment_succeeded'].includes(event.type)&&object.payment_status==='paid') subId=typeof object.subscription==='string'?object.subscription:object.subscription?.id;
 if(['invoice.paid','invoice.payment_failed'].includes(event.type))subId=object.parent?.subscription_details?.subscription||object.subscription;
 if(typeof subId==='object') subId=subId?.id;
 if(subId) await synchronize(stripe,subId);
 return {received:true};
}
