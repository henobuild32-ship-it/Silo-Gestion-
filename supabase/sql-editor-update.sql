-- 202610250004 — vérification et liens de correction des formulaires
-- À exécuter une fois sur une base déjà initialisée.
begin;

alter table public.worker_submissions
  add column if not exists correction_request_id uuid;
create unique index if not exists worker_submissions_correction_request_id
  on public.worker_submissions(correction_request_id)
  where correction_request_id is not null;

create or replace function public.request_worker_submission_correction(
  p_submission_id uuid,
  p_actor_id uuid,
  p_reason text,
  p_token_hash text,
  p_expires_at timestamptz
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_submission public.worker_submissions%rowtype;
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = p_actor_id and p.status = 'active'
      and (p.role = 'super_admin' or exists (
        select 1 from public.profile_permissions pp
        where pp.profile_id = p.id and pp.permission_key = 'submissions.validate'
      ))
  ) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_token_hash is null or char_length(p_token_hash) <> 64
      or p_expires_at is null or p_expires_at <= now() then
    raise exception 'CORRECTION_LINK_INVALID' using errcode = 'P0001';
  end if;

  select * into v_submission
    from public.worker_submissions where id = p_submission_id for update;
  if not found then raise exception 'SUBMISSION_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_submission.status in ('approved', 'rejected') then
    raise exception 'SUBMISSION_ALREADY_CLOSED' using errcode = 'P0001';
  end if;

  update public.submission_edit_tokens
    set used_at = coalesce(used_at, now())
    where submission_id = p_submission_id and used_at is null;

  insert into public.submission_edit_tokens(submission_id, token_hash, expires_at)
    values (p_submission_id, p_token_hash, p_expires_at);

  update public.worker_submissions
    set status = 'needs_changes',
        correction_note = p_reason,
        correction_request_id = null,
        traite_par = p_actor_id,
        date_traitement = now(),
        updated_at = now()
    where id = p_submission_id;

  insert into public.audit_logs(user_id, action, object_type, object_id, context)
    values (p_actor_id, 'submission.needs_changes', 'worker_submission', p_submission_id::text,
      jsonb_build_object('reason', p_reason, 'link_expires_at', p_expires_at));

  return jsonb_build_object('status', 'needs_changes', 'expires_at', p_expires_at);
end;
$$;

create or replace function public.submit_worker_correction(
  p_token_hash text,
  p_request_id uuid,
  p_data jsonb,
  p_department_ids uuid[],
  p_photo_path text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_edit public.submission_edit_tokens%rowtype;
  v_submission public.worker_submissions%rowtype;
  v_department_id uuid;
  v_old_photo_path text;
begin
  select * into v_edit
    from public.submission_edit_tokens
    where token_hash = p_token_hash
    for update;
  if not found then raise exception 'EDIT_TOKEN_INVALID' using errcode = 'P0001'; end if;

  if v_edit.used_at is not null or v_edit.expires_at <= now() then
    select * into v_submission from public.worker_submissions
      where id = v_edit.submission_id and correction_request_id = p_request_id;
    if found then
      return jsonb_build_object('id', v_submission.id, 'reference_number', v_submission.reference_number, 'idempotent', true);
    end if;
    raise exception 'EDIT_TOKEN_INVALID' using errcode = 'P0001';
  end if;

  select * into v_submission
    from public.worker_submissions where id = v_edit.submission_id for update;
  if not found or v_submission.status <> 'needs_changes' then
    raise exception 'EDIT_TOKEN_INVALID' using errcode = 'P0001';
  end if;
  if p_request_id is null then raise exception 'REQUEST_ID_REQUIRED' using errcode = 'P0001'; end if;
  if cardinality(coalesce(p_department_ids, '{}')) < 1 then
    raise exception 'DEPARTMENT_REQUIRED' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from unnest(p_department_ids) x(id)
    left join public.departments d on d.id = x.id and d.status = 'active'
    where d.id is null
  ) then raise exception 'DEPARTMENT_INVALID' using errcode = 'P0001'; end if;

  v_old_photo_path := v_submission.photo_path;
  delete from public.worker_submission_departments where submission_id = v_submission.id;
  foreach v_department_id in array p_department_ids loop
    insert into public.worker_submission_departments(submission_id, department_id)
      values (v_submission.id, v_department_id);
  end loop;

  update public.worker_submissions
    set data = p_data,
        photo_path = coalesce(p_photo_path, photo_path),
        correction_request_id = p_request_id,
        status = 'pending',
        traite_par = null,
        date_traitement = null,
        updated_at = now()
    where id = v_submission.id
    returning * into v_submission;

  update public.submission_edit_tokens set used_at = now() where id = v_edit.id;

  insert into public.audit_logs(action, object_type, object_id, context)
    values ('submission.corrected', 'worker_submission', v_submission.id::text,
      jsonb_build_object('departments', p_department_ids, 'has_new_photo', p_photo_path is not null));

  return jsonb_build_object(
    'id', v_submission.id,
    'reference_number', v_submission.reference_number,
    'old_photo_path', case when p_photo_path is not null and p_photo_path <> v_old_photo_path then v_old_photo_path else null end,
    'idempotent', false
  );
