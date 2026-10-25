begin;

alter table public.attendance_confirmation_links
  add column if not exists center_latitude double precision,
  add column if not exists center_longitude double precision,
  add column if not exists center_accuracy_meters double precision,
  add column if not exists radius_meters integer;

alter table public.attendance_confirmation_links
  drop constraint if exists attendance_confirmation_links_center_valid,
  drop constraint if exists attendance_confirmation_links_radius_valid;
alter table public.attendance_confirmation_links
  add constraint attendance_confirmation_links_center_valid check (
    (center_latitude is null and center_longitude is null and center_accuracy_meters is null)
    or (center_latitude is not null and center_longitude is not null and center_accuracy_meters is not null
      and center_latitude between -90 and 90 and center_longitude between -180 and 180
      and center_accuracy_meters > 0 and center_accuracy_meters <= 30)
  ),
  add constraint attendance_confirmation_links_radius_valid check (
    radius_meters is null or radius_meters between 30 and 500
  );

alter table public.attendance
  add column if not exists confirmation_latitude double precision,
  add column if not exists confirmation_longitude double precision,
  add column if not exists confirmation_accuracy_meters double precision,
  add column if not exists confirmation_distance_meters double precision,
  add column if not exists confirmation_location_at timestamptz,
  add column if not exists self_declined_at timestamptz,
  add column if not exists self_decline_link_id uuid references public.attendance_confirmation_links(id) on delete set null;

alter table public.attendance
  drop constraint if exists attendance_confirmation_location_valid,
  drop constraint if exists attendance_confirmation_choice_valid;
alter table public.attendance
  add constraint attendance_confirmation_location_valid check (
    (confirmation_latitude is null and confirmation_longitude is null
      and confirmation_accuracy_meters is null and confirmation_distance_meters is null
      and confirmation_location_at is null)
    or (confirmation_latitude is not null and confirmation_longitude is not null
      and confirmation_accuracy_meters is not null and confirmation_distance_meters is not null
      and confirmation_location_at is not null
      and confirmation_latitude between -90 and 90 and confirmation_longitude between -180 and 180
      and confirmation_accuracy_meters > 0 and confirmation_accuracy_meters <= 30
      and confirmation_distance_meters >= 0 and confirmation_location_at is not null)
  ),
  add constraint attendance_confirmation_choice_valid check (
    self_confirmed_at is null or self_declined_at is null
  );

alter table public.attendance_confirmation_otps
  add column if not exists requested_outcome text not null default 'confirm';
alter table public.attendance_confirmation_otps
  drop constraint if exists attendance_confirmation_otps_outcome_valid;
alter table public.attendance_confirmation_otps
  add constraint attendance_confirmation_otps_outcome_valid
  check (requested_outcome in ('confirm', 'decline'));

drop function if exists public.create_attendance_confirmation_otp(uuid, uuid, uuid, text);
drop function if exists public.create_attendance_confirmation_otp(uuid, uuid, uuid, text, text, double precision, double precision, double precision);
create or replace function public.create_attendance_confirmation_otp(
  p_challenge_id uuid,
  p_link_id uuid,
  p_attendance_id uuid,
  p_code_hash text,
  p_outcome text,
  p_latitude double precision default null,
  p_longitude double precision default null,
  p_accuracy_meters double precision default null
) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_attendance public.attendance%rowtype;
  v_link public.attendance_confirmation_links%rowtype;
  v_haversine double precision;
  v_distance double precision;
