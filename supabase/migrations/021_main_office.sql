-- 021_main_office.sql — Main Office cash & bank, transfers between locations, payments made for branches.
--
-- Main Office is a location of its own (branches.branch_type = 'main_office'), with its own books like the warehouse.
-- Its cash is account 1000 in its books (the cash closing works as for any branch). Bank accounts are listed in
-- money_accounts, each with its own ledger account (1021–1049), held by Main Office or by a branch.
--
-- Money moving between Main Office and a branch is never an expense. Each side keeps a running balance with the
-- other, which cancels out when all locations are reported together:
--     branch books       2060 Due to main office          (credit = the branch owes Main Office)
--     Main Office books  1160 Due from branches           (debit  = branches owe Main Office)
-- Cash sent to another location's drawer waits in 1050 Cash in transit until the receiving side confirms it.

-- ---------- location type, cashier flag, ledger accounts ----------
alter table public.branches drop constraint if exists branches_branch_type_check;
alter table public.branches add constraint branches_branch_type_check check (branch_type in ('branch', 'warehouse', 'main_office'));
create unique index if not exists branches_one_main_office on public.branches ((true)) where branch_type = 'main_office';

alter table public.employees add column if not exists is_cashier boolean not null default false;

insert into public.accounts (code, name, type, is_system, active) values
    ('1050', 'Cash in transit', 'asset', true, true),
    ('1160', 'Due from branches (main office)', 'asset', true, true),
    ('2060', 'Due to main office', 'liability', true, true)
on conflict (code) do nothing;

alter table public.journal_entries drop constraint if exists journal_entries_source_check;
alter table public.journal_entries add constraint journal_entries_source_check check (source in (
    'invoice', 'payment', 'expense', 'manual', 'closing', 'void', 'purchase', 'supplier_payment', 'stock', 'cost', 'internal', 'transfer'));

-- ---------- bank accounts ----------
create table if not exists public.money_accounts (
    id bigserial primary key,
    branch_code text not null references public.branches (branch_code),
    account_code text not null unique references public.accounts (code),
    name text not null,
    bank_name text,
    account_no text,
    currency text not null,
    active boolean not null default true,
    created_at timestamptz not null default now(),
    created_by_name text
);
alter table public.money_accounts enable row level security;

-- who paid: an expense or supplier payment may be paid from another location's cash / bank (Main Office)
alter table public.expenses add column if not exists paid_from_branch text;
alter table public.expenses add column if not exists paid_from_account text;
alter table public.supplier_payments add column if not exists paid_from_branch text;
alter table public.supplier_payments add column if not exists paid_from_account text;

-- ---------- transfers ----------
create table if not exists public.cash_transfers (
    id bigserial primary key,
    transfer_no text not null unique,
    from_branch text not null references public.branches (branch_code),
    from_account text not null references public.accounts (code),
    to_branch text not null references public.branches (branch_code),
    to_account text not null references public.accounts (code),
    currency text not null,
    amount numeric(14, 3) not null check (amount > 0),
    status text not null default 'sent' check (status in ('sent', 'received', 'cancelled')),
    transfer_date date not null default current_date,
    reference text,
    notes text,
    sent_at timestamptz not null default now(),
    sent_by_name text,
    received_amount numeric(14, 3),
    received_at timestamptz,
    received_by_name text,
    receive_notes text,
    cancel_reason text
);
alter table public.cash_transfers enable row level security;
create index if not exists cash_transfers_from_idx on public.cash_transfers (from_branch, status);
create index if not exists cash_transfers_to_idx on public.cash_transfers (to_branch, status);

-- ---------- payment requests (a branch asks Main Office to pay) ----------
create table if not exists public.payment_requests (
    id bigserial primary key,
    request_no text not null unique,
    branch_code text not null references public.branches (branch_code),
    account_code text not null references public.accounts (code),
    currency text not null,
    amount numeric(14, 3) not null check (amount > 0),
    payee text,
    reason text,
    status text not null default 'requested' check (status in ('requested', 'paid', 'rejected', 'cancelled')),
    requested_at timestamptz not null default now(),
    requested_by_name text,
    decided_at timestamptz,
    decided_by_name text,
    reject_reason text,
    expense_id bigint references public.expenses (id)
);
alter table public.payment_requests enable row level security;
create index if not exists payment_requests_status_idx on public.payment_requests (status, branch_code);

