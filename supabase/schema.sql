-- Nmyt Ops App — Supabase schema
-- Run this once in your Supabase project's SQL Editor (Project > SQL Editor > New query).
-- Requires the pgcrypto extension for gen_random_uuid(), enabled by default on Supabase.

-- ============================================================
-- SETTINGS (single shared row, id = 1)
-- ============================================================
create table if not exists settings (
  id int primary key default 1,
  company_name text default 'Nmyt',
  address text default '',
  gstin text default '',
  bank_details text default '',
  tax_rate numeric default 18,
  next_invoice_number int default 1,
  updated_at timestamptz default now(),
  constraint single_row check (id = 1)
);
insert into settings (id) values (1) on conflict (id) do nothing;

-- ============================================================
-- INVOICES
-- ============================================================
create table if not exists invoices (
  id uuid primary key default gen_random_uuid(),
  number text not null,
  date date not null,
  due_date date,
  wing text not null,
  client_name text not null,
  client_address text default '',
  client_contact text default '',
  items jsonb not null default '[]',
  tax_rate numeric default 0,
  status text not null default 'Draft',
  notes text default '',
  created_at timestamptz default now()
);

-- ============================================================
-- LEDGER (income & expenses)
-- ============================================================
create table if not exists ledger (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  description text not null,
  wing text not null,
  category text not null,
  type text not null check (type in ('Income','Expense')),
  amount numeric not null default 0,
  created_at timestamptz default now()
);

-- ============================================================
-- CLIENT PIPELINE / CRM
-- ============================================================
create table if not exists crm (
  id uuid primary key default gen_random_uuid(),
  client_name text not null,
  contact text default '',
  wing text not null,
  stage text not null default 'Lead',
  deal_value numeric default 0,
  probability numeric default 20,
  next_follow_up date,
  owner text default '',
  notes text default '',
  created_at timestamptz default now()
);

-- ============================================================
-- TEAM & PARTNERS
-- ============================================================
create table if not exists team (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  role text default '',
  wing text not null,
  type text not null default 'Core Team',
  payout_rate numeric default 0,
  payout_basis text default 'Monthly',
  contact text default '',
  active boolean default true,
  created_at timestamptz default now()
);

-- ============================================================
-- ROW LEVEL SECURITY
-- Only signed-in users (team members you add in Supabase Auth) can read/write.
-- Nobody can access this data with just the public anon key alone.
-- ============================================================
alter table settings enable row level security;
alter table invoices enable row level security;
alter table ledger   enable row level security;
alter table crm      enable row level security;
alter table team     enable row level security;

create policy "authenticated read settings" on settings for select using (auth.role() = 'authenticated');
create policy "authenticated update settings" on settings for update using (auth.role() = 'authenticated');

create policy "authenticated all invoices" on invoices for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create policy "authenticated all ledger" on ledger for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create policy "authenticated all crm" on crm for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create policy "authenticated all team" on team for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
