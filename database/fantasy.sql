-- Free, invite-only fantasy leagues. Apply once after setup.sql.
-- Access only through the authenticated Node API using the server service role.
begin;
create table public.fanyou_fantasy_eligibility (
 user_id uuid primary key references auth.users(id) on delete cascade,
 age_band text not null check(age_band in ('13-17','18+')),
 rules_version text not null default 'free-13plus-v1',
 declared_at timestamptz not null default now()
);
create table public.fanyou_fantasy_leagues (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references public.fanyou_fantasy_eligibility(user_id) on delete cascade,
 invite_code uuid not null unique default gen_random_uuid(),
 name text not null check(char_length(name) between 3 and 60),
 sport text not null check(sport in ('Football','Baseball','Basketball','Hockey','Futbol/Football')),
 capacity integer not null check(capacity between 2 and 20),
 roster_size integer not null check(roster_size between 1 and 10),
 state text not null default 'draft' check(state in ('draft','active','closed')),
 rules_version text not null default 'fanyou-free-v1' check(rules_version='fanyou-free-v1'),
 created_at timestamptz not null default now()
);
create table public.fanyou_fantasy_members (
 league_id uuid not null references public.fanyou_fantasy_leagues(id) on delete cascade,
 user_id uuid not null references public.fanyou_fantasy_eligibility(user_id) on delete cascade,
 team_name text not null check(char_length(team_name) between 2 and 40),
 joined_at timestamptz not null default now(),
 primary key(league_id,user_id),unique(league_id,team_name)
);
create index fanyou_fantasy_members_user on public.fanyou_fantasy_members(user_id);
create index fanyou_fantasy_leagues_owner on public.fanyou_fantasy_leagues(owner_id);
create table public.fanyou_fantasy_athletes (
 id uuid primary key default gen_random_uuid(),
 league_id uuid not null references public.fanyou_fantasy_leagues(id) on delete cascade,
 name text not null check(char_length(name) between 2 and 80),
 team text not null check(char_length(team) between 2 and 80),
 position text not null check(char_length(position) between 1 and 40),
 unique(league_id,id),unique(league_id,name,team,position)
);
create table public.fanyou_fantasy_picks (
 league_id uuid not null,
 user_id uuid not null,
 athlete_id uuid not null,
 primary key(league_id,athlete_id),
 foreign key(league_id,user_id) references public.fanyou_fantasy_members(league_id,user_id) on delete cascade,
 foreign key(league_id,athlete_id) references public.fanyou_fantasy_athletes(league_id,id) on delete cascade
);
create index fanyou_fantasy_picks_user on public.fanyou_fantasy_picks(league_id,user_id);
create table public.fanyou_fantasy_scores (
 league_id uuid not null,
 athlete_id uuid not null,
 period text not null check(period ~ '^[A-Za-z0-9_-]{1,24}$'),
 stats jsonb not null check(jsonb_typeof(stats)='object'),
 points numeric(12,2) not null check(abs(points)<=10000000),
 updated_at timestamptz not null default now(),
 primary key(league_id,athlete_id,period),
 foreign key(league_id,athlete_id) references public.fanyou_fantasy_athletes(league_id,id) on delete cascade
);
alter table public.fanyou_fantasy_eligibility enable row level security;
alter table public.fanyou_fantasy_leagues enable row level security;
alter table public.fanyou_fantasy_members enable row level security;
alter table public.fanyou_fantasy_athletes enable row level security;
alter table public.fanyou_fantasy_picks enable row level security;
alter table public.fanyou_fantasy_scores enable row level security;
revoke all on public.fanyou_fantasy_eligibility,public.fanyou_fantasy_leagues,public.fanyou_fantasy_members,public.fanyou_fantasy_athletes,public.fanyou_fantasy_picks,public.fanyou_fantasy_scores from public,anon,authenticated;
grant all on public.fanyou_fantasy_eligibility,public.fanyou_fantasy_leagues,public.fanyou_fantasy_members,public.fanyou_fantasy_athletes,public.fanyou_fantasy_picks,public.fanyou_fantasy_scores to service_role;