-- ---------- helpers ----------
create or replace function public.main_office_code() returns text
language sql stable set search_path to 'public' as
$$ select branch_code from public.branches where branch_type = 'main_office' limit 1 $$;

-- the location's side of the Main Office running balance
create or replace function public.interoffice_account(p_branch text) returns text
language sql stable set search_path to 'public' as
$$ select case when (select branch_type from public.branches where branch_code = p_branch) = 'main_office' then '1160' else '2060' end $$;

-- cash (1000), the old general bank line (1020), or one of the location's own bank accounts
create or replace function public.is_money_account(p_branch text, p_code text) returns boolean
language sql stable set search_path to 'public' as
$$ select p_code in ('1000', '1020') or exists (select 1 from public.money_accounts where branch_code = p_branch and account_code = p_code and active) $$;

create or replace function public.branch_currency(p_branch text) returns text
language sql stable set search_path to 'public' as
$$ select coalesce((select upper(currency) from public.branches where branch_code = p_branch), 'OMR') $$;

-- add a bank account: gets the next free ledger account 1021–1049
create or replace function public.bank_account_add(p_branch text, p_name text, p_bank text, p_account_no text, p_user_name text)
returns jsonb language plpgsql set search_path to 'public' as $$
declare v_code text; v_id bigint;
begin
    if coalesce(trim(p_name), '') = '' then raise exception 'Give the account a name (e.g. Bank Muscat — current).'; end if;
    if not exists (select 1 from public.branches where branch_code = p_branch) then raise exception 'Unknown location %.', p_branch; end if;
    select c::text into v_code from generate_series(1021, 1049) c where not exists (select 1 from public.accounts where code = c::text) order by c limit 1;
    if v_code is null then raise exception 'No more bank account numbers free (1021–1049).'; end if;
    insert into public.accounts (code, name, type, is_system, active) values (v_code, 'Bank — ' || trim(p_name), 'asset', true, true);
    insert into public.money_accounts (branch_code, account_code, name, bank_name, account_no, currency, created_by_name)
    values (p_branch, v_code, trim(p_name), nullif(trim(p_bank), ''), nullif(trim(p_account_no), ''), public.branch_currency(p_branch), p_user_name)
    returning id into v_id;
    return jsonb_build_object('id', v_id, 'account_code', v_code);
end $$;

-- ---------- transfers ----------
-- Same location: one entry, done. Between Main Office and a branch: into a bank it is done at once (the bank shows it);
-- into a cash drawer it waits as cash in transit until the receiving side confirms the amount.
create or replace function public.money_transfer(p_from_branch text, p_from_account text, p_to_branch text, p_to_account text,
    p_amount numeric, p_reference text, p_notes text, p_date date, p_user_name text)
returns jsonb language plpgsql set search_path to 'public' as $$
declare v_amt numeric := round(p_amount, 3); v_cur text; v_no text; v_id bigint; v_date date := coalesce(p_date, current_date);
        v_mo text := public.main_office_code(); v_pending boolean;