end;
$$;

revoke all on function public.request_worker_submission_correction(uuid, uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.request_worker_submission_correction(uuid, uuid, text, text, timestamptz) to service_role;
revoke all on function public.submit_worker_correction(text, uuid, jsonb, uuid[], text) from public, anon, authenticated;
grant execute on function public.submit_worker_correction(text, uuid, jsonb, uuid[], text) to service_role;

commit;
notify pgrst, 'reload schema';

begin;

alter table public.attendance
  add column if not exists event_name text not null default 'Pointage quotidien',
  add column if not exists justification text;

update public.attendance a
set event_name = coalesce(nullif(trim(act.titre), ''), 'Pointage quotidien')
from public.activities act
where a.activity_id = act.id and a.event_name = 'Pointage quotidien';

alter table public.attendance drop constraint if exists attendance_statut_presence_check;
alter table public.attendance drop constraint if exists attendance_justification_required;
alter table public.attendance drop constraint if exists attendance_justification_length;
alter table public.attendance drop constraint if exists attendance_event_name_valid;
alter table public.attendance
  add constraint attendance_statut_presence_check
  check (statut_presence in ('present', 'absent', 'justified'));
alter table public.attendance
  add constraint attendance_justification_required
  check (statut_presence <> 'justified' or nullif(trim(coalesce(justification, '')), '') is not null);
alter table public.attendance
  add constraint attendance_justification_length
  check (justification is null or char_length(justification) <= 1000);
alter table public.attendance
  add constraint attendance_event_name_valid
  check (char_length(trim(event_name)) between 1 and 120);

drop index if exists public.attendance_one_per_day;
create unique index if not exists attendance_one_per_event_day
  on public.attendance(member_id, department_id, event_date, lower(event_name))
  where activity_id is null and correction_of is null;

create or replace function public.create_attendance_batch_with_audit(p_actor_id uuid, p_records jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_record jsonb;
  v_attendance public.attendance%rowtype;
  v_results jsonb := '[]'::jsonb;
  v_status text;
  v_justification text;
  v_event_name text;
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = p_actor_id and p.status = 'active'
      and (p.role = 'super_admin' or exists (
        select 1 from public.profile_permissions pp
        where pp.profile_id = p.id and pp.permission_key = 'attendance.write'
      ))
  ) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;

  if jsonb_typeof(p_records) <> 'array' or jsonb_array_length(p_records) < 1 or jsonb_array_length(p_records) > 1500 then
    raise exception 'ATTENDANCE_BATCH_INVALID' using errcode = '22023';
  end if;

  for v_record in select value from jsonb_array_elements(p_records) as item(value) loop
    v_status := v_record->>'statut_presence';
    v_justification := nullif(trim(coalesce(v_record->>'justification', '')), '');
    v_event_name := nullif(trim(coalesce(v_record->>'event_name', '')), '');
    if v_event_name is null or char_length(v_event_name) > 120 then
      raise exception 'ATTENDANCE_EVENT_INVALID' using errcode = '22023';
    end if;
    if v_status = 'justified' and (v_justification is null or char_length(v_justification) < 2) then
      raise exception 'JUSTIFICATION_REQUIRED' using errcode = '22023';
    end if;
    if v_justification is not null and char_length(v_justification) > 1000 then
      raise exception 'JUSTIFICATION_TOO_LONG' using errcode = '22023';
    end if;

    if not exists (
      select 1 from public.profile_departments pd
      where pd.profile_id = p_actor_id and pd.department_id = (v_record->>'department_id')::uuid
    ) and not exists (
      select 1 from public.profile_permissions pp
      where pp.profile_id = p_actor_id and pp.permission_key = 'departments.read_all'
    ) and not exists (
      select 1 from public.profiles p where p.id = p_actor_id and p.role = 'super_admin'
    ) then raise exception 'FORBIDDEN_DEPARTMENT' using errcode = '42501'; end if;

    if not exists (
      select 1 from public.member_departments md
      where md.member_id = (v_record->>'member_id')::uuid
        and md.department_id = (v_record->>'department_id')::uuid and md.status = 'active'
    ) then raise exception 'MEMBER_NOT_ASSIGNED' using errcode = 'P0001'; end if;

    if nullif(v_record->>'activity_id', '') is not null and not exists (
      select 1 from public.activities a
      where a.id = (v_record->>'activity_id')::uuid and a.department_id = (v_record->>'department_id')::uuid
    ) then raise exception 'ACTIVITY_DEPARTMENT_MISMATCH' using errcode = 'P0001'; end if;

    insert into public.attendance(member_id, department_id, activity_id, event_date, event_name, statut_presence, justification, recorded_by)
    values (
      (v_record->>'member_id')::uuid,
      (v_record->>'department_id')::uuid,
      nullif(v_record->>'activity_id', '')::uuid,
      (v_record->>'event_date')::date,
      v_event_name,
      v_status,
      v_justification,
      p_actor_id
    ) returning * into v_attendance;

    insert into public.audit_logs(user_id, action, object_type, object_id, context)
    values (p_actor_id, 'attendance.created', 'attendance', v_attendance.id::text,
      jsonb_build_object('event_name', v_attendance.event_name, 'status', v_attendance.statut_presence,
        'department_id', v_attendance.department_id, 'event_date', v_attendance.event_date));

    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'id', v_attendance.id,
      'member_id', v_attendance.member_id,
      'department_id', v_attendance.department_id,
      'event_date', v_attendance.event_date,
      'event_name', v_attendance.event_name,
      'statut_presence', v_attendance.statut_presence,
      'justification', v_attendance.justification
    ));
  end loop;

  return jsonb_build_object('count', jsonb_array_length(v_results), 'records', v_results);
