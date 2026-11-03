-- 산내면 콩두부 주문·배달 시스템 DB 설계
-- Supabase 대시보드 > SQL Editor 에 이 파일 전체를 붙여넣고 Run 하세요. (여러 번 실행해도 안전)

------------------------------------------------------------------
-- 0. 관리자 명단 (허용할 구글 이메일)
------------------------------------------------------------------
create table if not exists admins (
  email text primary key,
  name  text,
  created_at timestamptz not null default now()
);

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from admins
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

------------------------------------------------------------------
-- 1. 설정 (단가 등)
------------------------------------------------------------------
create table if not exists settings (
  key   text primary key,
  value text not null
);
insert into settings(key, value) values ('unit_price', '3000')
  on conflict (key) do nothing;

------------------------------------------------------------------
-- 2. 장소 (경로당 39 + 캠핑장 30)
------------------------------------------------------------------
create table if not exists places (
  id           uuid primary key default gen_random_uuid(),
  type         text not null check (type in ('경로당','캠핑장')),
  name         text not null,
  village      text,                 -- 마을/지역 (배달 순서 묶음용)
  address      text,
  contact_name text,
  phone        text,                 -- 직접 주문 본인 확인에 사용
  active       boolean not null default true,
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now(),
  unique (type, name)
);

-- 전화번호는 숫자만 비교
create or replace function digits(t text) returns text
language sql immutable as $$ select regexp_replace(coalesce(t,''), '\D', '', 'g') $$;

------------------------------------------------------------------
-- 3. 주문(요청)과 배달(날짜별 실행)
------------------------------------------------------------------
create table if not exists orders (
  id            uuid primary key default gen_random_uuid(),
  place_id      uuid not null references places(id),
  qty           integer not null check (qty between 1 and 500),
  mode          text not null check (mode in ('once','repeat')),
  delivery_date date,                                    -- once
  repeat_dow    smallint check (repeat_dow between 1 and 5), -- repeat: 1=월 ... 5=금
  repeat_cycle  text check (repeat_cycle in ('매주','격주','매월 첫째 주')),
  repeat_start  date,
  status        text not null default '접수대기'
                check (status in ('접수대기','확정','반려','종료')),
  source        text not null default '직접'
                check (source in ('직접','전화','방문','문자','기타')),
  contact_phone text,
  contact_name  text,
  memo          text,
  created_by    text,                                    -- 대리 입력한 관리자 이메일
  created_at    timestamptz not null default now(),
  check ( (mode = 'once'   and delivery_date is not null)
       or (mode = 'repeat' and repeat_dow is not null and repeat_cycle is not null and repeat_start is not null) )
);
create index if not exists orders_status_idx on orders(status, created_at desc);

create table if not exists deliveries (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references orders(id) on delete cascade,
  place_id      uuid not null references places(id),
  delivery_date date not null,
  qty           integer not null check (qty > 0),
  status        text not null default '예정' check (status in ('예정','완료','취소')),
  delivered_at  timestamptz,
  memo          text,
  unique (order_id, delivery_date)
);
create index if not exists deliveries_date_idx on deliveries(delivery_date);

------------------------------------------------------------------
-- 4. 입금 (장소별 월 1건)
------------------------------------------------------------------
create table if not exists payments (
  id        uuid primary key default gen_random_uuid(),
  place_id  uuid not null references places(id),
  month     date not null check (month = date_trunc('month', month)::date),
  method    text check (method in ('계좌이체','현금','카드')),
  paid_at   date,
  memo      text,
  unique (place_id, month)
);

------------------------------------------------------------------
-- 5. 월별 청구 보기 (배달 완료 건 수량 합산 × 단가)
------------------------------------------------------------------
create or replace view monthly_bills with (security_invoker = true) as
select
  p.id as place_id, p.type, p.name,
  date_trunc('month', d.delivery_date)::date as month,
  sum(d.qty)::int as qty,
  count(*)::int   as drops,
  (sum(d.qty) * (select value::int from settings where key = 'unit_price'))::int as amount,
  pay.id is not null as paid,
  pay.method, pay.paid_at, pay.memo
from deliveries d
join places p on p.id = d.place_id
left join payments pay
  on pay.place_id = d.place_id and pay.month = date_trunc('month', d.delivery_date)::date
where d.status = '완료'
group by p.id, p.type, p.name, date_trunc('month', d.delivery_date), pay.id, pay.method, pay.paid_at, pay.memo;

------------------------------------------------------------------
-- 6. 주문 확정 → 배달 일정 생성 (관리자 전용)
------------------------------------------------------------------
create or replace function confirm_order(p_order uuid, p_occurrences int default 12)
returns int
language plpgsql security definer set search_path = public as $$
declare
  o orders%rowtype;
  d date;
  n int := 0;
  step int;