begin
    if v_amt is null or v_amt <= 0 then raise exception 'Enter an amount above zero.'; end if;
    if v_date > current_date then raise exception 'The date cannot be in the future.'; end if;
    if not public.is_money_account(p_from_branch, p_from_account) then raise exception 'Choose where the money comes from.'; end if;
    if not public.is_money_account(p_to_branch, p_to_account) then raise exception 'Choose where the money goes.'; end if;
    if p_from_branch = p_to_branch and p_from_account = p_to_account then raise exception 'From and to are the same account.'; end if;
    v_cur := public.branch_currency(p_from_branch);
    if public.branch_currency(p_to_branch) <> v_cur then raise exception 'Both sides must use the same currency (%).', v_cur; end if;
    if p_from_branch <> p_to_branch and v_mo is null then raise exception 'Set up the Main Office location first (Branch Network).'; end if;
    if p_from_branch <> p_to_branch and v_mo not in (p_from_branch, p_to_branch) then raise exception 'Money moves between a branch and Main Office, not branch to branch.'; end if;

    v_pending := p_from_branch <> p_to_branch and p_to_account = '1000';
    v_no := public.next_doc_no(p_from_branch, 'TRF');
    insert into public.cash_transfers (transfer_no, from_branch, from_account, to_branch, to_account, currency, amount, status, transfer_date,
        reference, notes, sent_by_name, received_amount, received_at, received_by_name)
    values (v_no, p_from_branch, p_from_account, p_to_branch, p_to_account, v_cur, v_amt, case when v_pending then 'sent' else 'received' end, v_date,
        nullif(trim(p_reference), ''), nullif(trim(p_notes), ''), p_user_name,
        case when v_pending then null else v_amt end, case when v_pending then null else now() end, case when v_pending then null else p_user_name end)
    returning id into v_id;

    if p_from_branch = p_to_branch then
        perform public.post_journal(v_date, p_from_branch, v_cur, 'transfer', v_id, v_no, p_user_name, jsonb_build_array(
            jsonb_build_object('account', p_to_account, 'debit', v_amt), jsonb_build_object('account', p_from_account, 'credit', v_amt)));
    elsif v_pending then
        perform public.post_journal(v_date, p_from_branch, v_cur, 'transfer', v_id, v_no || ' sent to ' || p_to_branch, p_user_name, jsonb_build_array(
            jsonb_build_object('account', '1050', 'debit', v_amt), jsonb_build_object('account', p_from_account, 'credit', v_amt)));
    else
        perform public.post_journal(v_date, p_from_branch, v_cur, 'transfer', v_id, v_no || ' to ' || p_to_branch, p_user_name, jsonb_build_array(
            jsonb_build_object('account', public.interoffice_account(p_from_branch), 'debit', v_amt), jsonb_build_object('account', p_from_account, 'credit', v_amt)));
        perform public.post_journal(v_date, p_to_branch, v_cur, 'transfer', v_id, v_no || ' from ' || p_from_branch, p_user_name, jsonb_build_array(
            jsonb_build_object('account', p_to_account, 'debit', v_amt), jsonb_build_object('account', public.interoffice_account(p_to_branch), 'credit', v_amt)));
    end if;
    return jsonb_build_object('id', v_id, 'transfer_no', v_no, 'status', case when v_pending then 'sent' else 'received' end, 'amount', v_amt);
end $$;

-- the receiving side counts the cash; a difference is cash over / short at the receiving location (never an expense)
create or replace function public.transfer_receive(p_id bigint, p_received numeric, p_notes text, p_user_name text)
returns jsonb language plpgsql set search_path to 'public' as $$
declare t public.cash_transfers%rowtype; v_got numeric := round(p_received, 3); v_diff numeric; v_lines jsonb;
begin
    select * into t from public.cash_transfers where id = p_id for update;
    if not found then raise exception 'Transfer not found.'; end if;
    if t.status <> 'sent' then raise exception '% is already %.', t.transfer_no, t.status; end if;
    if v_got is null or v_got < 0 then raise exception 'Enter the amount you received.'; end if;
    v_diff := v_got - t.amount;
    perform public.post_journal(current_date, t.from_branch, t.currency, 'transfer', t.id, t.transfer_no || ' received by ' || t.to_branch, p_user_name, jsonb_build_array(
        jsonb_build_object('account', public.interoffice_account(t.from_branch), 'debit', t.amount), jsonb_build_object('account', '1050', 'credit', t.amount)));
    v_lines := jsonb_build_array(jsonb_build_object('account', public.interoffice_account(t.to_branch), 'credit', t.amount));
    if v_got > 0 then v_lines := v_lines || jsonb_build_array(jsonb_build_object('account', t.to_account, 'debit', v_got)); end if;
    if v_diff < 0 then v_lines := v_lines || jsonb_build_array(jsonb_build_object('account', '3900', 'debit', -v_diff)); end if;
    if v_diff > 0 then v_lines := v_lines || jsonb_build_array(jsonb_build_object('account', '3900', 'credit', v_diff)); end if;
    perform public.post_journal(current_date, t.to_branch, t.currency, 'transfer', t.id,
        t.transfer_no || ' from ' || t.from_branch || case when v_diff < 0 then ' (short ' || -v_diff || ')' when v_diff > 0 then ' (over ' || v_diff || ')' else '' end,
        p_user_name, v_lines);
    update public.cash_transfers set status = 'received', received_amount = v_got, received_at = now(), received_by_name = p_user_name,
        receive_notes = nullif(trim(p_notes), '') where id = t.id;
    return jsonb_build_object('id', t.id, 'transfer_no', t.transfer_no, 'difference', v_diff);
