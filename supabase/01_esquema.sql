-- =====================================================================
--  MIS CUENTAS · Esquema de base de datos (Supabase / PostgreSQL)
--  Pega TODO este archivo en Supabase → SQL Editor → New query → Run.
--  Se puede ejecutar más de una vez sin romper nada.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 1. TABLAS
-- ---------------------------------------------------------------------

-- Perfil del usuario: ajustes y token secreto para MacroDroid
create table if not exists public.perfil (
  user_id         uuid primary key references auth.users(id) on delete cascade,
  ingresos_fijos  numeric(12,2) not null default 0,     -- p.ej. la paguita mensual
  inflacion       numeric(5,2)  not null default 3,     -- % objetivo a superar
  token_ingesta   uuid not null default gen_random_uuid() unique,
  creado          timestamptz not null default now()
);

-- Categorías de gasto e ingreso
create table if not exists public.categorias (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  nombre      text not null,
  tipo        text not null check (tipo in ('gasto','ingreso')),
  color       text not null default '#2e9e5b',
  icono       text not null default '•',
  presupuesto numeric(12,2),                -- límite mensual (solo gastos)
  generado    boolean not null default true,-- ingresos: true = lo generas tú (trabajo, inversiones…); false = paguita/ayuda
  orden       int not null default 0,
  unique (user_id, nombre, tipo)
);

-- Movimientos
--   tipo = 'gasto'        → resta
--   tipo = 'ingreso'      → suma
--   tipo = 'compensacion' → dinero que te devuelven (p.ej. un Bizum de un amigo por una cena).
--                           No cuenta como ingreso: reduce el gasto de su categoría.
create table if not exists public.movimientos (
  id             bigint generated always as identity primary key,
  user_id        uuid not null references auth.users(id) on delete cascade,
  fecha          timestamptz not null default now(),
  importe        numeric(12,2) not null check (importe >= 0),
  tipo           text not null check (tipo in ('gasto','ingreso','compensacion')),
  categoria_id   bigint references public.categorias(id) on delete set null,
  concepto       text not null default '',
  descripcion    text,
  origen         text not null default 'manual' check (origen in ('notificacion','manual','excel')),
  texto_original text,
  revisar        boolean not null default false,
  creado         timestamptz not null default now()
);
create index if not exists movimientos_user_fecha on public.movimientos (user_id, fecha desc);

-- Reglas para categorizar solas las notificaciones (si el concepto contiene "patron")
create table if not exists public.reglas (
  id           bigint generated always as identity primary key,
  user_id      uuid not null references auth.users(id) on delete cascade,
  patron       text not null,
  categoria_id bigint not null references public.categorias(id) on delete cascade,
  unique (user_id, patron)
);

-- Cuentas (dinero líquido): ahorro, corriente, efectivo
create table if not exists public.cuentas (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  nombre      text not null,
  tipo        text not null default 'ahorro' check (tipo in ('corriente','ahorro','efectivo')),
  saldo       numeric(12,2) not null default 0,
  actualizado timestamptz not null default now()
);

-- Inversiones
create table if not exists public.inversiones (
  id           bigint generated always as identity primary key,
  user_id      uuid not null references auth.users(id) on delete cascade,
  nombre       text not null,
  tipo         text not null default 'Fondo',   -- Fondo, Acciones, ETF, Cripto, Depósito…
  aportado     numeric(12,2) not null default 0,
  valor_actual numeric(12,2) not null default 0,
  actualizado  timestamptz not null default now()
);

-- Registro de todas las notificaciones recibidas (sirve para depurar el lector)
create table if not exists public.notificaciones (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references auth.users(id) on delete cascade,
  recibida      timestamptz not null default now(),
  titulo        text,
  texto         text,
  resultado     text not null,           -- creado | duplicado | ignorado
  movimiento_id bigint references public.movimientos(id) on delete set null
);
create index if not exists notificaciones_user on public.notificaciones (user_id, recibida desc);

