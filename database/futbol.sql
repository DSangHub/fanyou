-- Apply once after setup.sql and points-stars.sql. Existing data and opt-in defaults are preserved.
alter table public.fanyou_profiles drop constraint fanyou_profiles_role_check;
alter table public.fanyou_profiles add constraint fanyou_profiles_role_check check(role in ('fan','player','coach','manager'));

create or replace function public.fanyou_submit_suggestion(p_author uuid,p_recipient uuid,p_body text,p_status text,p_screening text)
returns public.fanyou_suggestions language plpgsql security invoker set search_path = '' as $$
declare result public.fanyou_suggestions; used_count int; is_paid boolean;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_author::text,0));
 if not exists (select 1 from public.fanyou_profiles where id=p_author and moderation_status='approved') then
  raise exception 'PROFILE_REQUIRED';
 end if;
 if not exists (select 1 from public.fanyou_profiles where id=p_recipient and role in ('player','coach','manager') and verified and moderation_status='approved') then
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

create or replace function public.fanyou_award_reply_points()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.status<>'approved' then
  delete from public.fanyou_interaction_points where reply_id=new.id;
 elsif (tg_op='INSERT' or old.status<>'approved') and exists (
  select 1 from public.fanyou_profiles p join public.fanyou_suggestions s on s.recipient_id=p.id
   where p.id=new.author_id and p.role in ('player','coach','manager') and p.verified
    and p.moderation_status='approved' and p.points_enabled and s.id=new.suggestion_id
    and s.status='approved' and s.author_id<>new.author_id
 ) then
  insert into public.fanyou_interaction_points(reply_id,profile_id) values(new.id,new.author_id)
  on conflict(reply_id) do nothing;
 end if;
 return new;
end;
$$;

create or replace function public.fanyou_rate_reply(p_fan uuid,p_reply uuid,p_stars int)
returns public.fanyou_star_ratings language plpgsql security invoker set search_path='' as $$
declare result public.fanyou_star_ratings; interaction public.fanyou_replies;
begin
 if p_stars is null or p_stars<1 or p_stars>5 then raise exception 'INVALID_STARS'; end if;
 if not exists(select 1 from public.fanyou_profiles where id=p_fan and role='fan' and moderation_status='approved') then
  raise exception 'FAN_REQUIRED';
 end if;
 if not exists(select 1 from public.fanyou_subscriptions where user_id=p_fan and tier='fan' and status='active' and paid_through>now()) then
  raise exception 'PAID_FAN_REQUIRED';
 end if;
 select * into interaction from public.fanyou_replies where id=p_reply for update;
 if not found or interaction.status<>'approved' or interaction.author_id=p_fan then raise exception 'RATING_FORBIDDEN'; end if;
 if not exists(select 1 from public.fanyou_suggestions s join public.fanyou_profiles p on p.id=s.recipient_id
  where s.id=interaction.suggestion_id and s.author_id=p_fan and s.status='approved'
   and p.id=interaction.author_id and p.role in ('player','coach','manager') and p.verified and p.moderation_status='approved') then
  raise exception 'RATING_FORBIDDEN';
 end if;
 insert into public.fanyou_star_ratings(reply_id,fan_id,stars) values(p_reply,p_fan,p_stars)
 on conflict(reply_id) do update set stars=excluded.stars,updated_at=now()
 where public.fanyou_star_ratings.fan_id=p_fan returning * into result;
 if result.reply_id is null then raise exception 'RATING_FORBIDDEN'; end if;
 return result;
end;
$$;

create table public.fanyou_fan_points (
 suggestion_id uuid primary key references public.fanyou_suggestions(id) on delete cascade,
 profile_id uuid not null references public.fanyou_profiles(id) on delete cascade,
 points int not null default 10 check(points=10), created_at timestamptz not null default now()
);
create index fanyou_fan_points_profile on public.fanyou_fan_points(profile_id);
alter table public.fanyou_fan_points enable row level security;
revoke all on public.fanyou_fan_points from anon,authenticated;
grant all on public.fanyou_fan_points to service_role;
create function public.fanyou_award_fan_points()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.status<>'approved' then delete from public.fanyou_fan_points where suggestion_id=new.id;
 elsif (tg_op='INSERT' or old.status<>'approved') and new.author_id<>new.recipient_id and exists(
  select 1 from public.fanyou_profiles where id=new.author_id and role='fan' and moderation_status='approved' and points_enabled
 ) then
  insert into public.fanyou_fan_points(suggestion_id,profile_id) values(new.id,new.author_id) on conflict(suggestion_id) do nothing;
 end if;
 return new;
end;
$$;
revoke execute on function public.fanyou_award_fan_points() from public,anon,authenticated;
grant execute on function public.fanyou_award_fan_points() to service_role;
create trigger fanyou_fan_points_award after insert or update of status on public.fanyou_suggestions for each row execute function public.fanyou_award_fan_points();

create or replace view public.fanyou_profile_scores with (security_invoker=true) as
 select p.id as profile_id,p.display_name,p.role,p.school,p.sport,p.points_enabled,
  coalesce((select sum(fp.points) from public.fanyou_fan_points fp join public.fanyou_suggestions fs on fs.id=fp.suggestion_id where fp.profile_id=p.id and fs.status='approved'),0) + coalesce((select sum(ip.points) from public.fanyou_interaction_points ip
   join public.fanyou_replies r on r.id=ip.reply_id join public.fanyou_suggestions s on s.id=r.suggestion_id
   where ip.profile_id=p.id and r.status='approved' and s.status='approved'),0)::bigint as points,
  (select count(*) from public.fanyou_star_ratings sr join public.fanyou_replies r on r.id=sr.reply_id
   join public.fanyou_suggestions s on s.id=r.suggestion_id where r.author_id=p.id and r.status='approved' and s.status='approved') as rating_count,
  (select round(avg(sr.stars),2) from public.fanyou_star_ratings sr join public.fanyou_replies r on r.id=sr.reply_id
   join public.fanyou_suggestions s on s.id=r.suggestion_id where r.author_id=p.id and r.status='approved' and s.status='approved') as average_stars
 from public.fanyou_profiles p where p.moderation_status='approved' and (p.role='fan' or (p.role in ('player','coach','manager') and p.verified));


create or replace function public.fanyou_review(p_reviewer uuid,p_type text,p_id uuid,p_decision text,p_verify boolean default false)
returns void language plpgsql security invoker set search_path = '' as $$
begin
 if p_decision not in ('approved','rejected') then raise exception 'INVALID_DECISION'; end if;
 if p_type='profile' then
  update public.fanyou_profiles set moderation_status=p_decision,verified=(p_verify and p_decision='approved' and role in ('player','coach','manager')) where id=p_id;
 elsif p_type='suggestion' then
  update public.fanyou_suggestions set status=p_decision where id=p_id;
 elsif p_type='reply' then
  update public.fanyou_replies set status=p_decision where id=p_id;
 else raise exception 'INVALID_TYPE'; end if;
 if not found then raise exception 'NOT_FOUND'; end if;
 insert into public.fanyou_moderation_audit(reviewer_id,content_type,content_id,decision) values(p_reviewer,p_type,p_id,p_decision);
end;
$$;
