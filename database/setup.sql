-- Run once in a dedicated Fanyou Supabase project. All writes are server-only.
create table public.fanyou_profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 display_name text not null check (char_length(display_name) between 2 and 80),
 role text not null check (role in ('fan','player','coach')),
 school text not null default '', sport text not null default '', bio text not null default '',
 verified boolean not null default false,
 moderation_status text not null default 'pending' check (moderation_status in ('pending','approved','rejected')),
 created_at timestamptz not null default now()
);
create table public.fanyou_customers (
 user_id uuid primary key references auth.users(id) on delete cascade,
 stripe_customer_id text unique not null
);
create table public.fanyou_subscriptions (
 stripe_subscription_id text primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 tier text not null check (tier in ('fan','premier')),
 status text not null,
 paid_through timestamptz not null,
 updated_at timestamptz not null default now()
);
create table public.fanyou_suggestions (
 id uuid primary key default gen_random_uuid(),
 author_id uuid not null references auth.users(id) on delete cascade,
 recipient_id uuid not null references public.fanyou_profiles(id) on delete cascade,
 body text not null check (char_length(body) between 5 and 1500),
 status text not null check (status in ('pending','approved','rejected')),
 screening text not null check (screening in ('manual','openai')),
 created_at timestamptz not null default now()
);
create table public.fanyou_replies (
 id uuid primary key default gen_random_uuid(),
 suggestion_id uuid not null references public.fanyou_suggestions(id) on delete cascade,
 author_id uuid not null references auth.users(id) on delete cascade,
 body text not null check (char_length(body) between 2 and 1500),
 status text not null check (status in ('pending','approved','rejected')),
 screening text not null check (screening in ('manual','openai')),
 created_at timestamptz not null default now()
);
create table public.fanyou_moderation_audit (
 id uuid primary key default gen_random_uuid(), reviewer_id uuid not null references auth.users(id),
 content_type text not null, content_id uuid not null, decision text not null,
 created_at timestamptz not null default now()
);
create index fanyou_monthly_usage on public.fanyou_suggestions(author_id,created_at);
create index fanyou_recipient_inbox on public.fanyou_suggestions(recipient_id,created_at desc);
create index fanyou_reply_thread on public.fanyou_replies(suggestion_id,created_at);
create index fanyou_entitlements on public.fanyou_subscriptions(user_id,status,paid_through);
-- No client policies: browser users cannot bypass the moderation or quota API.
alter table public.fanyou_profiles enable row level security;
alter table public.fanyou_customers enable row level security;
alter table public.fanyou_subscriptions enable row level security;
alter table public.fanyou_suggestions enable row level security;
alter table public.fanyou_replies enable row level security;
alter table public.fanyou_moderation_audit enable row level security;
revoke all on public.fanyou_profiles, public.fanyou_customers, public.fanyou_subscriptions,
 public.fanyou_suggestions, public.fanyou_replies, public.fanyou_moderation_audit from anon,authenticated;
grant all on public.fanyou_profiles, public.fanyou_customers, public.fanyou_subscriptions,
 public.fanyou_suggestions, public.fanyou_replies, public.fanyou_moderation_audit to service_role;

-- Serializes quota checks with insertion. Paid status is read from server-owned rows.
create function public.fanyou_submit_suggestion(p_author uuid,p_recipient uuid,p_body text,p_status text,p_screening text)
returns public.fanyou_suggestions language plpgsql security invoker set search_path = '' as $$
declare result public.fanyou_suggestions; used_count int; is_paid boolean;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_author::text,0));
 if not exists (select 1 from public.fanyou_profiles where id=p_author and moderation_status='approved') then
  raise exception 'PROFILE_REQUIRED';
 end if;
 if not exists (select 1 from public.fanyou_profiles where id=p_recipient and role in ('player','coach') and verified and moderation_status='approved') then
  raise exception 'RECIPIENT_UNAVAILABLE';
 end if;
 select exists(select 1 from public.fanyou_subscriptions where user_id=p_author and status='active' and paid_through>now()) into is_paid;
 select count(*) into used_count from public.fanyou_suggestions where author_id=p_author
  and created_at >= (date_trunc('month',now() at time zone 'UTC') at time zone 'UTC');
 if not is_paid and used_count>=10 then raise exception 'MONTHLY_LIMIT'; end if;
 -- Unlimited is a monthly quota policy, not permission to spam.
 if (select count(*) from public.fanyou_suggestions where author_id=p_author and created_at>now()-interval '1 minute')>=5 then
  raise exception 'RATE_LIMIT';
 end if;
 insert into public.fanyou_suggestions(author_id,recipient_id,body,status,screening)
 values(p_author,p_recipient,p_body,p_status,p_screening) returning * into result;
 return result;
