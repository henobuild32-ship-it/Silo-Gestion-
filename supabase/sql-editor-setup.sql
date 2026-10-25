-- SILO GESTION ÉGLISE — script complet pour Supabase SQL Editor
-- À exécuter une seule fois dans un projet Supabase vierge.
-- Crée le schéma de l’application, les 13 départements, les fonctions,
-- les politiques RLS, le stockage privé des photos et les abonnements Web Push.
-- La création du compte administrateur principal reste à faire sur /initial-admin.
-- Ce script ne contient aucun mot de passe ni aucune clé API.

begin;

do $setup_guard$
begin
  if to_regclass('public.profiles') is not null then
    raise exception 'Le schéma SILO existe déjà; ne relancez pas ce script.';
  end if;
end;
$setup_guard$;

-- ===== 202610250001 — schéma initial =====
-- SILO GESTION ÉGLISE — schéma initial PostgreSQL/Supabase
-- Appliquer avec Supabase CLI: supabase db push

create extension if not exists pgcrypto with schema extensions;

create type public.app_role as enum ('super_admin', 'secretariat', 'department_lead');
create type public.record_status as enum ('active', 'inactive', 'archived');
create type public.submission_status as enum ('pending', 'reviewing', 'needs_changes', 'approved', 'rejected');
create type public.link_status as enum ('active', 'revoked', 'expired');
create type public.person_category as enum ('member', 'worker', 'visitor');

create sequence public.member_number_seq start 1;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role public.app_role not null default 'secretariat',
  status public.record_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.prevent_direct_role_change()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.role is distinct from old.role and coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'ROLE_CHANGE_REQUIRES_PRIVILEGED_SERVER';
  end if;
  return new;
end;
$$;
create trigger profiles_role_guard before update on public.profiles
for each row execute function public.prevent_direct_role_change();

-- Un index partiel en base rend impossible la création d'un second administrateur principal,
-- même si deux requêtes d'initialisation arrivent simultanément.
create unique index profiles_single_super_admin on public.profiles ((role)) where role = 'super_admin';

create table public.profile_permissions (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  permission_key text not null,
  granted_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (profile_id, permission_key)
);

create table public.departments (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  status public.record_status not null default 'active',
  created_at timestamptz not null default now()
);

create table public.profile_departments (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  department_id uuid not null references public.departments(id) on delete cascade,
  assigned_by uuid references public.profiles(id) on delete set null,
  assigned_at timestamptz not null default now(),
  primary key (profile_id, department_id)
);