-- ---------------------------------------------------------------------
-- 2. SEGURIDAD: cada usuario solo ve y toca sus propios datos
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['perfil','categorias','movimientos','reglas','cuentas','inversiones','notificaciones'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "solo_mis_datos" on public.%I', t);
    execute format(
      'create policy "solo_mis_datos" on public.%I for all to authenticated
         using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
  end loop;
end $$;

-- Rellena user_id automáticamente al insertar desde la app
do $$
declare t text;
begin
  foreach t in array array['categorias','movimientos','reglas','cuentas','inversiones'] loop
    execute format('alter table public.%I alter column user_id set default auth.uid()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 3. DATOS INICIALES de cada usuario nuevo (basados en tu Excel)
-- ---------------------------------------------------------------------
create or replace function public.crear_datos_iniciales(p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.perfil (user_id) values (p_user) on conflict do nothing;

  insert into public.categorias (user_id, nombre, tipo, color, icono, orden, generado) values
    (p_user, 'Comida',      'gasto',   '#e8833a', '🍔', 1, true),
    (p_user, 'Fiesta',      'gasto',   '#9b59d0', '🎉', 2, true),
    (p_user, 'Tabaco',      'gasto',   '#8a6d5a', '🚬', 3, true),
    (p_user, 'Viaje',       'gasto',   '#2f8fd8', '✈️', 4, true),
    (p_user, 'Poker',       'gasto',   '#d64545', '🃏', 5, true),
    (p_user, 'Otros',       'gasto',   '#7f8c8d', '📦', 6, true),
    (p_user, 'Paguita',     'ingreso', '#f2b632', '💶', 1, false),
    (p_user, 'Trabajo',     'ingreso', '#2e9e5b', '💼', 2, true),
    (p_user, 'Inversiones', 'ingreso', '#16a085', '📈', 3, true),
    (p_user, 'Poker',       'ingreso', '#d64545', '🃏', 4, true)
  on conflict do nothing;

  -- Reglas automáticas de ejemplo (puedes añadir más desde la app)
  insert into public.reglas (user_id, patron, categoria_id)
  select p_user, r.patron, c.id
  from (values
    ('MERCADONA','Comida'),('CONSUM','Comida'),('LIDL','Comida'),('CARREFOUR','Comida'),
    ('ALDI','Comida'),('DIA ','Comida'),('BURGER','Comida'),('MCDONALD','Comida'),
    ('TELEPIZZA','Comida'),('GLOVO','Comida'),('JUST EAT','Comida'),
    ('ESTANCO','Tabaco'),('TABAC','Tabaco'),
    ('REPSOL','Viaje'),('CEPSA','Viaje'),('GALP','Viaje'),('RENFE','Viaje'),
    ('RYANAIR','Viaje'),('VUELING','Viaje'),('BOOKING','Viaje'),
    ('POKERSTARS','Poker'),('PARKING','Otros'),('AMAZON','Otros')
  ) as r(patron, cat)
  join public.categorias c on c.user_id = p_user and c.nombre = r.cat and c.tipo = 'gasto'
  on conflict do nothing;
end $$;

create or replace function public.al_crear_usuario()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public.crear_datos_iniciales(new.id);
  return new;
end $$;

drop trigger if exists al_crear_usuario on auth.users;
create trigger al_crear_usuario after insert on auth.users
  for each row execute function public.al_crear_usuario();

-- Por si ya te registraste antes de ejecutar este script
select public.crear_datos_iniciales(id) from auth.users;

-- ---------------------------------------------------------------------
-- 4. LECTOR DE NOTIFICACIONES DEL SABADELL
--    Devuelve: tipo, importe y concepto a partir del texto.
--    Ejemplos reales:
--      "Has recibido un Bizum de 23,00 EUR de MARIA GARCIA"
--      "💳 Nueva compra de 12,00 EUR TORRES, ES, realizada con tu tarjeta…"
-- ---------------------------------------------------------------------
create or replace function public.leer_notificacion(p_texto text,
  out tipo text, out importe numeric, out concepto text)
language plpgsql immutable set search_path = '' as $$
declare
  t      text;
  m      text[];
  num    text;
  resto  text;
begin
  -- limpiar: quitar emojis/símbolos del principio y espacios repetidos
  t := regexp_replace(coalesce(p_texto, ''), '^[^[:alnum:]]+', '');
  t := btrim(regexp_replace(t, '\s+', ' ', 'g'));

  -- importe: 1.234,56 EUR · 12,00 EUR · 12 € · -12,00EUR
  m := regexp_match(t, '([0-9]{1,3}(?:\.[0-9]{3})+(?:,[0-9]{1,2})?|[0-9]+(?:,[0-9]{1,2})?)\s*(?:EUR|€|euros?)', 'i');
  if m is null then
    tipo := null; importe := null; concepto := null;   -- no es un movimiento
    return;
  end if;
  num     := m[1];
  importe := replace(replace(num, '.', ''), ',', '.')::numeric;
  -- lo que viene después del importe
  resto := btrim(substr(t, strpos(t, num) + length(num)));
  resto := btrim(regexp_replace(resto, '^(EUR|€|euros?)\s*', '', 'i'));

  -- ¿entra o sale dinero?
  if t ~* '(has recibido|te ha(n)? (enviado|hecho|pagado)|abono|ingreso|transferencia recibida|devoluci|reembolso|n[oó]mina|te devuelven)' then
    tipo := 'ingreso';
  else
    tipo := 'gasto';
  end if;

  -- concepto según el tipo de aviso
  if t ~* 'bizum' then
    if tipo = 'ingreso' then
      m := regexp_match(resto, '^de\s+(.+)$', 'i');
      concepto := 'Bizum de ' || coalesce(m[1], resto);
    else
      m := regexp_match(resto, '^(?:a|para)\s+(.+)$', 'i');
      concepto := 'Bizum a ' || coalesce(m[1], resto);
    end if;
  elsif t ~* '(compra|pago con tarjeta|cargo)' then
    -- "TORRES, ES, realizada…" → "TORRES"
    resto := regexp_replace(resto, '^(en|a)\s+', '', 'i');
    m := regexp_match(resto, '^(.+?),\s*[A-Z]{2}\M');
    concepto := btrim(coalesce(m[1], split_part(resto, ',', 1)));
  elsif t ~* 'transferencia' then
    m := regexp_match(resto, '^(?:de|a)\s+(.+)$', 'i');
    concepto := 'Transferencia ' || coalesce(m[1], resto);
  elsif t ~* 'recibo' then
    concepto := 'Recibo ' || resto;
  else
    concepto := t;
  end if;

  concepto := btrim(regexp_replace(concepto, '(\.\.|…)+$', ''));
  if concepto = '' or concepto ~* '^(bizum de|bizum a)$' then concepto := t; end if;
  concepto := left(concepto, 120);
end $$;

-- ---------------------------------------------------------------------
-- 5. PUNTO DE ENTRADA PARA MACRODROID
--    POST https://<proyecto>.supabase.co/rest/v1/rpc/registrar_notificacion
--    Cabeceras: apikey: <clave publishable/anon> · Content-Type: application/json
--    Cuerpo:    {"p_token":"<tu token>","p_titulo":"...","p_texto":"..."}
-- ---------------------------------------------------------------------
create or replace function public.registrar_notificacion(p_token uuid, p_texto text, p_titulo text default null)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_user  uuid;
  v_leido record;
  v_cat   bigint;
  v_id    bigint;
  v_revisar boolean;
begin
  select user_id into v_user from public.perfil where token_ingesta = p_token;
  if v_user is null then
    raise exception 'Token no válido' using errcode = '28000';
  end if;

  -- duplicados: la misma notificación en los últimos 10 minutos
  if exists (select 1 from public.notificaciones
             where user_id = v_user and texto = p_texto and resultado = 'creado'
               and recibida > now() - interval '10 minutes') then
    insert into public.notificaciones (user_id, titulo, texto, resultado) values (v_user, p_titulo, p_texto, 'duplicado');
    return json_build_object('resultado', 'duplicado');
  end if;

  select * into v_leido from public.leer_notificacion(p_texto);
  if v_leido.importe is null then
    insert into public.notificaciones (user_id, titulo, texto, resultado) values (v_user, p_titulo, p_texto, 'ignorado');
    return json_build_object('resultado', 'ignorado', 'motivo', 'no contiene importe');
  end if;

  -- categoría automática por reglas (solo gastos)
  if v_leido.tipo = 'gasto' then
    select r.categoria_id into v_cat
    from public.reglas r
    where r.user_id = v_user and v_leido.concepto ilike '%' || r.patron || '%'
    order by length(r.patron) desc limit 1;
  end if;

  -- se marca para revisar si no tiene categoría (los Bizum recibidos pueden ser
  -- un ingreso o una compensación: lo decides tú en la app)
  v_revisar := v_cat is null;

  insert into public.movimientos (user_id, fecha, importe, tipo, categoria_id, concepto, origen, texto_original, revisar)
  values (v_user, now(), v_leido.importe, v_leido.tipo, v_cat, v_leido.concepto, 'notificacion', p_texto, v_revisar)
  returning id into v_id;

  insert into public.notificaciones (user_id, titulo, texto, resultado, movimiento_id)
  values (v_user, p_titulo, p_texto, 'creado', v_id);

  return json_build_object('resultado', 'creado', 'id', v_id, 'tipo', v_leido.tipo,
                           'importe', v_leido.importe, 'concepto', v_leido.concepto);
end $$;

revoke all on function public.registrar_notificacion(uuid, text, text) from public;
grant execute on function public.registrar_notificacion(uuid, text, text) to anon, authenticated;
grant execute on function public.leer_notificacion(text) to authenticated;
revoke execute on function public.crear_datos_iniciales(uuid) from public, anon, authenticated;

-- Avisar a la app en tiempo real cuando entra un movimiento nuevo
do $$ begin
  alter publication supabase_realtime add table public.movimientos;
exception when others then null; end $$;

-- Para regenerar el token desde la app (si alguna vez se filtra)
create or replace function public.nuevo_token()
returns uuid language sql security definer set search_path = '' as $$
  update public.perfil set token_ingesta = gen_random_uuid()
  where user_id = auth.uid() returning token_ingesta;
$$;
revoke all on function public.nuevo_token() from public, anon;
grant execute on function public.nuevo_token() to authenticated;

-- ---------------------------------------------------------------------
-- 6. PERMISOS de las tablas para el usuario que ha iniciado sesión
--    (las reglas RLS de arriba limitan cada fila a su dueño)
-- ---------------------------------------------------------------------
grant usage on schema public to authenticated, anon;
grant select, update on public.perfil to authenticated;
grant select on public.notificaciones to authenticated;
grant select, insert, update, delete on public.categorias, public.movimientos, public.reglas, public.cuentas, public.inversiones to authenticated;
grant usage, select on all sequences in schema public to authenticated;