end;
$$;
revoke execute on function public.fanyou_submit_suggestion(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.fanyou_submit_suggestion(uuid,uuid,text,text,text) to service_role;

create function public.fanyou_submit_reply(p_author uuid,p_suggestion uuid,p_body text,p_status text,p_screening text)
returns public.fanyou_replies language plpgsql security invoker set search_path = '' as $$
declare result public.fanyou_replies;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_author::text,0));
 if not exists(select 1 from public.fanyou_suggestions s join public.fanyou_profiles p on p.id=s.recipient_id
   where s.id=p_suggestion and s.recipient_id=p_author and s.status='approved' and p.verified and p.moderation_status='approved') then
  raise exception 'REPLY_FORBIDDEN';
 end if;
 if (select count(*) from public.fanyou_replies where author_id=p_author and created_at>now()-interval '1 minute')>=5 then
  raise exception 'RATE_LIMIT';
 end if;
 insert into public.fanyou_replies(author_id,suggestion_id,body,status,screening)
 values(p_author,p_suggestion,p_body,p_status,p_screening) returning * into result;
 return result;
end;
$$;
revoke execute on function public.fanyou_submit_reply(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.fanyou_submit_reply(uuid,uuid,text,text,text) to service_role;

-- Decisions and audit records commit together.
create function public.fanyou_review(p_reviewer uuid,p_type text,p_id uuid,p_decision text,p_verify boolean default false)
returns void language plpgsql security invoker set search_path = '' as $$
begin
 if p_decision not in ('approved','rejected') then raise exception 'INVALID_DECISION'; end if;
 if p_type='profile' then
  update public.fanyou_profiles set moderation_status=p_decision,verified=(p_verify and p_decision='approved' and role in ('player','coach')) where id=p_id;
 elsif p_type='suggestion' then
  update public.fanyou_suggestions set status=p_decision where id=p_id;
 elsif p_type='reply' then
  update public.fanyou_replies set status=p_decision where id=p_id;
 else raise exception 'INVALID_TYPE'; end if;
 if not found then raise exception 'NOT_FOUND'; end if;
 insert into public.fanyou_moderation_audit(reviewer_id,content_type,content_id,decision) values(p_reviewer,p_type,p_id,p_decision);
end;
$$;
revoke execute on function public.fanyou_review(uuid,text,uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.fanyou_review(uuid,text,uuid,text,boolean) to service_role;

-- Refunds/disputes create persistent holds; routine lifecycle replays cannot restore access.
create table public.fanyou_billing_holds (
 stripe_subscription_id text primary key, reason text not null, created_at timestamptz not null default now()
);
alter table public.fanyou_billing_holds enable row level security;
revoke all on public.fanyou_billing_holds from anon,authenticated;
grant all on public.fanyou_billing_holds to service_role;
create function public.fanyou_sync_subscription(p_subscription text,p_user uuid,p_tier text,p_status text,p_paid_through timestamptz,p_fetched_at timestamptz)
returns void language plpgsql security invoker set search_path = '' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(p_subscription,0));
 if exists(select 1 from public.fanyou_subscriptions where stripe_subscription_id=p_subscription and user_id<>p_user) then raise exception 'OWNERSHIP_MISMATCH'; end if;
 if exists(select 1 from public.fanyou_billing_holds where stripe_subscription_id=p_subscription) then p_status:='restricted'; end if;
 insert into public.fanyou_subscriptions(stripe_subscription_id,user_id,tier,status,paid_through,updated_at)
 values(p_subscription,p_user,p_tier,p_status,p_paid_through,p_fetched_at)
 on conflict(stripe_subscription_id) do update set tier=excluded.tier,status=excluded.status,paid_through=excluded.paid_through,updated_at=excluded.updated_at
 where public.fanyou_subscriptions.updated_at<=excluded.updated_at;
end;
$$;
revoke execute on function public.fanyou_sync_subscription(text,uuid,text,text,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.fanyou_sync_subscription(text,uuid,text,text,timestamptz,timestamptz) to service_role;
create function public.fanyou_hold_subscription(p_subscription text,p_reason text)
returns void language plpgsql security invoker set search_path = '' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(p_subscription,0));
 insert into public.fanyou_billing_holds(stripe_subscription_id,reason) values(p_subscription,p_reason)
 on conflict(stripe_subscription_id) do update set reason=excluded.reason;
 update public.fanyou_subscriptions set status='restricted',updated_at=now() where stripe_subscription_id=p_subscription;
end;
$$;
revoke execute on function public.fanyou_hold_subscription(text,text) from public,anon,authenticated;
grant execute on function public.fanyou_hold_subscription(text,text) to service_role;
