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