create table public.members (
  id uuid primary key default gen_random_uuid(),
  member_number text not null unique default ('SILO-' || lpad(nextval('public.member_number_seq')::text, 4, '0')),
  nom text not null,
  postnom text not null,
  prenom text not null,
  sexe text not null check (sexe in ('Femme', 'Homme', 'Autre')),
  date_naissance date,
  etat_civil text,
  telephone text not null,
  telephone_secondaire text,
  adresse text not null,
  commune text not null,
  quartier text,
  email text,
  photo_path text,
  frequentation_depuis text,
  date_debut_service date,
  fonction text,
  responsable_actuel text,
  observations text,
  status public.record_status not null default 'active',
  validated_by uuid references public.profiles(id) on delete set null,
  validated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index members_name_search on public.members (lower(nom), lower(postnom), lower(prenom));
create index members_phone_search on public.members (telephone);

create table public.member_categories (
  member_id uuid not null references public.members(id) on delete cascade,
  category public.person_category not null,
  assigned_by uuid references public.profiles(id) on delete set null,
  assigned_at timestamptz not null default now(),
  primary key (member_id, category)
);

create table public.member_departments (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  department_id uuid not null references public.departments(id) on delete restrict,
  fonction text,
  status public.record_status not null default 'active',
  date_affectation date not null default current_date,
  validated_by uuid references public.profiles(id) on delete set null,
  validated_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index member_departments_one_active on public.member_departments(member_id, department_id) where status = 'active';
create index member_departments_by_department on public.member_departments(department_id, status);

create table public.member_department_history (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  department_id uuid not null references public.departments(id) on delete restrict,
  action text not null check (action in ('assigned', 'updated', 'removed')),
  fonction text,
  changed_by uuid references public.profiles(id) on delete set null,
  changed_at timestamptz not null default now(),
  details jsonb not null default '{}'::jsonb
);

create table public.registration_links (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  link_type text not null check (link_type in ('general', 'individual')),
  status public.link_status not null default 'active',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  usage_count integer not null default 0 check (usage_count >= 0),
  usage_limit integer check (usage_limit is null or usage_limit > 0),
  individual_member_id uuid references public.members(id) on delete set null,
  label text
);

create table public.worker_submissions (
  id uuid primary key default gen_random_uuid(),
  client_request_id uuid not null unique,
  reference_number text not null unique default ('SILO-REQ-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))),
  registration_link_id uuid references public.registration_links(id) on delete set null,
  data jsonb not null,
  photo_path text,
  status public.submission_status not null default 'pending',
  date_soumission timestamptz not null default now(),
  date_traitement timestamptz,
  traite_par uuid references public.profiles(id) on delete set null,
  member_id uuid unique references public.members(id) on delete set null,
  motif_rejet text,
  correction_note text,
  updated_at timestamptz not null default now()
);
create index worker_submissions_status_date on public.worker_submissions(status, date_soumission desc);

create table public.worker_submission_departments (
  submission_id uuid not null references public.worker_submissions(id) on delete cascade,
  department_id uuid not null references public.departments(id) on delete restrict,
  primary key (submission_id, department_id)
);

create table public.submission_edit_tokens (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.worker_submissions(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.public_submission_rate_limits (
  ip_hash text not null,
  window_start timestamptz not null,
  request_count integer not null default 0,
  primary key (ip_hash, window_start)
);

create table public.activities (
  id uuid primary key default gen_random_uuid(),
  titre text not null,
  description text,
  department_id uuid references public.departments(id) on delete set null,
  type text not null default 'Réunion',
  date_debut timestamptz not null,
  date_fin timestamptz,
  lieu text,
  responsable_id uuid references public.profiles(id) on delete set null,
  status public.record_status not null default 'active',
  observations text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (date_fin is null or date_fin >= date_debut)
);
create index activities_start_date on public.activities(date_debut);

create table public.activity_participants (
  activity_id uuid not null references public.activities(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(activity_id, member_id)
);

create table public.attendance (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  department_id uuid not null references public.departments(id) on delete restrict,
  activity_id uuid references public.activities(id) on delete cascade,
  event_date date not null default current_date,
  statut_presence text not null check (statut_presence in ('present', 'absent')),
  date_pointage timestamptz not null default now(),
  recorded_by uuid references public.profiles(id) on delete set null,
  correction_of uuid references public.attendance(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index attendance_one_per_activity on public.attendance(member_id, activity_id) where activity_id is not null and correction_of is null;
create unique index attendance_one_per_day on public.attendance(member_id, department_id, event_date) where activity_id is null and correction_of is null;
create index attendance_department_date on public.attendance(department_id, event_date desc);

create table public.financial_transactions (
  id uuid primary key default gen_random_uuid(),
  type_operation text not null check (type_operation in ('income', 'expense')),
  montant numeric(14,2) not null check (montant > 0),
  devise char(3) not null,
  categorie text not null,
  motif text not null,
  department_id uuid references public.departments(id) on delete set null,
  operation_date date not null default current_date,
  status text not null default 'posted' check (status in ('posted', 'cancelled')),
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index financial_transactions_date on public.financial_transactions(operation_date desc);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  action text not null,
  object_type text not null,
  object_id text,
  result text not null default 'success' check (result in ('success', 'failure')),
  context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_created_at on public.audit_logs(created_at desc);

insert into public.departments(name) values
  ('Ecodim'), ('Musique'), ('Moisson finale'), ('Nettoyage'), ('Protocole'),
  ('Sécurité'), ('Presse et technique'), ('Femme et Fille du Jubilé (FFJ)'),
  ('Hébergement'), ('Finance'), ('Relation publique'), ('Communication'), ('Social')
on conflict (name) do nothing;

create or replace function public.has_permission(required_permission text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.status = 'active'
      and (p.role = 'super_admin' or exists (
        select 1 from public.profile_permissions pp
        where pp.profile_id = p.id and pp.permission_key = required_permission
      ))
  );
$$;

create or replace function public.can_access_department(target_department uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.has_permission('departments.read_all') or exists (
    select 1 from public.profile_departments pd
    join public.profiles p on p.id = pd.profile_id and p.status = 'active'
    where pd.profile_id = (select auth.uid()) and pd.department_id = target_department
  );
$$;

create or replace function public.consume_public_submission_rate(p_ip_hash text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_window timestamptz := date_trunc('minute', now());
  v_count integer;
begin
  insert into public.public_submission_rate_limits(ip_hash, window_start, request_count)
  values (p_ip_hash, v_window, 1)
  on conflict (ip_hash, window_start) do update
    set request_count = public.public_submission_rate_limits.request_count + 1
  returning request_count into v_count;
  return v_count <= 5;
end;
$$;

-- Fonction transactionnelle appelée uniquement par le serveur après validation du lien.
create or replace function public.submit_worker_application(
  p_token_hash text,
  p_request_id uuid,
  p_data jsonb,
  p_department_ids uuid[],
  p_photo_path text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_link public.registration_links%rowtype;
  v_submission public.worker_submissions%rowtype;
  v_department_id uuid;
begin
  select * into v_submission from public.worker_submissions where client_request_id = p_request_id;
  if found then
    return jsonb_build_object('id', v_submission.id, 'reference_number', v_submission.reference_number);
  end if;

  select * into v_link from public.registration_links
  where token_hash = p_token_hash and status = 'active'
  for update;
  if not found or (v_link.expires_at is not null and v_link.expires_at <= now()) then
    raise exception 'LINK_INVALID' using errcode = 'P0001';
  end if;
  if v_link.usage_limit is not null and v_link.usage_count >= v_link.usage_limit then
    raise exception 'LINK_LIMIT_REACHED' using errcode = 'P0001';
  end if;
  if cardinality(p_department_ids) < 1 then
    raise exception 'DEPARTMENT_REQUIRED' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from unnest(p_department_ids) x(id)
    left join public.departments d on d.id = x.id and d.status = 'active'
    where d.id is null
  ) then
    raise exception 'DEPARTMENT_INVALID' using errcode = 'P0001';
  end if;

  update public.registration_links set usage_count = usage_count + 1 where id = v_link.id;
  insert into public.worker_submissions(client_request_id, registration_link_id, data, photo_path)
  values (p_request_id, v_link.id, p_data, p_photo_path)
  returning * into v_submission;
  foreach v_department_id in array p_department_ids loop
    insert into public.worker_submission_departments(submission_id, department_id)
    values (v_submission.id, v_department_id);
  end loop;
  return jsonb_build_object('id', v_submission.id, 'reference_number', v_submission.reference_number);
end;
$$;

-- Exécute une décision complète en une transaction: le dossier officiel et ses affectations
-- sont créés ensemble, ou aucun changement n'est conservé.
create or replace function public.review_worker_submission(
  p_submission_id uuid,
  p_actor_id uuid,
  p_action text,
  p_department_ids uuid[] default '{}',
  p_review_data jsonb default '{}'::jsonb,
  p_reason text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_submission public.worker_submissions%rowtype;
  v_data jsonb;
  v_member public.members%rowtype;
  v_department_id uuid;
begin
  if not exists (select 1 from public.profiles p where p.id = p_actor_id and p.status = 'active'
      and (p.role = 'super_admin' or exists (select 1 from public.profile_permissions pp
        where pp.profile_id = p.id and pp.permission_key = 'submissions.validate'))) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select * into v_submission from public.worker_submissions where id = p_submission_id for update;
  if not found then raise exception 'SUBMISSION_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_submission.status in ('approved', 'rejected') then
    raise exception 'SUBMISSION_ALREADY_CLOSED' using errcode = 'P0001';
  end if;

  if p_action = 'reviewing' then
    update public.worker_submissions set status = 'reviewing', traite_par = p_actor_id,
      date_traitement = now(), updated_at = now() where id = p_submission_id;
    insert into public.audit_logs(user_id, action, object_type, object_id)
      values (p_actor_id, 'submission.reviewing', 'worker_submission', p_submission_id::text);
    return jsonb_build_object('status', 'reviewing');
  elsif p_action = 'needs_changes' then
    update public.worker_submissions set status = 'needs_changes', correction_note = p_reason,
      traite_par = p_actor_id, date_traitement = now(), updated_at = now() where id = p_submission_id;
    insert into public.audit_logs(user_id, action, object_type, object_id, context)
      values (p_actor_id, 'submission.needs_changes', 'worker_submission', p_submission_id::text,
        jsonb_build_object('reason', p_reason));
    return jsonb_build_object('status', 'needs_changes');
  elsif p_action = 'rejected' then
    update public.worker_submissions set status = 'rejected', motif_rejet = p_reason,
      traite_par = p_actor_id, date_traitement = now(), updated_at = now() where id = p_submission_id;
    insert into public.audit_logs(user_id, action, object_type, object_id, context)
      values (p_actor_id, 'submission.rejected', 'worker_submission', p_submission_id::text,
        jsonb_build_object('reason', p_reason));
    return jsonb_build_object('status', 'rejected');
  elsif p_action <> 'approved' then
    raise exception 'ACTION_INVALID' using errcode = 'P0001';
  end if;

  if cardinality(p_department_ids) < 1 then raise exception 'DEPARTMENT_REQUIRED' using errcode = 'P0001'; end if;
  if exists (
    select 1 from unnest(p_department_ids) x(id)
    left join public.worker_submission_departments wsd
      on wsd.submission_id = p_submission_id and wsd.department_id = x.id
    where wsd.department_id is null
  ) then raise exception 'DEPARTMENT_NOT_REQUESTED' using errcode = 'P0001'; end if;

  v_data := v_submission.data || coalesce(p_review_data, '{}'::jsonb);
  if exists (select 1 from public.members m where m.telephone = v_data->>'telephone') then
    raise exception 'POSSIBLE_DUPLICATE' using errcode = 'P0001';
  end if;

  insert into public.members(
    nom, postnom, prenom, sexe, date_naissance, etat_civil, telephone, telephone_secondaire,
    adresse, commune, quartier, email, photo_path, frequentation_depuis,
    date_debut_service, fonction, responsable_actuel, observations, validated_by, validated_at
  ) values (
    v_data->>'nom', v_data->>'postnom', v_data->>'prenom', v_data->>'sexe',
    nullif(v_data->>'date_naissance', '')::date, nullif(v_data->>'etat_civil', ''), v_data->>'telephone', nullif(v_data->>'telephone_secondaire', ''),
    v_data->>'adresse', v_data->>'commune', nullif(v_data->>'quartier', ''), nullif(v_data->>'email', ''),
    v_submission.photo_path, nullif(v_data->>'frequentation_depuis', ''),
    nullif(v_data->>'date_debut_service', '')::date, nullif(v_data->>'fonction', ''),
    nullif(v_data->>'responsable_actuel', ''), nullif(v_data->>'observations', ''), p_actor_id, now()
  ) returning * into v_member;

  insert into public.member_categories(member_id, category, assigned_by)
    values (v_member.id, 'worker', p_actor_id);
  foreach v_department_id in array p_department_ids loop
    insert into public.member_departments(member_id, department_id, fonction, validated_by, validated_at)
      values (v_member.id, v_department_id, nullif(v_data->>'fonction', ''), p_actor_id, now());
    insert into public.member_department_history(member_id, department_id, action, fonction, changed_by)
      values (v_member.id, v_department_id, 'assigned', nullif(v_data->>'fonction', ''), p_actor_id);
  end loop;
  update public.worker_submissions set status = 'approved', member_id = v_member.id,
    traite_par = p_actor_id, date_traitement = now(), updated_at = now() where id = p_submission_id;
  insert into public.audit_logs(user_id, action, object_type, object_id, context)
    values (p_actor_id, 'submission.approved', 'worker_submission', p_submission_id::text,
      jsonb_build_object('member_id', v_member.id, 'departments', p_department_ids));
  return jsonb_build_object('status', 'approved', 'member_id', v_member.id, 'member_number', v_member.member_number);
end;
$$;

create or replace function public.create_member_with_departments(
  p_actor_id uuid,
  p_data jsonb,
  p_categories public.person_category[],
  p_department_ids uuid[] default '{}'
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_member public.members%rowtype;
  v_department_id uuid;
  v_category public.person_category;
begin
  if not exists (select 1 from public.profiles p where p.id = p_actor_id and p.status = 'active'
    and (p.role = 'super_admin' or exists (select 1 from public.profile_permissions pp where pp.profile_id = p.id and pp.permission_key = 'members.create'))) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if cardinality(p_categories) < 1 then raise exception 'CATEGORY_REQUIRED' using errcode = 'P0001'; end if;
  if exists (select 1 from public.members m where m.telephone = p_data->>'telephone') then
    raise exception 'POSSIBLE_DUPLICATE' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from unnest(coalesce(p_department_ids, '{}')) x(id)
    left join public.departments d on d.id = x.id and d.status = 'active'
    where d.id is null
  ) then raise exception 'DEPARTMENT_INVALID' using errcode = 'P0001'; end if;

  insert into public.members(nom, postnom, prenom, sexe, date_naissance, etat_civil, telephone, telephone_secondaire,
    adresse, commune, quartier, email, photo_path, frequentation_depuis, date_debut_service, fonction,
    responsable_actuel, observations, validated_by, validated_at)
  values (p_data->>'nom', p_data->>'postnom', p_data->>'prenom', p_data->>'sexe',
    nullif(p_data->>'date_naissance', '')::date, nullif(p_data->>'etat_civil', ''), p_data->>'telephone',
    nullif(p_data->>'telephone_secondaire', ''), p_data->>'adresse', p_data->>'commune',
    nullif(p_data->>'quartier', ''), nullif(p_data->>'email', ''), nullif(p_data->>'photo_path', ''),
    nullif(p_data->>'frequentation_depuis', ''), nullif(p_data->>'date_debut_service', '')::date,
    nullif(p_data->>'fonction', ''), nullif(p_data->>'responsable_actuel', ''),
    nullif(p_data->>'observations', ''), p_actor_id, now()) returning * into v_member;

  foreach v_category in array p_categories loop
    insert into public.member_categories(member_id, category, assigned_by) values (v_member.id, v_category, p_actor_id);
  end loop;
  foreach v_department_id in array coalesce(p_department_ids, '{}') loop
    insert into public.member_departments(member_id, department_id, fonction, validated_by, validated_at)
      values (v_member.id, v_department_id, nullif(p_data->>'fonction', ''), p_actor_id, now());
    insert into public.member_department_history(member_id, department_id, action, fonction, changed_by)
      values (v_member.id, v_department_id, 'assigned', nullif(p_data->>'fonction', ''), p_actor_id);
  end loop;
  insert into public.audit_logs(user_id, action, object_type, object_id, context)
    values (p_actor_id, 'member.created', 'member', v_member.id::text,
      jsonb_build_object('categories', p_categories, 'departments', p_department_ids));
  return jsonb_build_object('id', v_member.id, 'member_number', v_member.member_number);
end;
$$;

create or replace function public.create_activity_with_audit(p_actor_id uuid, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_activity public.activities%rowtype;
begin
  if not exists (select 1 from public.profiles p where p.id = p_actor_id and p.status = 'active'
    and (p.role = 'super_admin' or exists (select 1 from public.profile_permissions pp where pp.profile_id = p.id and pp.permission_key =
      case when nullif(p_data->>'department_id', '') is null then 'activities.manage' else 'activities.manage_assigned' end))) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if nullif(p_data->>'department_id', '') is not null and p_data->>'department_id' not in (
    select pd.department_id::text from public.profile_departments pd where pd.profile_id = p_actor_id
  ) and not exists (select 1 from public.profile_permissions pp where pp.profile_id = p_actor_id and pp.permission_key = 'departments.read_all')
    and not exists (select 1 from public.profiles p where p.id = p_actor_id and p.role = 'super_admin') then
    raise exception 'FORBIDDEN_DEPARTMENT' using errcode = '42501';
  end if;
  insert into public.activities(titre, description, department_id, type, date_debut, date_fin, lieu, observations, created_by)
  values (p_data->>'titre', nullif(p_data->>'description', ''), nullif(p_data->>'department_id', '')::uuid,
    p_data->>'type', (p_data->>'date_debut')::timestamptz, nullif(p_data->>'date_fin', '')::timestamptz,
    nullif(p_data->>'lieu', ''), nullif(p_data->>'observations', ''), p_actor_id)
  returning * into v_activity;
  insert into public.audit_logs(user_id, action, object_type, object_id)
    values (p_actor_id, 'activity.created', 'activity', v_activity.id::text);
  return jsonb_build_object('id', v_activity.id, 'titre', v_activity.titre, 'date_debut', v_activity.date_debut, 'department_id', v_activity.department_id);
end;
$$;

create or replace function public.create_attendance_with_audit(p_actor_id uuid, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_attendance public.attendance%rowtype;
begin
  if not exists (select 1 from public.profiles p where p.id = p_actor_id and p.status = 'active'
    and (p.role = 'super_admin' or exists (select 1 from public.profile_permissions pp where pp.profile_id = p.id and pp.permission_key = 'attendance.write'))) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profile_departments pd where pd.profile_id = p_actor_id and pd.department_id = (p_data->>'department_id')::uuid)
    and not exists (select 1 from public.profile_permissions pp where pp.profile_id = p_actor_id and pp.permission_key = 'departments.read_all')
    and not exists (select 1 from public.profiles p where p.id = p_actor_id and p.role = 'super_admin') then
    raise exception 'FORBIDDEN_DEPARTMENT' using errcode = '42501';
  end if;
  if not exists (select 1 from public.member_departments md where md.member_id = (p_data->>'member_id')::uuid
    and md.department_id = (p_data->>'department_id')::uuid and md.status = 'active') then
    raise exception 'MEMBER_NOT_ASSIGNED' using errcode = 'P0001';
  end if;
  if nullif(p_data->>'activity_id', '') is not null and not exists (
    select 1 from public.activities a where a.id = (p_data->>'activity_id')::uuid and a.department_id = (p_data->>'department_id')::uuid
  ) then raise exception 'ACTIVITY_DEPARTMENT_MISMATCH' using errcode = 'P0001'; end if;
  insert into public.attendance(member_id, department_id, activity_id, event_date, statut_presence, recorded_by)
  values ((p_data->>'member_id')::uuid, (p_data->>'department_id')::uuid, nullif(p_data->>'activity_id', '')::uuid,
    (p_data->>'event_date')::date, p_data->>'statut_presence', p_actor_id)
  returning * into v_attendance;
  insert into public.audit_logs(user_id, action, object_type, object_id)
    values (p_actor_id, 'attendance.created', 'attendance', v_attendance.id::text);
  return jsonb_build_object('id', v_attendance.id, 'member_id', v_attendance.member_id, 'department_id', v_attendance.department_id,
    'event_date', v_attendance.event_date, 'statut_presence', v_attendance.statut_presence);
exception when unique_violation then
  raise exception 'ATTENDANCE_ALREADY_EXISTS' using errcode = 'P0001';
end;
$$;

create or replace function public.create_financial_transaction_with_audit(p_actor_id uuid, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_transaction public.financial_transactions%rowtype;
begin
  if not exists (select 1 from public.profiles p where p.id = p_actor_id and p.status = 'active'
    and (p.role = 'super_admin' or exists (select 1 from public.profile_permissions pp where pp.profile_id = p.id and pp.permission_key = 'finance.write'))) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  insert into public.financial_transactions(type_operation, montant, devise, categorie, motif, department_id, operation_date, created_by)
  values (p_data->>'type_operation', (p_data->>'montant')::numeric, p_data->>'devise', p_data->>'categorie', p_data->>'motif',
    nullif(p_data->>'department_id', '')::uuid, (p_data->>'operation_date')::date, p_actor_id)
  returning * into v_transaction;
  insert into public.audit_logs(user_id, action, object_type, object_id, context)
    values (p_actor_id, 'finance.transaction.created', 'financial_transaction', v_transaction.id::text,
      jsonb_build_object('type', v_transaction.type_operation, 'devise', v_transaction.devise, 'montant', v_transaction.montant));
  return jsonb_build_object('id', v_transaction.id, 'type_operation', v_transaction.type_operation, 'montant', v_transaction.montant,
    'devise', v_transaction.devise, 'categorie', v_transaction.categorie, 'operation_date', v_transaction.operation_date);
end;
$$;

create or replace function public.get_financial_balances()
returns table(devise text, income text, expense text, balance text)
language sql stable security definer set search_path = '' as $$
  select f.devise::text,
    coalesce(sum(f.montant) filter (where f.type_operation = 'income' and f.status = 'posted'), 0)::text,
    coalesce(sum(f.montant) filter (where f.type_operation = 'expense' and f.status = 'posted'), 0)::text,
    (coalesce(sum(f.montant) filter (where f.type_operation = 'income' and f.status = 'posted'), 0) -
     coalesce(sum(f.montant) filter (where f.type_operation = 'expense' and f.status = 'posted'), 0))::text
  from public.financial_transactions f group by f.devise order by f.devise;
$$;

alter table public.profiles enable row level security;
alter table public.profile_permissions enable row level security;
alter table public.departments enable row level security;
alter table public.profile_departments enable row level security;
alter table public.members enable row level security;
alter table public.member_categories enable row level security;
alter table public.member_departments enable row level security;
alter table public.member_department_history enable row level security;
alter table public.registration_links enable row level security;
alter table public.worker_submissions enable row level security;
alter table public.worker_submission_departments enable row level security;
alter table public.submission_edit_tokens enable row level security;
alter table public.public_submission_rate_limits enable row level security;
alter table public.activities enable row level security;
alter table public.activity_participants enable row level security;
alter table public.attendance enable row level security;
alter table public.financial_transactions enable row level security;
alter table public.audit_logs enable row level security;

create policy profiles_read_self_or_admin on public.profiles for select to authenticated
  using (id = (select auth.uid()) or public.has_permission('users.manage'));
create policy profiles_update_admin on public.profiles for update to authenticated
  using (public.has_permission('users.manage')) with check (public.has_permission('users.manage'));
create policy permissions_admin_only on public.profile_permissions for all to authenticated
  using (public.has_permission('users.manage')) with check (public.has_permission('users.manage'));
create policy departments_visible_by_scope on public.departments for select to authenticated
  using (public.can_access_department(id));
create policy department_access_self_or_admin on public.profile_departments for select to authenticated
  using (profile_id = (select auth.uid()) or public.has_permission('users.manage'));
create policy members_visible_by_scope on public.members for select to authenticated
  using (public.has_permission('members.read_all') or exists (
    select 1 from public.member_departments md
    where md.member_id = id and md.status = 'active' and public.can_access_department(md.department_id)
  ));
create policy member_categories_visible_by_scope on public.member_categories for select to authenticated
  using (public.has_permission('members.read_all') or exists (
    select 1 from public.member_departments md where md.member_id = member_id
      and md.status = 'active' and public.can_access_department(md.department_id)
  ));
create policy member_departments_visible_by_scope on public.member_departments for select to authenticated
  using (public.has_permission('members.read_all') or public.can_access_department(department_id));
create policy member_departments_admin_write on public.member_departments for all to authenticated
  using (public.has_permission('members.assign_departments')) with check (public.has_permission('members.assign_departments'));
create policy department_history_visible_by_scope on public.member_department_history for select to authenticated
  using (public.has_permission('members.read_all') or public.can_access_department(department_id));
create policy registration_links_admin_only on public.registration_links for select to authenticated
  using (public.has_permission('links.manage'));
create policy submissions_admin_read on public.worker_submissions for select to authenticated
  using (public.has_permission('submissions.read'));
create policy submission_departments_admin_read on public.worker_submission_departments for select to authenticated
  using (public.has_permission('submissions.read'));
create policy edit_tokens_admin_only on public.submission_edit_tokens for all to authenticated
  using (public.has_permission('submissions.read')) with check (public.has_permission('submissions.read'));
create policy activities_visible_by_scope on public.activities for select to authenticated
  using (department_id is null or public.can_access_department(department_id));
create policy activities_write_by_scope on public.activities for all to authenticated
  using (public.has_permission('activities.manage') or (department_id is not null and public.can_access_department(department_id) and public.has_permission('activities.manage_assigned')))
  with check (public.has_permission('activities.manage') or (department_id is not null and public.can_access_department(department_id) and public.has_permission('activities.manage_assigned')));
create policy attendance_visible_by_scope on public.attendance for select to authenticated
  using (public.can_access_department(department_id));
create policy attendance_write_by_scope on public.attendance for all to authenticated
  using (public.can_access_department(department_id) and public.has_permission('attendance.write'))
  with check (public.can_access_department(department_id) and public.has_permission('attendance.write'));
create policy financial_admin_only on public.financial_transactions for all to authenticated
  using (public.has_permission('finance.read')) with check (public.has_permission('finance.write'));
create policy audit_admin_read on public.audit_logs for select to authenticated
  using (public.has_permission('audit.read'));

revoke all on function public.submit_worker_application(text, uuid, jsonb, uuid[], text) from public, anon, authenticated;
grant execute on function public.submit_worker_application(text, uuid, jsonb, uuid[], text) to service_role;
revoke all on function public.review_worker_submission(uuid, uuid, text, uuid[], jsonb, text) from public, anon, authenticated;
grant execute on function public.review_worker_submission(uuid, uuid, text, uuid[], jsonb, text) to service_role;
revoke all on function public.create_member_with_departments(uuid, jsonb, public.person_category[], uuid[]) from public, anon, authenticated;
grant execute on function public.create_member_with_departments(uuid, jsonb, public.person_category[], uuid[]) to service_role;
revoke all on function public.create_activity_with_audit(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.create_activity_with_audit(uuid, jsonb) to service_role;
revoke all on function public.create_attendance_with_audit(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.create_attendance_with_audit(uuid, jsonb) to service_role;
revoke all on function public.create_financial_transaction_with_audit(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.create_financial_transaction_with_audit(uuid, jsonb) to service_role;
revoke all on function public.get_financial_balances() from public, anon, authenticated;
grant execute on function public.get_financial_balances() to service_role;
revoke all on function public.consume_public_submission_rate(text) from public, anon, authenticated;
grant execute on function public.consume_public_submission_rate(text) to service_role;
revoke all on function public.has_permission(text) from public, anon;
grant execute on function public.has_permission(text) to authenticated, service_role;
revoke all on function public.can_access_department(uuid) from public, anon;
grant execute on function public.can_access_department(uuid) to authenticated, service_role;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('church-profiles', 'church-profiles', false, 2097152, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false, file_size_limit = 2097152,
  allowed_mime_types = array['image/jpeg','image/png','image/webp'];

-- ===== 202610250002 — gestion des comptes =====
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

-- ===== 202610250003 — abonnements Web Push =====
-- Abonnements Web Push privés, liés à un profil et à ses appareils.
create table public.push_subscriptions (
  endpoint text primary key check (char_length(endpoint) <= 2048),
  user_id uuid not null references public.profiles(id) on delete cascade,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index push_subscriptions_user_id on public.push_subscriptions(user_id);
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from public, anon, authenticated;
grant all on public.push_subscriptions to service_role;
create policy push_subscriptions_server_only on public.push_subscriptions
  for all to service_role using (true) with check (true);

commit;
notify pgrst, 'reload schema';