exception when unique_violation then
  raise exception 'ATTENDANCE_ALREADY_EXISTS' using errcode = 'P0001';
end;
$$;

revoke all on function public.create_attendance_batch_with_audit(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.create_attendance_batch_with_audit(uuid, jsonb) to service_role;

commit;
notify pgrst, 'reload schema';


-- 202610250006 — liens sécurisés de confirmation de présence
begin;

create table if not exists public.attendance_confirmation_links (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  event_name text not null check (char_length(trim(event_name)) between 1 and 120),
  event_date date not null,
  department_ids uuid[] not null check (cardinality(department_ids) between 1 and 13),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  check (expires_at > created_at)
);

create index if not exists attendance_confirmation_links_active_idx
  on public.attendance_confirmation_links(expires_at)
  where revoked_at is null;

alter table public.attendance
  add column if not exists self_confirmed_at timestamptz,
  add column if not exists self_confirmation_link_id uuid
    references public.attendance_confirmation_links(id) on delete set null;

create index if not exists attendance_event_confirmation_lookup_idx
  on public.attendance(event_date, event_name, department_id, member_id)
  where statut_presence = 'present';

alter table public.attendance_confirmation_links enable row level security;
revoke all on public.attendance_confirmation_links from public, anon, authenticated;
grant select, insert, update on public.attendance_confirmation_links to service_role;
grant update (self_confirmed_at, self_confirmation_link_id) on public.attendance to service_role;

commit;
notify pgrst, 'reload schema';

-- 202610250007 — confirmation des présences par code e-mail à usage unique
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


-- 202610250008 — périmètre GPS et statut de refus
begin;

begin;

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