end $$;

-- the sender takes back cash that was not received yet
create or replace function public.transfer_cancel(p_id bigint, p_reason text, p_user_name text)
returns void language plpgsql set search_path to 'public' as $$
declare t public.cash_transfers%rowtype;
begin
    if coalesce(trim(p_reason), '') = '' then raise exception 'Give a reason.'; end if;
    select * into t from public.cash_transfers where id = p_id for update;
    if not found then raise exception 'Transfer not found.'; end if;
    if t.status <> 'sent' then raise exception 'Only a transfer that is still on the way can be cancelled.'; end if;
    perform public.post_journal(current_date, t.from_branch, t.currency, 'transfer', t.id, 'Cancel ' || t.transfer_no || ': ' || trim(p_reason), p_user_name, jsonb_build_array(
        jsonb_build_object('account', t.from_account, 'debit', t.amount), jsonb_build_object('account', '1050', 'credit', t.amount)));
    update public.cash_transfers set status = 'cancelled', cancel_reason = trim(p_reason) where id = t.id;
end $$;

-- ---------- an expense paid from any location's cash / bank ----------
-- The cost belongs to p_branch (its profit & loss); the money comes from p_pay_branch. When they differ, the branch
-- owes Main Office the amount. Voiding the expense reverses both sides (same source and id).
create or replace function public.expense_record_from(p_branch text, p_account text, p_amount numeric, p_pay_branch text, p_pay_account text,
    p_paid_to text, p_reference text, p_date date, p_notes text, p_user_name text)
returns jsonb language plpgsql set search_path to 'public' as $$
declare v_no text; v_id bigint; v_amt numeric := round(p_amount, 3); v_cur text := public.branch_currency(p_branch); v_date date := coalesce(p_date, current_date);
begin
    if v_amt is null or v_amt <= 0 then raise exception 'Enter an amount above zero.'; end if;
    if not exists (select 1 from public.accounts where code = p_account and type = 'expense' and active) then raise exception 'Choose an expense category.'; end if;
    if not public.is_money_account(p_pay_branch, p_pay_account) then raise exception 'Choose where the money comes from.'; end if;
    if public.branch_currency(p_pay_branch) <> v_cur then raise exception 'The money must be in the same currency as the cost (%).', v_cur; end if;
    if p_pay_branch <> p_branch and public.main_office_code() not in (p_branch, p_pay_branch) then raise exception 'Only Main Office pays for other branches.'; end if;
    v_no := public.next_doc_no(p_branch, 'EXP');
    insert into public.expenses (expense_no, branch_code, account_code, currency, amount, method, paid_to, reference, expense_date, notes, created_by_name, paid_from_branch, paid_from_account)
    values (v_no, p_branch, p_account, v_cur, v_amt, case when p_pay_account = '1000' then 'cash' else 'bank' end, nullif(trim(p_paid_to), ''), nullif(trim(p_reference), ''),
            v_date, nullif(trim(p_notes), ''), p_user_name, p_pay_branch, p_pay_account)
    returning id into v_id;
    if p_pay_branch = p_branch then
        perform public.post_journal(v_date, p_branch, v_cur, 'expense', v_id, v_no || coalesce(' · ' || nullif(trim(p_paid_to), ''), ''), p_user_name, jsonb_build_array(
            jsonb_build_object('account', p_account, 'debit', v_amt), jsonb_build_object('account', p_pay_account, 'credit', v_amt)));
    else
        perform public.post_journal(v_date, p_branch, v_cur, 'expense', v_id, v_no || ' paid by ' || p_pay_branch || coalesce(' · ' || nullif(trim(p_paid_to), ''), ''), p_user_name, jsonb_build_array(
            jsonb_build_object('account', p_account, 'debit', v_amt), jsonb_build_object('account', public.interoffice_account(p_branch), 'credit', v_amt)));
        perform public.post_journal(v_date, p_pay_branch, v_cur, 'expense', v_id, v_no || ' paid for ' || p_branch || coalesce(' · ' || nullif(trim(p_paid_to), ''), ''), p_user_name, jsonb_build_array(
            jsonb_build_object('account', public.interoffice_account(p_pay_branch), 'debit', v_amt), jsonb_build_object('account', p_pay_account, 'credit', v_amt)));
    end if;
    return jsonb_build_object('id', v_id, 'expense_no', v_no);
