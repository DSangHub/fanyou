-- Apply once after setup.sql. Participation is optional and disabled by default.
alter table public.fanyou_profiles add column points_enabled boolean not null default false;
create table public.fanyou_interaction_points (
 reply_id uuid primary key references public.fanyou_replies(id) on delete cascade,
 profile_id uuid not null references public.fanyou_profiles(id) on delete cascade,
 points int not null default 10 check(points=10),
 created_at timestamptz not null default now()
);
create index fanyou_points_profile on public.fanyou_interaction_points(profile_id);
create table public.fanyou_star_ratings (
 reply_id uuid primary key references public.fanyou_replies(id) on delete cascade,
 fan_id uuid not null references auth.users(id) on delete cascade,
 stars int not null check(stars between 1 and 5),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index fanyou_ratings_fan on public.fanyou_star_ratings(fan_id);
alter table public.fanyou_interaction_points enable row level security;
alter table public.fanyou_star_ratings enable row level security;
revoke all on public.fanyou_interaction_points,public.fanyou_star_ratings from anon,authenticated;
grant all on public.fanyou_interaction_points,public.fanyou_star_ratings to service_role;

create function public.fanyou_award_reply_points()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.status<>'approved' then
  delete from public.fanyou_interaction_points where reply_id=new.id;
 elsif (tg_op='INSERT' or old.status<>'approved') and exists (
  select 1 from public.fanyou_profiles p join public.fanyou_suggestions s on s.recipient_id=p.id
   where p.id=new.author_id and p.role in ('player','coach') and p.verified
    and p.moderation_status='approved' and p.points_enabled and s.id=new.suggestion_id
    and s.status='approved' and s.author_id<>new.author_id
 ) then
  insert into public.fanyou_interaction_points(reply_id,profile_id) values(new.id,new.author_id)
  on conflict(reply_id) do nothing;
 end if;
 return new;
end;
$$;
revoke execute on function public.fanyou_award_reply_points() from public,anon,authenticated;
grant execute on function public.fanyou_award_reply_points() to service_role;
create trigger fanyou_reply_points after insert or update of status on public.fanyou_replies
 for each row execute function public.fanyou_award_reply_points();

create function public.fanyou_rate_reply(p_fan uuid,p_reply uuid,p_stars int)
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
   and p.id=interaction.author_id and p.role in ('player','coach') and p.verified and p.moderation_status='approved') then
  raise exception 'RATING_FORBIDDEN';
 end if;
 insert into public.fanyou_star_ratings(reply_id,fan_id,stars) values(p_reply,p_fan,p_stars)
 on conflict(reply_id) do update set stars=excluded.stars,updated_at=now()
 where public.fanyou_star_ratings.fan_id=p_fan returning * into result;
 if result.reply_id is null then raise exception 'RATING_FORBIDDEN'; end if;
 return result;
end;
$$;
revoke execute on function public.fanyou_rate_reply(uuid,uuid,int) from public,anon,authenticated;
grant execute on function public.fanyou_rate_reply(uuid,uuid,int) to service_role;

-- Server-only aggregates. Join moderated content so rejected interactions disappear from totals.
create view public.fanyou_profile_scores with (security_invoker=true) as
 select p.id as profile_id,p.display_name,p.role,p.school,p.sport,p.points_enabled,
  coalesce((select sum(ip.points) from public.fanyou_interaction_points ip
   join public.fanyou_replies r on r.id=ip.reply_id join public.fanyou_suggestions s on s.id=r.suggestion_id
   where ip.profile_id=p.id and r.status='approved' and s.status='approved'),0)::bigint as points,
  (select count(*) from public.fanyou_star_ratings sr join public.fanyou_replies r on r.id=sr.reply_id
   join public.fanyou_suggestions s on s.id=r.suggestion_id where r.author_id=p.id and r.status='approved' and s.status='approved') as rating_count,
  (select round(avg(sr.stars),2) from public.fanyou_star_ratings sr join public.fanyou_replies r on r.id=sr.reply_id
   join public.fanyou_suggestions s on s.id=r.suggestion_id where r.author_id=p.id and r.status='approved' and s.status='approved') as average_stars
 from public.fanyou_profiles p where p.role in ('player','coach') and p.verified and p.moderation_status='approved';
revoke all on public.fanyou_profile_scores from anon,authenticated;
grant select on public.fanyou_profile_scores to service_role;
