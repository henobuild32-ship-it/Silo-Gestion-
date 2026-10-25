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
