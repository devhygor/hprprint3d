-- HPR Print 3D: tabela de pedidos e regras de segurança.
-- Cole tudo no Supabase em: SQL Editor > New query > Run.
-- Se você já rodou uma versão anterior, rode esta de novo: ela só acrescenta o que falta.
-- Pode rodar de novo sem problema (não apaga pedidos existentes).

-- 1) Quem é da equipe (só esses e-mails conseguem ver e mudar pedidos)
create table if not exists public.equipe (
  email text primary key
);
alter table public.equipe enable row level security;
-- Sem políticas: ninguém lê ou altera essa lista pelo site. Edite só por aqui.

insert into public.equipe (email) values
  ('hygor.k92@gmail.com'),
  ('patriccya.sousa@gmail.com')
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
alter table public.pedidos add column if not exists email       text;
alter table public.pedidos add column if not exists cliente_id  uuid references auth.users(id) on delete set null;
alter table public.pedidos add column if not exists referencias jsonb not null default '[]'::jsonb;
alter table public.pedidos enable row level security;

drop policy if exists "site registra pedido" on public.pedidos;
drop policy if exists "equipe le pedidos" on public.pedidos;
drop policy if exists "equipe cria pedidos" on public.pedidos;
drop policy if exists "equipe altera pedidos" on public.pedidos;
drop policy if exists "equipe exclui pedidos" on public.pedidos;

-- O formulário do site só consegue CRIAR um pedido novo, com campos limitados.
-- Não consegue ler, alterar nem apagar nada.
drop function if exists public.pedido_do_site_valido(public.pedidos);
drop policy if exists "cliente registra pedido" on public.pedidos;

-- Visitante sem login
create policy "site registra pedido" on public.pedidos
  for insert to anon
  with check (
    origem = 'site'
    and status = 'novo'
    and id ~ '^HPR-[0-9]{4}-[A-Z0-9]{3,6}$'
    and valor is null and sinal is null and notas is null and peca_id is null and entrega is null
    and char_length(coalesce(cliente, ''))  <= 120
    and char_length(coalesce(telefone, '')) <= 30
    and char_length(coalesce(email, ''))    <= 200
    and char_length(coalesce(cidade, ''))   <= 160
    and char_length(coalesce(peca, ''))     <= 300
    and char_length(coalesce(cor, ''))      <= 120
    and char_length(coalesce(prazo, ''))    <= 160
    and char_length(coalesce(detalhes, '')) <= 2000
    and char_length(coalesce(mensagem, '')) <= 4000
    and jsonb_array_length(historico) <= 1
    and jsonb_typeof(referencias) = 'array' and jsonb_array_length(referencias) <= 3
    and cliente_id is null
  );

-- Cliente logado: o pedido fica ligado à conta dele
create policy "cliente registra pedido" on public.pedidos
  for insert to authenticated
  with check (
    origem = 'site'
    and status = 'novo'
    and id ~ '^HPR-[0-9]{4}-[A-Z0-9]{3,6}$'
    and valor is null and sinal is null and notas is null and peca_id is null and entrega is null
    and char_length(coalesce(cliente, ''))  <= 120
    and char_length(coalesce(telefone, '')) <= 30
    and char_length(coalesce(email, ''))    <= 200
    and char_length(coalesce(cidade, ''))   <= 160
    and char_length(coalesce(peca, ''))     <= 300
    and char_length(coalesce(cor, ''))      <= 120
    and char_length(coalesce(prazo, ''))    <= 160
    and char_length(coalesce(detalhes, '')) <= 2000
    and char_length(coalesce(mensagem, '')) <= 4000
    and jsonb_array_length(historico) <= 1
    and jsonb_typeof(referencias) = 'array' and jsonb_array_length(referencias) <= 3
    and cliente_id = auth.uid()
  );

-- A equipe (logada com e-mail e senha) faz tudo.
create policy "equipe le pedidos"     on public.pedidos for select to authenticated using (public.eh_equipe());
create policy "equipe cria pedidos"   on public.pedidos for insert to authenticated with check (public.eh_equipe());
create policy "equipe altera pedidos" on public.pedidos for update to authenticated using (public.eh_equipe()) with check (public.eh_equipe());
create policy "equipe exclui pedidos" on public.pedidos for delete to authenticated using (public.eh_equipe());

grant insert on public.pedidos to anon;
grant select, insert, update, delete on public.pedidos to authenticated;

