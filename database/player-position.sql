-- Apply after setup.sql, points-stars.sql and futbol.sql. Existing profiles are preserved.
alter table public.fanyou_profiles add column position text not null default '' check (char_length(position) <= 80);
