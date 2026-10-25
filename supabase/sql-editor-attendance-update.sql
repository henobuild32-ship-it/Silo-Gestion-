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
