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