begin
  if p_code_hash !~ '^[0-9a-f]{64}$' or p_outcome not in ('confirm', 'decline') then return false; end if;

  select * into v_attendance
  from public.attendance a
  where a.id = p_attendance_id
  for update;
  if not found or v_attendance.statut_presence <> 'present'
    or v_attendance.self_confirmed_at is not null or v_attendance.self_declined_at is not null then return false; end if;

  select * into v_link
  from public.attendance_confirmation_links l
  where l.id = p_link_id and l.revoked_at is null and l.expires_at > now()
  for share;
  if not found
    or v_attendance.event_name <> v_link.event_name
    or v_attendance.event_date <> v_link.event_date
    or not (v_attendance.department_id = any(v_link.department_ids)) then return false; end if;

  if p_outcome = 'confirm' then
    if v_link.center_latitude is null or v_link.center_longitude is null or v_link.radius_meters is null
      or p_latitude is null or p_latitude not between -90 and 90
      or p_longitude is null or p_longitude not between -180 and 180
      or p_accuracy_meters is null or p_accuracy_meters <= 0 or p_accuracy_meters > 30 then return false; end if;
    v_haversine := power(sin(radians(p_latitude - v_link.center_latitude) / 2), 2)
      + cos(radians(v_link.center_latitude)) * cos(radians(p_latitude))
      * power(sin(radians(p_longitude - v_link.center_longitude) / 2), 2);
    v_distance := 6371008.8 * 2 * asin(sqrt(least(1, greatest(0, v_haversine))));
    if v_distance > v_link.radius_meters then return false; end if;
  end if;

  if not exists (
    select 1 from public.members m
    where m.id = v_attendance.member_id and m.status = 'active'
      and nullif(trim(coalesce(m.email, '')), '') is not null
  ) then return false; end if;

  if exists (
    select 1 from public.attendance_confirmation_otps o
    where o.attendance_id = p_attendance_id and o.invalidated_at is null
      and o.created_at > now() - interval '60 seconds'
  ) then return false; end if;

  if (select count(*) from public.attendance_confirmation_otps o
      where o.attendance_id = p_attendance_id
        and o.created_at > now() - interval '1 hour') >= 3 then return false; end if;

  update public.attendance_confirmation_otps
    set invalidated_at = now()
    where attendance_id = p_attendance_id and used_at is null and invalidated_at is null;

  insert into public.attendance_confirmation_otps(
    id, confirmation_link_id, attendance_id, code_hash, requested_outcome
  ) values (p_challenge_id, p_link_id, p_attendance_id, p_code_hash, p_outcome);
  return true;
end;
$$;

drop function if exists public.verify_attendance_confirmation_otp(uuid, uuid, text);
drop function if exists public.verify_attendance_confirmation_otp(uuid, uuid, text, double precision, double precision, double precision);
create or replace function public.verify_attendance_confirmation_otp(
  p_challenge_id uuid,
  p_link_id uuid,
  p_code_hash text,
  p_latitude double precision default null,
  p_longitude double precision default null,
  p_accuracy_meters double precision default null
) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_challenge public.attendance_confirmation_otps%rowtype;
  v_attendance public.attendance%rowtype;
  v_link public.attendance_confirmation_links%rowtype;
  v_haversine double precision;
  v_distance double precision;