create function public.fanyou_fantasy_action(p_action text,p_user uuid,p_data jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare l public.fanyou_fantasy_leagues; lid uuid; aid uuid; r jsonb; payload jsonb;
begin
 if p_user is null then raise exception 'FANTASY_FORBIDDEN'; end if;
 if p_action='enroll' then
  if coalesce(p_data->>'age_band','') not in ('13-17','18+') then raise exception 'FANTASY_INVALID'; end if;
  insert into fanyou_fantasy_eligibility(user_id,age_band)values(p_user,p_data->>'age_band')on conflict(user_id)do nothing;
  return jsonb_build_object('eligible',true);
 end if;
 if p_action='list' then
  return jsonb_build_object('eligible',exists(select 1 from fanyou_fantasy_eligibility where user_id=p_user),'leagues',coalesce((select jsonb_agg(to_jsonb(q))from(select x.id,x.name,x.sport,x.state,x.roster_size,x.capacity,x.owner_id from fanyou_fantasy_leagues x join fanyou_fantasy_members m on m.league_id=x.id where m.user_id=p_user order by x.created_at desc)q),'[]'::jsonb));
 end if;
 if not exists(select 1 from fanyou_fantasy_eligibility where user_id=p_user)then raise exception 'FANTASY_AGE_REQUIRED';end if;
 if p_action in ('create','join')then
  perform pg_advisory_xact_lock(hashtextextended(p_user::text,735));
  if (select count(*)from fanyou_fantasy_members where user_id=p_user)>=10 then raise exception 'FANTASY_LIMIT';end if;
 end if;
 if p_action='create' then
  if (select count(*)from fanyou_fantasy_leagues where owner_id=p_user)>=5 then raise exception 'FANTASY_LIMIT';end if;
  insert into fanyou_fantasy_leagues(owner_id,name,sport,capacity,roster_size)values(p_user,p_data->>'name',p_data->>'sport',(p_data->>'capacity')::integer,(p_data->>'roster_size')::integer)returning * into l;
  insert into fanyou_fantasy_members(league_id,user_id,team_name)values(l.id,p_user,p_data->>'team_name');
  return jsonb_build_object('league_id',l.id);
 end if;
 if p_action='join' then
  select * into l from fanyou_fantasy_leagues where invite_code=(p_data->>'invite_code')::uuid for update;
  if not found then raise exception 'FANTASY_FORBIDDEN';end if;
  if exists(select 1 from fanyou_fantasy_members where league_id=l.id and user_id=p_user)then return jsonb_build_object('league_id',l.id);end if;
  if l.state<>'draft' then raise exception 'FANTASY_LOCKED';end if;
  if(select count(*)from fanyou_fantasy_members where league_id=l.id)>=l.capacity then raise exception 'FANTASY_FULL';end if;
  insert into fanyou_fantasy_members(league_id,user_id,team_name)values(l.id,p_user,p_data->>'team_name');
  return jsonb_build_object('league_id',l.id);
 end if;
 lid=(p_data->>'league_id')::uuid;
 select * into l from fanyou_fantasy_leagues where id=lid for update;
 if not found or not exists(select 1 from fanyou_fantasy_members where league_id=lid and user_id=p_user)then raise exception 'FANTASY_FORBIDDEN';end if;
 if p_action='detail' then
  payload=to_jsonb(l);if l.owner_id<>p_user then payload=payload-'invite_code';end if;
  return jsonb_build_object('league',payload,'members',coalesce((select jsonb_agg(to_jsonb(m))from(select user_id,team_name from fanyou_fantasy_members where league_id=lid order by joined_at)m),'[]'::jsonb),'athletes',coalesce((select jsonb_agg(to_jsonb(a))from fanyou_fantasy_athletes a where league_id=lid),'[]'::jsonb),'picks',coalesce((select jsonb_agg(to_jsonb(p))from fanyou_fantasy_picks p where league_id=lid),'[]'::jsonb),'scores',coalesce((select jsonb_agg(to_jsonb(s))from fanyou_fantasy_scores s where league_id=lid),'[]'::jsonb),'user_id',p_user);
 end if;
 if p_action='pick' then
  if l.state<>'draft' then raise exception 'FANTASY_LOCKED';end if;
  aid=(p_data->>'athlete_id')::uuid;
  if not exists(select 1 from fanyou_fantasy_athletes where league_id=lid and id=aid)then raise exception 'FANTASY_FORBIDDEN';end if;
  if exists(select 1 from fanyou_fantasy_picks where league_id=lid and athlete_id=aid)then raise exception 'FANTASY_PICK_TAKEN';end if;
  if(select count(*)from fanyou_fantasy_picks where league_id=lid and user_id=p_user)>=l.roster_size then raise exception 'FANTASY_FULL';end if;
  insert into fanyou_fantasy_picks values(lid,p_user,aid);
  return jsonb_build_object('picked',true);
 end if;
 if l.owner_id<>p_user then raise exception 'FANTASY_FORBIDDEN';end if;
 if p_action='athlete' then
  if l.state<>'draft' then raise exception 'FANTASY_LOCKED';end if;
  if(select count(*)from fanyou_fantasy_athletes where league_id=lid)>=200 then raise exception 'FANTASY_LIMIT';end if;
  insert into fanyou_fantasy_athletes(league_id,name,team,position)values(lid,p_data->>'name',p_data->>'team',p_data->>'position')returning id into aid;
  return jsonb_build_object('athlete_id',aid);
 elsif p_action='start' then
  if l.state<>'draft' then raise exception 'FANTASY_LOCKED';end if;
  if(select count(*)from fanyou_fantasy_members where league_id=lid)<2 or exists(select 1 from fanyou_fantasy_members m where m.league_id=lid and(select count(*)from fanyou_fantasy_picks p where p.league_id=lid and p.user_id=m.user_id)<>l.roster_size)then raise exception 'FANTASY_INVALID';end if;
  update fanyou_fantasy_leagues set state='active' where id=lid;
  return jsonb_build_object('started',true);
 elsif p_action='close' then
  update fanyou_fantasy_leagues set state='closed',invite_code=gen_random_uuid()where id=lid;
  return jsonb_build_object('closed',true);
 elsif p_action='scores' then
  if l.state<>'active' then raise exception 'FANTASY_LOCKED';end if;
  if jsonb_typeof(p_data->'records')<>'array' or jsonb_array_length(p_data->'records')not between 1 and 100 then raise exception 'FANTASY_INVALID';end if;
  for r in select * from jsonb_array_elements(p_data->'records')loop
   if not exists(select 1 from fanyou_fantasy_athletes where league_id=lid and id=(r->>'athlete_id')::uuid)then raise exception 'FANTASY_FORBIDDEN';end if;
   insert into fanyou_fantasy_scores(league_id,athlete_id,period,stats,points)values(lid,(r->>'athlete_id')::uuid,p_data->>'period',r->'stats',(r->>'points')::numeric)
   on conflict(league_id,athlete_id,period)do update set stats=excluded.stats,points=excluded.points,updated_at=now();
  end loop;
  return jsonb_build_object('updated',jsonb_array_length(p_data->'records'));
 end if;
 raise exception 'FANTASY_INVALID';
end $$;
revoke all on function public.fanyou_fantasy_action(text,uuid,jsonb)from public,anon,authenticated;
grant execute on function public.fanyou_fantasy_action(text,uuid,jsonb)to service_role;
commit;
