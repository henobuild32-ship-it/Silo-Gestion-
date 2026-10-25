-- Gestion contrôlée des comptes, autorisations et périmètres départementaux.
create or replace function public.manage_profile_access(
  p_actor_id uuid,
  p_profile_id uuid,
  p_full_name text,
  p_role public.app_role,
  p_status public.record_status,
  p_permissions text[],
  p_department_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_permissions text[] := coalesce(p_permissions, array[]::text[]);
  v_departments uuid[] := coalesce(p_department_ids, array[]::uuid[]);
  v_allowed_permissions constant text[] := array[
    'dashboard.read', 'submissions.read', 'submissions.validate', 'links.manage',
    'members.read_all', 'members.read_assigned', 'members.create', 'members.assign_departments',
    'departments.read_all', 'departments.read_assigned',
    'attendance.read_all', 'attendance.read_assigned', 'attendance.write',
    'activities.read_all', 'activities.read_assigned', 'activities.manage', 'activities.manage_assigned',
    'finance.read', 'finance.write', 'audit.read', 'users.manage'
  ];
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = p_actor_id and p.status = 'active'
      and (p.role = 'super_admin' or exists (
        select 1 from public.profile_permissions pp
        where pp.profile_id = p.id and pp.permission_key = 'users.manage'
      ))
  ) then
    raise exception 'USER_MANAGEMENT_FORBIDDEN';
  end if;
  if p_actor_id = p_profile_id then
    raise exception 'CANNOT_MANAGE_OWN_ACCESS';
  end if;
  if p_role = 'super_admin' then
    raise exception 'SECOND_SUPER_ADMIN_FORBIDDEN';
  end if;
  if exists (
    select 1 from public.profiles actor
    where actor.id = p_actor_id and actor.role <> 'super_admin'
  ) and 'users.manage' = any(v_permissions) then
    raise exception 'ONLY_SUPER_ADMIN_CAN_GRANT_USER_MANAGEMENT';
  end if;
  if exists (
    select 1 from public.profiles actor
    where actor.id = p_actor_id and actor.role <> 'super_admin'
  ) and exists (
    select 1 from unnest(v_permissions) as wanted(permission)
    where not exists (
      select 1 from public.profile_permissions own
      where own.profile_id = p_actor_id and own.permission_key = wanted.permission
    )
  ) then
    raise exception 'CANNOT_GRANT_UNOWNED_PERMISSION';
  end if;
  if exists (
    select 1 from public.profiles actor
    where actor.id = p_actor_id and actor.role <> 'super_admin'
      and not exists (select 1 from public.profile_permissions own where own.profile_id = actor.id and own.permission_key = 'departments.read_all')
  ) and exists (
    select 1 from unnest(v_departments) as wanted(department_id)
    where not exists (
      select 1 from public.profile_departments own
      where own.profile_id = p_actor_id and own.department_id = wanted.department_id
    )
  ) then
    raise exception 'CANNOT_GRANT_UNASSIGNED_DEPARTMENT';
  end if;
  if exists (select 1 from unnest(v_permissions) as p(permission) where not (p.permission = any(v_allowed_permissions))) then
    raise exception 'UNKNOWN_PERMISSION';
  end if;
  if exists (
    select 1 from unnest(v_departments) as p(department_id)
    where not exists (select 1 from public.departments d where d.id = p.department_id and d.status = 'active')
  ) then
    raise exception 'UNKNOWN_DEPARTMENT';
  end if;
  if p_role = 'department_lead' and cardinality(v_departments) = 0 then
    raise exception 'DEPARTMENT_REQUIRED';
  end if;

  insert into public.profiles(id, full_name, role, status)
  values (p_profile_id, btrim(p_full_name), p_role, p_status)
  on conflict (id) do update set
    full_name = excluded.full_name,
    role = excluded.role,
    status = excluded.status,
    updated_at = now();

  delete from public.profile_permissions where profile_id = p_profile_id;
  insert into public.profile_permissions(profile_id, permission_key, granted_by)
  select p_profile_id, permission, p_actor_id
  from (select distinct unnest(v_permissions) as permission) granted;

  delete from public.profile_departments where profile_id = p_profile_id;
  insert into public.profile_departments(profile_id, department_id, assigned_by)
  select p_profile_id, department_id, p_actor_id
  from (select distinct unnest(v_departments) as department_id) assigned;

  insert into public.audit_logs(user_id, action, object_type, object_id, context)
  values (p_actor_id, 'user.access.updated', 'profile', p_profile_id::text,
    jsonb_build_object('role', p_role, 'status', p_status, 'permission_count', cardinality(v_permissions), 'department_count', cardinality(v_departments)));
end;
$$;

revoke all on function public.manage_profile_access(uuid, uuid, text, public.app_role, public.record_status, text[], uuid[]) from public, anon, authenticated;
grant execute on function public.manage_profile_access(uuid, uuid, text, public.app_role, public.record_status, text[], uuid[]) to service_role;

-- Les comptes authentifiés peuvent lire les permissions nécessaires à l’interface,
-- mais seules les fonctions serveur attribuent ou retirent ces droits.
drop policy if exists permissions_admin_only on public.profile_permissions;
create policy permissions_read_self_or_admin on public.profile_permissions for select to authenticated
  using (profile_id = (select auth.uid()) or public.has_permission('users.manage'));