begin
  select * into v_challenge
  from public.attendance_confirmation_otps o
  where o.id = p_challenge_id and o.confirmation_link_id = p_link_id
  for update;
  if not found or v_challenge.used_at is not null or v_challenge.invalidated_at is not null
    or v_challenge.expires_at <= now() then return 'invalid'; end if;
  if v_challenge.attempt_count >= 5 then return 'locked'; end if;

  update public.attendance_confirmation_otps
    set attempt_count = attempt_count + 1 where id = v_challenge.id;
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
  if not found or v_attendance.statut_presence <> 'present'
    or v_attendance.event_name <> v_link.event_name
    or v_attendance.event_date <> v_link.event_date
    or not (v_attendance.department_id = any(v_link.department_ids)) then return 'invalid'; end if;

  if v_attendance.self_declined_at is not null then
    update public.attendance_confirmation_otps set used_at = now() where id = v_challenge.id;
    return 'already_declined';
  elsif v_attendance.self_confirmed_at is not null then
    update public.attendance_confirmation_otps set used_at = now() where id = v_challenge.id;
    return 'already_confirmed';
  end if;

  if v_challenge.requested_outcome = 'decline' then
    update public.attendance
      set statut_presence = 'absent',
          justification = 'Refus de la vérification de présence',
          self_declined_at = now(),
          self_decline_link_id = p_link_id
      where id = v_attendance.id and statut_presence = 'present'
        and self_confirmed_at is null and self_declined_at is null;
    if not found then return 'invalid'; end if;
    update public.attendance_confirmation_otps set used_at = now() where id = v_challenge.id;
    return 'declined';
  end if;

  if v_link.center_latitude is null or v_link.center_longitude is null or v_link.radius_meters is null
    or p_latitude is null or p_latitude not between -90 and 90
    or p_longitude is null or p_longitude not between -180 and 180
    or p_accuracy_meters is null or p_accuracy_meters <= 0 or p_accuracy_meters > 30 then return 'invalid'; end if;

  v_haversine := power(sin(radians(p_latitude - v_link.center_latitude) / 2), 2)
    + cos(radians(v_link.center_latitude)) * cos(radians(p_latitude))
    * power(sin(radians(p_longitude - v_link.center_longitude) / 2), 2);
  v_distance := 6371008.8 * 2 * asin(sqrt(least(1, greatest(0, v_haversine))));
  if v_distance > v_link.radius_meters then return 'invalid'; end if;

  update public.attendance
    set self_confirmed_at = now(),
        self_confirmation_link_id = p_link_id,
        confirmation_latitude = p_latitude,
        confirmation_longitude = p_longitude,
        confirmation_accuracy_meters = p_accuracy_meters,
        confirmation_distance_meters = v_distance,
        confirmation_location_at = now()
    where id = v_attendance.id and self_confirmed_at is null and self_declined_at is null;
  if not found then return 'already_confirmed'; end if;

  update public.attendance_confirmation_otps set used_at = now() where id = v_challenge.id;
  return 'confirmed';
end;
$$;

revoke all on function public.create_attendance_confirmation_otp(uuid, uuid, uuid, text, text, double precision, double precision, double precision) from public, anon, authenticated;
revoke all on function public.verify_attendance_confirmation_otp(uuid, uuid, text, double precision, double precision, double precision) from public, anon, authenticated;
grant execute on function public.create_attendance_confirmation_otp(uuid, uuid, uuid, text, text, double precision, double precision, double precision) to service_role;
grant execute on function public.verify_attendance_confirmation_otp(uuid, uuid, text, double precision, double precision, double precision) to service_role;

create or replace function public.admin_mark_attendance_refusal_absent(
  p_attendance_id uuid,
  p_actor_id uuid
) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_attendance public.attendance%rowtype;
begin
  select * into v_attendance
  from public.attendance a
  where a.id = p_attendance_id
  for update;
  if not found or v_attendance.statut_presence <> 'present'
    or v_attendance.self_confirmed_at is not null or v_attendance.self_declined_at is not null then
    return false;
  end if;

  update public.attendance
    set statut_presence = 'absent',
        justification = 'Refus des obligations de vérification de présence',
        self_declined_at = now()
    where id = v_attendance.id;

  insert into public.audit_logs(user_id, action, object_type, object_id, context)
  values (p_actor_id, 'attendance.admin_marked_absent_after_refusal', 'attendance', v_attendance.id,
    jsonb_build_object('event_name', v_attendance.event_name, 'event_date', v_attendance.event_date,
      'department_id', v_attendance.department_id, 'old_status', v_attendance.statut_presence,
      'new_status', 'absent'));
  return true;
end;
$$;

revoke all on function public.admin_mark_attendance_refusal_absent(uuid, uuid) from public, anon, authenticated;
grant execute on function public.admin_mark_attendance_refusal_absent(uuid, uuid) to service_role;

commit;
notify pgrst, 'reload schema';