begin
  if not is_admin() then raise exception '관리자만 사용할 수 있습니다'; end if;
  select * into o from orders where id = p_order for update;
  if not found then raise exception '주문을 찾을 수 없습니다'; end if;
  if o.status = '확정' then return 0; end if;

  if o.mode = 'once' then
    insert into deliveries(order_id, place_id, delivery_date, qty)
    values (o.id, o.place_id, o.delivery_date, o.qty)
    on conflict do nothing;
    n := 1;
  else
    -- 시작일 이후 첫 지정 요일
    d := o.repeat_start + (((o.repeat_dow - extract(isodow from o.repeat_start)::int) + 7) % 7);
    step := case o.repeat_cycle when '격주' then 14 else 7 end;
    while n < least(greatest(p_occurrences,1), 52) loop
      if o.repeat_cycle = '매월 첫째 주' then
        -- 해당 월의 첫 번째 지정 요일 (시작일 이전이면 다음 달로)
        d := date_trunc('month', d)::date
             + (((o.repeat_dow - extract(isodow from date_trunc('month', d))::int) + 7) % 7);
        if d >= o.repeat_start then
          insert into deliveries(order_id, place_id, delivery_date, qty)
          values (o.id, o.place_id, d, o.qty) on conflict do nothing;
          n := n + 1;
        end if;
        d := (date_trunc('month', d) + interval '1 month')::date;
      else
        insert into deliveries(order_id, place_id, delivery_date, qty)
        values (o.id, o.place_id, d, o.qty) on conflict do nothing;
        n := n + 1;
        d := d + step;
      end if;
    end loop;
  end if;

  update orders set status = '확정' where id = o.id;
  return n;
end $$;

------------------------------------------------------------------
-- 7. 비로그인(직접 주문)용 안전한 창구
--    anon 은 테이블을 직접 읽거나 쓸 수 없고, 아래 함수만 호출할 수 있음
------------------------------------------------------------------
-- 장소 목록(연락처 제외)
create or replace function public_places()
returns table(id uuid, type text, name text)
language sql stable security definer set search_path = public as $$
  select id, type, name from places where active order by type, sort_order, name;
$$;

-- 주문 접수: 연락처가 등록된 번호와 일치해야 함
create or replace function submit_order(
  p_place uuid, p_phone text, p_qty int, p_mode text,
  p_date date default null, p_dow int default null, p_cycle text default null,
  p_start date default null, p_memo text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare pl places%rowtype; new_id uuid;
begin
  select * into pl from places where id = p_place and active;
  if not found then raise exception '장소를 찾을 수 없습니다'; end if;
  if digits(pl.phone) = '' or digits(pl.phone) <> digits(p_phone) then
    raise exception '등록된 연락처와 일치하지 않습니다. 관리자에게 전화로 문의해 주세요.';
  end if;
  if p_mode = 'once' and (p_date is null or p_date <= current_date) then
    raise exception '희망 배달일은 내일 이후여야 합니다';
  end if;
  if (select count(*) from orders where place_id = p_place
        and status = '접수대기' and created_at > now() - interval '1 day') >= 5 then
    raise exception '접수 대기 주문이 너무 많습니다. 관리자에게 문의해 주세요.';
  end if;

  insert into orders(place_id, qty, mode, delivery_date, repeat_dow, repeat_cycle, repeat_start,
                     contact_phone, contact_name, memo, source)
  values (p_place, p_qty, p_mode, p_date, p_dow, p_cycle, p_start,
          p_phone, pl.contact_name, left(p_memo, 200), '직접')
  returning id into new_id;
  return new_id;
end $$;

-- 내 주문 확인: 장소 + 연락처가 맞으면 최근 주문과 배달 상태 반환
create or replace function lookup_orders(p_place uuid, p_phone text)
returns table(order_id uuid, created_at timestamptz, qty int, mode text,
              status text, delivery_date date, delivery_status text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from places where id = p_place and active
                 and digits(phone) <> '' and digits(phone) = digits(p_phone)) then
    raise exception '등록된 연락처와 일치하지 않습니다';
  end if;
  return query
    select o.id, o.created_at, o.qty, o.mode, o.status, d.delivery_date, d.status
    from orders o
    left join deliveries d on d.order_id = o.id and d.delivery_date >= current_date - 30
    where o.place_id = p_place and o.created_at > now() - interval '120 days'
    order by o.created_at desc, d.delivery_date
    limit 40;
end $$;

------------------------------------------------------------------
-- 8. 권한 (RLS)
------------------------------------------------------------------
alter table admins     enable row level security;
alter table settings   enable row level security;
alter table places     enable row level security;
alter table orders     enable row level security;
alter table deliveries enable row level security;
alter table payments   enable row level security;

do $$
declare t text;
begin
  foreach t in array array['admins','settings','places','orders','deliveries','payments'] loop
    execute format('drop policy if exists admin_all on %I', t);
    execute format('create policy admin_all on %I for all to authenticated using (is_admin()) with check (is_admin())', t);
  end loop;
end $$;

-- 기본 권한 정리: 비로그인(anon)은 테이블 접근 불가, 필요한 함수만 허용
revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from public, anon;
grant execute on function public_places()                          to anon, authenticated;
grant execute on function submit_order(uuid,text,int,text,date,int,text,date,text) to anon, authenticated;
grant execute on function lookup_orders(uuid,text)                 to anon, authenticated;
grant execute on function confirm_order(uuid,int)                  to authenticated;
grant execute on function is_admin()                               to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;

------------------------------------------------------------------
-- 9. 첫 관리자 등록 (아래 이메일을 본인 구글 이메일로 바꿔서 실행)
------------------------------------------------------------------
-- insert into admins(email, name) values ('your.name@gmail.com', '홍길동');
