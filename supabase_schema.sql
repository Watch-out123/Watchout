-- CosySync Studio login table for Supabase/Postgres
drop table if exists public.users;

create table if not exists public.users (
    id serial primary key,
    username text not null unique,
    password_hash text not null,
    created_at timestamptz default now()
);

create unique index if not exists users_username_idx
on public.users (username);
