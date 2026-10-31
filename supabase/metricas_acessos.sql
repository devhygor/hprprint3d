-- HPR Print 3D: métricas de acesso (aba "Acessos" da oficina).
-- Cole no Supabase em: SQL Editor > New query > Run. Pode rodar de novo sem problema.
-- Pré-requisito: docs/supabase.sql já rodado (usa public.eh_equipe()).
-- Sem cookies e sem dados pessoais: só um id aleatório do navegador, a página, o domínio de origem e o tipo de aparelho.

-- 1) Tabela
create table if not exists public.page_views (
  id            bigint generated always as identity primary key,
  created_at    timestamptz not null default now(),
  visitor_id    text not null,
  path          text not null,
  referrer_host text,
  device        text not null default 'desktop'
);

-- Limites de tamanho: o site é público, então a tabela se defende de lixo
alter table public.page_views drop constraint if exists page_views_limites;
alter table public.page_views add constraint page_views_limites check (
  char_length(visitor_id) between 8 and 64
  and char_length(path) between 1 and 200 and path like '/%'
  and (referrer_host is null or char_length(referrer_host) between 1 and 100)
  and device in ('desktop', 'mobile', 'tablet')
);

create index if not exists page_views_created_idx on public.page_views (created_at desc);
create index if not exists page_views_visitor_idx on public.page_views (visitor_id, created_at desc);
create index if not exists page_views_path_idx on public.page_views (path, created_at desc);

-- 2) Segurança (RLS): o público só ESCREVE; ninguém lê a tabela direto
alter table public.page_views enable row level security;
drop policy if exists "site registra visita" on public.page_views;
create policy "site registra visita" on public.page_views for insert to anon, authenticated
  with check (
    char_length(visitor_id) between 8 and 64
    and char_length(path) between 1 and 200 and path like '/%'
    and (referrer_host is null or char_length(referrer_host) between 1 and 100)
    and device in ('desktop', 'mobile', 'tablet')
  );
revoke all on public.page_views from anon, authenticated;
-- Só estas colunas podem ser enviadas (created_at e id não dá para forjar)
grant insert (visitor_id, path, referrer_host, device) on public.page_views to anon, authenticated;
-- Sem policy de select/update/delete e sem grant: a leitura é só pelas funções abaixo.

-- 3) Resumo para a oficina (só equipe). Dias contados no horário de São Paulo.
create or replace function public.metricas_acessos(p_dias int default 30)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  fuso constant text := 'America/Sao_Paulo';
  dias int := least(greatest(coalesce(p_dias, 30), 1), 180);
  hoje date := (now() at time zone fuso)::date;
  inicio timestamptz := ((hoje - (dias - 1))::timestamp) at time zone fuso;
  r jsonb;
begin
  if not public.eh_equipe() then
    raise exception 'sem permissão' using errcode = '42501';
  end if;

  with v as (
    select created_at, (created_at at time zone fuso)::date as dia, visitor_id, path, referrer_host, device
    from public.page_views
    where created_at >= inicio
  )
  select jsonb_build_object(
    'resumo', jsonb_build_object(
      'hoje', (select jsonb_build_object('visitas', count(*), 'unicos', count(distinct visitor_id)) from v where dia = hoje),
      'd7',   (select jsonb_build_object('visitas', count(*), 'unicos', count(distinct visitor_id)) from v where dia > hoje - 7),
      'd30',  (select jsonb_build_object('visitas', count(*), 'unicos', count(distinct visitor_id)) from v where dia > hoje - 30)
    ),
    'serie', (
      select coalesce(jsonb_agg(jsonb_build_object('dia', g.d::date, 'visitas', coalesce(s.visitas, 0), 'unicos', coalesce(s.unicos, 0)) order by g.d), '[]'::jsonb)
      from generate_series(hoje - (dias - 1), hoje, interval '1 day') as g(d)
      left join (select dia, count(*) as visitas, count(distinct visitor_id) as unicos from v group by dia) s on s.dia = g.d::date
    ),
    'paginas', (
      select coalesce(jsonb_agg(x order by x.visitas desc), '[]'::jsonb) from (
        select path, count(*) as visitas, count(distinct visitor_id) as unicos
        from v where dia > hoje - 30 group by path order by count(*) desc limit 10
      ) x
    ),
    'origens', (
      select coalesce(jsonb_agg(x order by x.visitas desc), '[]'::jsonb) from (
        select coalesce(referrer_host, '') as origem, count(*) as visitas, count(distinct visitor_id) as unicos
        from v where dia > hoje - 30 group by 1 order by count(*) desc limit 10
      ) x
    ),
    'dispositivos', (
      select coalesce(jsonb_agg(x order by x.visitas desc), '[]'::jsonb) from (
        select device, count(*) as visitas, count(distinct visitor_id) as unicos
        from v where dia > hoje - 30 group by device order by count(*) desc
      ) x
    )
  ) into r;
  return r;
end;
$$;
revoke all on function public.metricas_acessos(int) from public, anon;
grant execute on function public.metricas_acessos(int) to authenticated;

-- 4) Limpeza: apaga visitas com mais de 180 dias (cabe folgado nos 500 MB do plano gratuito)
create or replace function public.limpar_page_views()
returns bigint
language plpgsql security definer
set search_path = ''
as $$
declare apagadas bigint;
begin
  -- Chamada pelo agendador (sem login) ou pela equipe; anon nem tem permissão de executar
  if auth.uid() is not null and not public.eh_equipe() then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  delete from public.page_views where created_at < now() - interval '180 days';
  get diagnostics apagadas = row_count;
  return apagadas;
end;
$$;
revoke all on function public.limpar_page_views() from public, anon;
grant execute on function public.limpar_page_views() to authenticated;

-- Agenda diária (03:15 UTC) com pg_cron. Se a extensão não estiver ativa, o bloco só avisa
-- e a aba "Acessos" da oficina faz a limpeza sozinha ao abrir.
do $$
begin
  create extension if not exists pg_cron;
  perform cron.unschedule(jobid) from cron.job where jobname = 'limpar-page-views';
  perform cron.schedule('limpar-page-views', '15 3 * * *', 'select public.limpar_page_views()');
exception when others then
  raise notice 'pg_cron indisponível (%). A limpeza será feita pela aba Acessos da oficina.', sqlerrm;
end $$;
