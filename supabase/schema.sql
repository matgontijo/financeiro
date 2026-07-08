-- =============================================================================
-- Financeiro Pessoal — schema Postgres (Supabase)
-- Espelha o banco SQLite local. Valores monetários em CENTAVOS (bigint).
--
-- COMO APLICAR (2 minutos, sem senha):
--   1. Abra o painel do projeto no Supabase
--   2. Menu lateral > SQL Editor > New query
--   3. Cole este arquivo inteiro e clique em RUN
-- =============================================================================

create table if not exists accounts (
  id bigint generated always as identity primary key,
  name text not null,
  type text not null default 'corrente'
    check (type in ('corrente', 'poupanca', 'carteira', 'cartao', 'investimento')),
  initial_balance bigint not null default 0,
  color text not null default '#6366f1',
  archived smallint not null default 0,
  closing_day int check (closing_day between 1 and 31),
  due_day int check (due_day between 1 and 31)
);

create table if not exists categories (
  id bigint generated always as identity primary key,
  name text not null,
  kind text not null check (kind in ('receita', 'despesa')),
  color text not null default '#64748b',
  icon text not null default '🏷️',
  archived smallint not null default 0
);

create table if not exists transactions (
  id bigint generated always as identity primary key,
  type text not null check (type in ('receita', 'despesa', 'transferencia')),
  description text not null,
  amount bigint not null check (amount > 0),
  date date not null,
  account_id bigint not null references accounts (id),
  to_account_id bigint references accounts (id),
  category_id bigint references categories (id),
  status text not null default 'pago' check (status in ('pago', 'pendente')),
  notes text,
  recurring_id bigint,
  installment_group text,
  installment_no int,
  installment_total int,
  reconciled smallint not null default 0,
  reconciled_in smallint not null default 0,
  attachment text,
  created_at timestamptz not null default now()
);
create index if not exists idx_tx_date on transactions (date);
create index if not exists idx_tx_account on transactions (account_id);

create table if not exists budgets (
  id bigint generated always as identity primary key,
  category_id bigint not null unique references categories (id),
  amount bigint not null check (amount > 0)
);

create table if not exists recurring (
  id bigint generated always as identity primary key,
  description text not null,
  amount bigint not null check (amount > 0),
  type text not null check (type in ('receita', 'despesa')),
  day int not null default 1 check (day between 1 and 31),
  account_id bigint not null references accounts (id),
  category_id bigint references categories (id),
  active smallint not null default 1
);

create table if not exists goals (
  id bigint generated always as identity primary key,
  name text not null,
  target bigint not null check (target > 0),
  saved bigint not null default 0,
  deadline date,
  color text not null default '#10b981'
);

create table if not exists settings (
  key text primary key,
  value text not null
);

create table if not exists sessions (
  token_hash text primary key,
  created timestamptz not null default now()
);

-- categorias padrão brasileiras (só se a tabela estiver vazia)
insert into categories (name, kind, color, icon)
select * from (values
  ('Salário', 'receita', '#10b981', '💼'),
  ('Renda extra', 'receita', '#22c55e', '🪙'),
  ('Investimentos', 'receita', '#14b8a6', '📈'),
  ('Outras receitas', 'receita', '#84cc16', '➕'),
  ('Moradia', 'despesa', '#f97316', '🏠'),
  ('Mercado', 'despesa', '#ef4444', '🛒'),
  ('Alimentação fora', 'despesa', '#f43f5e', '🍽️'),
  ('Transporte', 'despesa', '#3b82f6', '🚗'),
  ('Saúde', 'despesa', '#ec4899', '🩺'),
  ('Educação', 'despesa', '#8b5cf6', '📚'),
  ('Lazer', 'despesa', '#eab308', '🎬'),
  ('Assinaturas', 'despesa', '#06b6d4', '📱'),
  ('Vestuário', 'despesa', '#a855f7', '👕'),
  ('Impostos e taxas', 'despesa', '#64748b', '🧾'),
  ('Presentes e doações', 'despesa', '#fb7185', '🎁'),
  ('Outras despesas', 'despesa', '#94a3b8', '📦')
) as seed (name, kind, color, icon)
where not exists (select 1 from categories);

insert into accounts (name, type)
select * from (values ('Conta Corrente', 'corrente'), ('Carteira', 'carteira')) as seed (name, type)
where not exists (select 1 from accounts);