end $$;

-- ---------- pay a supplier / agent bill from any location's cash / bank ----------
create or replace function public.bill_pay_from(p_kind text, p_id bigint, p_amount numeric, p_pay_branch text, p_pay_account text, p_reference text, p_user_name text)
returns jsonb language plpgsql set search_path to 'public' as $$
declare v_amt numeric := round(p_amount, 3); v_branch text; v_cur text; v_owed numeric; v_doc text; v_sup bigint; v_no text; v_id bigint;
begin
    if v_amt is null or v_amt <= 0 then raise exception 'Enter an amount above zero.'; end if;
    if p_kind = 'cost' then
        select branch_code, currency, amount - paid, bill_no, supplier_id into v_branch, v_cur, v_owed, v_doc, v_sup from public.cost_bills where id = p_id and status <> 'void' for update;
    elsif p_kind = 'purchase' then
        select branch_code, currency, total - paid, purchase_no, supplier_id into v_branch, v_cur, v_owed, v_doc, v_sup from public.purchases where id = p_id and status <> 'void' for update;
    else raise exception 'Unknown bill type.'; end if;
    if v_branch is null then raise exception 'Bill not found (or void).'; end if;
    if v_amt > v_owed then raise exception 'Amount is more than what is owed (% %).', v_cur, v_owed; end if;
    if not public.is_money_account(p_pay_branch, p_pay_account) then raise exception 'Choose where the money comes from.'; end if;
    if public.branch_currency(p_pay_branch) <> upper(v_cur) then raise exception 'The money must be in the same currency as the bill (%).', v_cur; end if;
    if p_pay_branch <> v_branch and public.main_office_code() not in (v_branch, p_pay_branch) then raise exception 'Only Main Office pays for other branches.'; end if;
    v_no := public.next_doc_no(v_branch, 'SPY');
    insert into public.supplier_payments (payment_no, purchase_id, cost_bill_id, supplier_id, branch_code, currency, amount, method, reference, created_by_name, paid_from_branch, paid_from_account)
    values (v_no, case when p_kind = 'purchase' then p_id end, case when p_kind = 'cost' then p_id end, v_sup, v_branch, v_cur, v_amt,
            case when p_pay_account = '1000' then 'cash' else 'bank' end, nullif(trim(p_reference), ''), p_user_name, p_pay_branch, p_pay_account)
    returning id into v_id;
    if p_pay_branch = v_branch then
        perform public.post_journal(current_date, v_branch, v_cur, 'supplier_payment', v_id, v_no || ' for ' || v_doc, p_user_name, jsonb_build_array(
            jsonb_build_object('account', '2000', 'debit', v_amt), jsonb_build_object('account', p_pay_account, 'credit', v_amt)));
    else
        perform public.post_journal(current_date, v_branch, v_cur, 'supplier_payment', v_id, v_no || ' for ' || v_doc || ' paid by ' || p_pay_branch, p_user_name, jsonb_build_array(
            jsonb_build_object('account', '2000', 'debit', v_amt), jsonb_build_object('account', public.interoffice_account(v_branch), 'credit', v_amt)));
        perform public.post_journal(current_date, p_pay_branch, v_cur, 'supplier_payment', v_id, v_no || ' for ' || v_doc || ' (' || v_branch || ')', p_user_name, jsonb_build_array(
            jsonb_build_object('account', public.interoffice_account(p_pay_branch), 'debit', v_amt), jsonb_build_object('account', p_pay_account, 'credit', v_amt)));
    end if;
    if p_kind = 'cost' then
        update public.cost_bills set paid = paid + v_amt, status = case when paid + v_amt >= amount then 'paid' else 'partial' end where id = p_id;
    else
        update public.purchases set paid = paid + v_amt, status = case when paid + v_amt >= total then 'paid' else 'partial' end where id = p_id;
    end if;
    return jsonb_build_object('id', v_id, 'payment_no', v_no, 'amount', v_amt);
