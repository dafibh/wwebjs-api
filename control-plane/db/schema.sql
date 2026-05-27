create extension if not exists "pgcrypto";

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  username text unique not null,
  password_hash text not null,
  must_change_password boolean not null default true,
  session_quota int default 1,           -- null = unlimited
  created_at timestamptz not null default now(),
  last_login timestamptz
);

create table if not exists sessions (
  session_id text primary key,
  owner_id uuid not null references users(id) on delete cascade,
  wa_number text,
  label text,
  status text,
  created_at timestamptz not null default now(),
  last_seen timestamptz
);

create table if not exists api_keys (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references users(id) on delete cascade,
  key_hash text not null,
  prefix text not null,
  label text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

create index if not exists sessions_owner_idx on sessions(owner_id);
create index if not exists api_keys_owner_idx on api_keys(owner_id);
create index if not exists api_keys_hash_idx on api_keys(key_hash) where revoked_at is null;
