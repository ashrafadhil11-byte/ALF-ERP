-- 014 — Extra charges with conditions (cargo type / destination, auto-add) + document slab freight.
--  • charge_items: same name may have different prices per cargo type (Handling: Air 2.000 / Sea 2.500 per box)
--  • rate_cards method doc_slab: first slab weight at a fixed price, then each extra step (actual weight only)

alter table public.charge_items add column if not exists cargo_type_code   text not null default '*';
alter table public.charge_items add column if not exists dest_country_code text not null default '*';
alter table public.charge_items add column if not exists auto_add          boolean not null default false;
alter table public.charge_items drop constraint if exists charge_items_branch_code_name_key;
create unique index if not exists charge_items_key on public.charge_items (branch_code, name, cargo_type_code, dest_country_code);

alter table public.rate_cards add column if not exists slab jsonb not null default '{}';   -- { "base_kg": 0.5, "base_price": 5, "step_kg": 0.5, "step_price": 2 }
alter table public.rate_cards drop constraint if exists rate_cards_method_check;
alter table public.rate_cards add constraint rate_cards_method_check
    check (method in ('per_kg', 'vol_band', 'per_package', 'per_box', 'per_cbm', 'box_size', 'doc_slab'));

insert into public.commodities (code, name, sort) values ('DOC', 'Documents', 20) on conflict (code) do nothing;
