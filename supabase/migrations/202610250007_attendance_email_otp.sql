begin;

create table if not exists public.attendance_confirmation_otps (
  id uuid primary key,
  confirmation_link_id uuid not null references public.attendance_confirmation_links(id) on delete cascade,
  attendance_id uuid not null references public.attendance(id) on delete cascade,
  code_hash text not null check (code_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '10 minutes'),
  attempt_count smallint not null default 0 check (attempt_count between 0 and 5),
  used_at timestamptz,
  invalidated_at timestamptz,
  check (expires_at > created_at)
);

create index if not exists attendance_confirmation_otps_rate_idx
  on public.attendance_confirmation_otps(attendance_id, created_at desc);

create unique index if not exists attendance_confirmation_otps_one_active_idx
  on public.attendance_confirmation_otps(attendance_id)
  where used_at is null and invalidated_at is null;

alter table public.attendance_confirmation_otps enable row level security;
revoke all on public.attendance_confirmation_otps from public, anon, authenticated;
grant select, update on public.attendance_confirmation_otps to service_role;

create or replace function public.create_attendance_confirmation_otp(
  p_challenge_id uuid,
  p_link_id uuid,
  p_attendance_id uuid,
  p_code_hash text
) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_attendance public.attendance%rowtype;
  v_link public.attendance_confirmation_links%rowtype;
begin
  if p_code_hash !~ '^[0-9a-f]{64}$' then return false; end if;

  select * into v_attendance
  from public.attendance a
  where a.id = p_attendance_id
  for update;
  if not found or v_attendance.statut_presence <> 'present'
    or v_attendance.self_confirmed_at is not null then return false; end if;

  select * into v_link
  from public.attendance_confirmation_links l
  where l.id = p_link_id
    and l.revoked_at is null
    and l.expires_at > now()
  for share;
  if not found
    or v_attendance.event_name <> v_link.event_name
    or v_attendance.event_date <> v_link.event_date
    or not (v_attendance.department_id = any(v_link.department_ids)) then return false; end if;

  if not exists (
    select 1 from public.members m
    where m.id = v_attendance.member_id and m.status = 'active'
      and nullif(trim(coalesce(m.email, '')), '') is not null
  ) then return false; end if;

  if exists (
    select 1 from public.attendance_confirmation_otps o
    where o.attendance_id = p_attendance_id
      and o.invalidated_at is null
      and o.created_at > now() - interval '60 seconds'
  ) then return false; end if;

  if (select count(*) from public.attendance_confirmation_otps o
      where o.attendance_id = p_attendance_id
        and o.created_at > now() - interval '1 hour') >= 3 then return false; end if;

  update public.attendance_confirmation_otps
    set invalidated_at = now()
    where attendance_id = p_attendance_id
      and used_at is null and invalidated_at is null;

  insert into public.attendance_confirmation_otps(
    id, confirmation_link_id, attendance_id, code_hash
  ) values (p_challenge_id, p_link_id, p_attendance_id, p_code_hash);

  return true;
end;
$$;

create or replace function public.verify_attendance_confirmation_otp(
  p_challenge_id uuid,
  p_link_id uuid,
  p_code_hash text
) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_challenge public.attendance_confirmation_otps%rowtype;
  v_attendance public.attendance%rowtype;
  v_link public.attendance_confirmation_links%rowtype;
begin
  select * into v_challenge
  from public.attendance_confirmation_otps o
  where o.id = p_challenge_id and o.confirmation_link_id = p_link_id
  for update;
  if not found or v_challenge.used_at is not null or v_challenge.invalidated_at is not null
    or v_challenge.expires_at <= now() then return 'invalid'; end if;
  if v_challenge.attempt_count >= 5 then return 'locked'; end if;

  update public.attendance_confirmation_otps
    set attempt_count = attempt_count + 1
    where id = v_challenge.id;

  if p_code_hash !~ '^[0-9a-f]{64}$' or v_challenge.code_hash <> p_code_hash then
    if v_challenge.attempt_count + 1 >= 5 then return 'locked'; end if;
    return 'invalid';
  end if;

  select * into v_link
  from public.attendance_confirmation_links l
  where l.id = p_link_id and l.revoked_at is null and l.expires_at > now()
  for share;
  if not found then return 'invalid'; end if;

  select * into v_attendance
  from public.attendance a
  where a.id = v_challenge.attendance_id
  for update;
  if not found
    or v_attendance.statut_presence <> 'present'
    or v_attendance.event_name <> v_link.event_name
    or v_attendance.event_date <> v_link.event_date
    or not (v_attendance.department_id = any(v_link.department_ids)) then return 'invalid'; end if;

  if v_attendance.self_confirmed_at is not null then
    update public.attendance_confirmation_otps set used_at = now() where id = v_challenge.id;
    return 'already_confirmed';
  end if;

  update public.attendance
    set self_confirmed_at = now(), self_confirmation_link_id = p_link_id
    where id = v_attendance.id and self_confirmed_at is null;
  if not found then return 'already_confirmed'; end if;

  update public.attendance_confirmation_otps set used_at = now() where id = v_challenge.id;
  return 'confirmed';
end;
$$;

revoke all on function public.create_attendance_confirmation_otp(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.verify_attendance_confirmation_otp(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.create_attendance_confirmation_otp(uuid, uuid, uuid, text) to service_role;
grant execute on function public.verify_attendance_confirmation_otp(uuid, uuid, text) to service_role;

commit;
notify pgrst, 'reload schema';