end $$;

-- ---------- payment requests ----------
create or replace function public.payment_request_create(p_branch text, p_account text, p_amount numeric, p_payee text, p_reason text, p_user_name text)
returns jsonb language plpgsql set search_path to 'public' as $$
declare v_no text; v_id bigint; v_amt numeric := round(p_amount, 3);
begin
    if v_amt is null or v_amt <= 0 then raise exception 'Enter an amount above zero.'; end if;
    if not exists (select 1 from public.accounts where code = p_account and type = 'expense' and active) then raise exception 'Choose what it is for (expense category).'; end if;
    if coalesce(trim(p_reason), '') = '' then raise exception 'Say what the payment is for.'; end if;
    v_no := public.next_doc_no(p_branch, 'PRQ');
    insert into public.payment_requests (request_no, branch_code, account_code, currency, amount, payee, reason, requested_by_name)
    values (v_no, p_branch, p_account, public.branch_currency(p_branch), v_amt, nullif(trim(p_payee), ''), trim(p_reason), p_user_name) returning id into v_id;
    return jsonb_build_object('id', v_id, 'request_no', v_no);
end $$;

-- approve = pay it (records the expense for the branch, paid from Main Office)
create or replace function public.payment_request_pay(p_id bigint, p_pay_branch text, p_pay_account text, p_reference text, p_user_name text)
returns jsonb language plpgsql set search_path to 'public' as $$
declare r public.payment_requests%rowtype; v_out jsonb;
begin
    select * into r from public.payment_requests where id = p_id for update;
    if not found then raise exception 'Request not found.'; end if;
    if r.status <> 'requested' then raise exception '% is already %.', r.request_no, r.status; end if;
    v_out := public.expense_record_from(r.branch_code, r.account_code, r.amount, p_pay_branch, p_pay_account, r.payee, coalesce(nullif(trim(p_reference), ''), r.request_no),
        current_date, r.request_no || ': ' || r.reason, p_user_name);
    update public.payment_requests set status = 'paid', decided_at = now(), decided_by_name = p_user_name, expense_id = (v_out->>'id')::bigint where id = r.id;
    return v_out || jsonb_build_object('request_no', r.request_no);
end $$;

create or replace function public.payment_request_decline(p_id bigint, p_status text, p_reason text, p_user_name text)
returns void language plpgsql set search_path to 'public' as $$
declare r public.payment_requests%rowtype;
begin
    if p_status not in ('rejected', 'cancelled') then raise exception 'Unknown decision.'; end if;
    if p_status = 'rejected' and coalesce(trim(p_reason), '') = '' then raise exception 'Give a reason.'; end if;
    select * into r from public.payment_requests where id = p_id for update;
    if not found then raise exception 'Request not found.'; end if;
    if r.status <> 'requested' then raise exception '% is already %.', r.request_no, r.status; end if;
    update public.payment_requests set status = p_status, decided_at = now(), decided_by_name = p_user_name, reject_reason = nullif(trim(p_reason), '') where id = r.id;
end $$;

