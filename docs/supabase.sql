-- HPR Print 3D: tabela de pedidos e regras de segurança.
-- Cole tudo no Supabase em: SQL Editor > New query > Run.
-- Pode rodar de novo sem problema (não apaga pedidos existentes).

-- 1) Quem é da equipe (só esses e-mails conseguem ver e mudar pedidos)
create table if not exists public.equipe (
  email text primary key
);
alter table public.equipe enable row level security;
-- Sem políticas: ninguém lê ou altera essa lista pelo site. Edite só por aqui.

insert into public.equipe (email) values
  ('hygor.k92@gmail.com'),
  ('EMAIL_DA_PATRICCYA@exemplo.com')   -- troque pelo e-mail dela
on conflict do nothing;

create or replace function public.eh_equipe()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.equipe
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

-- 2) Pedidos
create table if not exists public.pedidos (
  id            text primary key,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  origem        text not null default 'site' check (origem in ('site', 'manual')),
  status        text not null default 'novo'
                check (status in ('novo','orcamento','aprovado','imprimindo','pronto','entregue','cancelado')),
  cliente       text,
  telefone      text,
  cidade        text,
  peca          text,
  peca_id       text,
  quantidade    integer not null default 1 check (quantidade between 1 and 10000),
  cor           text,
  prazo         text,
  entrega       date,
  detalhes      text,
  valor         numeric(10,2),
  sinal         numeric(10,2),
  notas         text,
  mensagem      text,
  historico     jsonb not null default '[]'::jsonb
);
alter table public.pedidos enable row level security;

drop policy if exists "site registra pedido" on public.pedidos;
drop policy if exists "equipe le pedidos" on public.pedidos;
drop policy if exists "equipe cria pedidos" on public.pedidos;
drop policy if exists "equipe altera pedidos" on public.pedidos;
drop policy if exists "equipe exclui pedidos" on public.pedidos;

-- O formulário do site só consegue CRIAR um pedido novo, com campos limitados.
-- Não consegue ler, alterar nem apagar nada.
create policy "site registra pedido" on public.pedidos
  for insert to anon
  with check (
    origem = 'site'
    and status = 'novo'
    and id ~ '^HPR-[0-9]{4}-[A-Z0-9]{3,6}$'
    and valor is null and sinal is null and notas is null and peca_id is null and entrega is null
    and char_length(coalesce(cliente, ''))  <= 120
    and char_length(coalesce(telefone, '')) <= 30
    and char_length(coalesce(cidade, ''))   <= 160
    and char_length(coalesce(peca, ''))     <= 300
    and char_length(coalesce(cor, ''))      <= 120
    and char_length(coalesce(prazo, ''))    <= 160
    and char_length(coalesce(detalhes, '')) <= 2000
    and char_length(coalesce(mensagem, '')) <= 4000
    and jsonb_array_length(historico) <= 1
  );

-- A equipe (logada com e-mail e senha) faz tudo.
create policy "equipe le pedidos"     on public.pedidos for select to authenticated using (public.eh_equipe());
create policy "equipe cria pedidos"   on public.pedidos for insert to authenticated with check (public.eh_equipe());
create policy "equipe altera pedidos" on public.pedidos for update to authenticated using (public.eh_equipe()) with check (public.eh_equipe());
create policy "equipe exclui pedidos" on public.pedidos for delete to authenticated using (public.eh_equipe());

grant insert on public.pedidos to anon;
grant select, insert, update, delete on public.pedidos to authenticated;

-- 3) Pedidos novos aparecem na hora na oficina (tempo real)
do $$
begin
  alter publication supabase_realtime add table public.pedidos;
exception when duplicate_object then null;
end $$;