-- 3) Peças: a vitrine (anon) só enxerga as colunas públicas das peças ativas.
--    Os custos ficam na coluna "interno", que só a equipe lê.
create table if not exists public.pecas (
  id            text primary key,
  nome          text not null,
  categoria     text,
  descricao     text,
  foto          text,
  preco         numeric(10,2),
  ativo         boolean not null default true,
  ordem         integer not null default 0,
  interno       jsonb not null default '{}'::jsonb,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
alter table public.pecas add column if not exists cores           jsonb not null default '[]'::jsonb;
alter table public.pecas add column if not exists caracteristicas jsonb not null default '{}'::jsonb;
alter table public.pecas enable row level security;

drop policy if exists "vitrine le pecas ativas" on public.pecas;
drop policy if exists "equipe gerencia pecas" on public.pecas;
create policy "vitrine le pecas ativas" on public.pecas for select to anon using (ativo);
create policy "equipe gerencia pecas" on public.pecas for all to authenticated using (public.eh_equipe()) with check (public.eh_equipe());

revoke all on public.pecas from anon;
grant select (id, nome, categoria, descricao, foto, preco, ativo, ordem, cores, caracteristicas) on public.pecas to anon;
grant select, insert, update, delete on public.pecas to authenticated;

-- 4) Ajustes: "site" (WhatsApp, Instagram) é público; "config" (custos) só a equipe.
create table if not exists public.ajustes (
  chave         text primary key,
  valor         jsonb not null default '{}'::jsonb,
  atualizado_em timestamptz not null default now()
);
alter table public.ajustes enable row level security;

drop policy if exists "vitrine le dados da loja" on public.ajustes;
drop policy if exists "equipe gerencia ajustes" on public.ajustes;
create policy "vitrine le dados da loja" on public.ajustes for select to anon using (chave = 'site');
create policy "equipe gerencia ajustes" on public.ajustes for all to authenticated using (public.eh_equipe()) with check (public.eh_equipe());

revoke all on public.ajustes from anon;
grant select on public.ajustes to anon;
grant select, insert, update, delete on public.ajustes to authenticated;

insert into public.ajustes (chave, valor) values
  ('site', '{"nome":"HPR Print 3D","instagram":"https://www.instagram.com/hprprint3d/","whatsapp":"5561981600889","destaquesInstagram":[]}')
on conflict (chave) do nothing;

-- A oficina pergunta se quem entrou é da equipe
grant execute on function public.eh_equipe() to authenticated;

-- 5) Fotos das peças (armazenamento público para leitura, só a equipe envia)
insert into storage.buckets (id, name, public)
values ('fotos', 'fotos', true)
on conflict (id) do update set public = true;

drop policy if exists "equipe envia fotos" on storage.objects;
drop policy if exists "equipe altera fotos" on storage.objects;
drop policy if exists "equipe apaga fotos" on storage.objects;
create policy "equipe envia fotos" on storage.objects for insert to authenticated
  with check (bucket_id = 'fotos' and public.eh_equipe());
create policy "equipe altera fotos" on storage.objects for update to authenticated
  using (bucket_id = 'fotos' and public.eh_equipe());
create policy "equipe apaga fotos" on storage.objects for delete to authenticated
  using (bucket_id = 'fotos' and public.eh_equipe());

-- 6) Área do cliente: cada cliente vê só os próprios pedidos, sem anotações internas.
--    Vale para pedidos feitos logado ou com o mesmo e-mail (se o e-mail da conta foi confirmado).
create or replace function public.meu_email_confirmado()
returns text
language sql stable security definer
set search_path = ''
as $$
  select lower(email) from auth.users
  where id = auth.uid() and email_confirmed_at is not null;
$$;

create or replace function public.meus_pedidos()
returns table (
  id text, criado_em timestamptz, atualizado_em timestamptz, status text, peca text, quantidade integer,
  cor text, prazo text, entrega date, valor numeric, sinal numeric, historico jsonb, qtd_referencias integer
)
language sql stable security definer
set search_path = ''
as $$
  select p.id, p.criado_em, p.atualizado_em, p.status, p.peca, p.quantidade, p.cor, p.prazo, p.entrega,
         p.valor, p.sinal, p.historico, jsonb_array_length(p.referencias)
  from public.pedidos p
  where auth.uid() is not null
    and (p.cliente_id = auth.uid() or (p.email is not null and lower(p.email) = public.meu_email_confirmado()))
  order by p.criado_em desc
  limit 100;
$$;
revoke all on function public.meus_pedidos() from public, anon;
grant execute on function public.meus_pedidos() to authenticated;
revoke all on function public.meu_email_confirmado() from public, anon;
grant execute on function public.meu_email_confirmado() to authenticated;

-- 7) Imagens de referência que o cliente manda no pedido (privadas: só a equipe vê)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('referencias', 'referencias', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false, file_size_limit = 5242880,
  allowed_mime_types = array['image/jpeg','image/png','image/webp'];

drop policy if exists "site envia referencias" on storage.objects;
drop policy if exists "equipe ve referencias" on storage.objects;
drop policy if exists "equipe apaga referencias" on storage.objects;
create policy "site envia referencias" on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'referencias' and (storage.foldername(name))[1] ~ '^HPR-[0-9]{4}-[A-Z0-9]{3,6}$');
create policy "equipe ve referencias" on storage.objects for select to authenticated
  using (bucket_id = 'referencias' and public.eh_equipe());
create policy "equipe apaga referencias" on storage.objects for delete to authenticated
  using (bucket_id = 'referencias' and public.eh_equipe());

-- 8) Pedidos novos aparecem na hora na oficina (tempo real)
do $$
begin
  alter publication supabase_realtime add table public.pedidos;
exception when duplicate_object then null;
end $$;