-- ---------- balances ----------
-- cash and bank balances of one location (all time), one row per account
create or replace function public.money_balances(p_branch text)
returns table (account_code text, name text, kind text, bank_name text, account_no text, currency text, balance numeric)
language sql stable set search_path to 'public' as $$
    with mine as (
        select '1000'::text as account_code, 'Cash'::text as name, 'cash'::text as kind, null::text as bank_name, null::text as account_no
        union all
        select m.account_code, m.name, 'bank', m.bank_name, m.account_no from public.money_accounts m where m.branch_code = p_branch and m.active
        union all
        select '1020', 'Bank (general)', 'bank', null, null
        where exists (select 1 from public.journal_lines l join public.journal_entries e on e.id = l.entry_id where e.branch_code = p_branch and l.account_code = '1020')
    )
    select m.account_code, m.name, m.kind, m.bank_name, m.account_no, public.branch_currency(p_branch),
           coalesce((select sum(l.debit - l.credit) from public.journal_lines l join public.journal_entries e on e.id = l.entry_id
                     where e.branch_code = p_branch and l.account_code = m.account_code), 0)
    from mine m order by m.kind desc, m.account_code;
$$;

-- per branch: what it owes Main Office (positive) or Main Office owes it (negative), and its cash still in transit
create or replace function public.interoffice_balances()
returns table (branch_code text, branch_name text, currency text, owes numeric, in_transit numeric)
language sql stable set search_path to 'public' as $$
    select b.branch_code, b.branch_name, upper(b.currency),
        coalesce((select sum(l.credit - l.debit) from public.journal_lines l join public.journal_entries e on e.id = l.entry_id
                  where e.branch_code = b.branch_code and l.account_code = '2060'), 0),
        coalesce((select sum(l.debit - l.credit) from public.journal_lines l join public.journal_entries e on e.id = l.entry_id
                  where e.branch_code = b.branch_code and l.account_code = '1050'), 0)
    from public.branches b where b.branch_type <> 'main_office'
    order by b.branch_name;
$$;

-- ---------- one agent / supplier bill split across branches (stage 2) ----------
-- The bill is recorded at Main Office (Main Office owes the agent and pays it from its cash / bank). Each branch's share
-- is that branch's cost (its profit & loss), and the branch owes Main Office the share. Voiding the bill reverses
-- every side (all journals have source 'cost' and the bill's id); a bill with payments cannot be voided.
create table if not exists public.cost_bill_shares (
    cost_bill_id bigint not null references public.cost_bills (id) on delete cascade,
    branch_code text not null references public.branches (branch_code),
    amount numeric(14, 3) not null check (amount > 0),
    primary key (cost_bill_id, branch_code)
);
alter table public.cost_bill_shares enable row level security;

-- a split bill may cover several shipments / consolidations, or none in particular (e.g. one agent invoice for a week)
alter table public.cost_bills add column if not exists split boolean not null default false;
alter table public.cost_bills drop constraint if exists cost_bills_check;
alter table public.cost_bills add constraint cost_bills_check check (consolidation_id is not null or booking_id is not null or split);

-- how the shipments of a consolidation divide between branches: chargeable weight (containers: CBM), boxes inside only
create or replace function public.consolidation_branch_shares(p_id bigint)
returns table (branch_code text, basis numeric, share numeric)
language sql stable set search_path to 'public' as $$
    with c as (select kind from public.consolidations where id = p_id),
    items as (
        select b.branch_code,
               case when (select kind from c) = 'container'
                    then (select coalesce(sum(coalesce(bp.l, 0) * coalesce(bp.w, 0) * coalesce(bp.h, 0)) / 1000000.0, 0)
                          from public.booking_pieces bp where bp.booking_id = b.id and (ci.pieces is null or bp.piece_no = any(ci.pieces)))
                    else coalesce(b.chargeable_weight, b.weight, 0)
                         * case when ci.pieces is null then 1
                                else cardinality(ci.pieces)::numeric / greatest((select count(*) from public.booking_pieces bp where bp.booking_id = b.id), 1) end
               end as basis
        from public.consolidation_items ci join public.bookings b on b.id = ci.booking_id
        where ci.consolidation_id = p_id
    ),
    g as (select i.branch_code, sum(i.basis) basis, count(*) n from items i group by i.branch_code),
    t as (select sum(basis) s, sum(n) n from g)
    select g.branch_code, round(g.basis, 4), case when t.s > 0 then g.basis / t.s else g.n::numeric / t.n end
    from g cross join t where t.n > 0 order by g.branch_code;
$$;

create or replace function public.cost_bill_split(p_supplier_id bigint, p_consolidation_id bigint, p_type text, p_description text, p_bill_ref text,
    p_date date, p_shares jsonb, p_user_name text)
returns jsonb language plpgsql set search_path to 'public' as $$
declare v_mo text := public.main_office_code(); v_cur text; v_total numeric := 0; v_away numeric := 0; v_own numeric := 0; v_no text; v_id bigint;
        v_date date := coalesce(p_date, current_date); s jsonb; v_b text; v_a numeric; v_for text;
begin
    if v_mo is null then raise exception 'Set up the Main Office location first (Branch Network).'; end if;
    if p_type not in ('freight', 'customs', 'trucking', 'handling', 'other') then raise exception 'Choose the cost type.'; end if;
    if p_supplier_id is null then raise exception 'Choose the agent / supplier.'; end if;
    if jsonb_typeof(p_shares) <> 'array' or jsonb_array_length(p_shares) = 0 then raise exception 'Add at least one branch share.'; end if;
    v_cur := public.branch_currency(v_mo);
    for s in select * from jsonb_array_elements(p_shares) loop
        v_b := s->>'branch'; v_a := round((s->>'amount')::numeric, 3);
        if v_a is null or v_a <= 0 then raise exception 'Every share needs an amount above zero.'; end if;
        if not exists (select 1 from public.branches where branch_code = v_b) then raise exception 'Unknown branch %.', v_b; end if;
        if public.branch_currency(v_b) <> v_cur then raise exception '% works in another currency — split only between % branches.', v_b, v_cur; end if;
        if (select count(*) from jsonb_array_elements(p_shares) x where x->>'branch' = v_b) > 1 then raise exception '% is listed twice.', v_b; end if;
        v_total := v_total + v_a;
        if v_b = v_mo then v_own := v_own + v_a; else v_away := v_away + v_a; end if;
    end loop;
    v_for := (select kind || ' ' || mawb from public.consolidations where id = p_consolidation_id);
    v_no := public.next_doc_no(v_mo, 'CST');
    insert into public.cost_bills (bill_no, branch_code, supplier_id, consolidation_id, booking_id, cost_type, description, currency, amount, paid, status, bill_ref, bill_date, created_by_name, split)
    values (v_no, v_mo, p_supplier_id, p_consolidation_id, null, p_type, nullif(trim(p_description), ''), v_cur, v_total, 0, 'unpaid',
            nullif(trim(p_bill_ref), ''), v_date, p_user_name, true)
    returning id into v_id;
    insert into public.cost_bill_shares (cost_bill_id, branch_code, amount)
    select v_id, x->>'branch', round((x->>'amount')::numeric, 3) from jsonb_array_elements(p_shares) x;
    -- Main Office: owes the agent the whole bill; the branches owe it their shares (and its own share is its cost)
    perform public.post_journal(v_date, v_mo, v_cur, 'cost', v_id, v_no || ' · ' || p_type || ' · split' || coalesce(' · ' || v_for, ''), p_user_name,
        jsonb_build_array(
            jsonb_build_object('account', '1160', 'debit', v_away),
            jsonb_build_object('account', public.cost_account(p_type), 'debit', v_own),
            jsonb_build_object('account', '2000', 'credit', v_total)));
    -- each branch: its share is its cost, owed to Main Office
    for s in select * from jsonb_array_elements(p_shares) loop
        if s->>'branch' <> v_mo then
            perform public.post_journal(v_date, s->>'branch', v_cur, 'cost', v_id, v_no || ' · ' || p_type || ' · share' || coalesce(' · ' || v_for, ''), p_user_name,
                jsonb_build_array(
                    jsonb_build_object('account', public.cost_account(p_type), 'debit', round((s->>'amount')::numeric, 3)),
                    jsonb_build_object('account', '2060', 'credit', round((s->>'amount')::numeric, 3))));
        end if;
    end loop;
    return jsonb_build_object('id', v_id, 'bill_no', v_no, 'total', v_total);
end $$;
