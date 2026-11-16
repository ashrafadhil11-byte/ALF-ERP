// File: api/_routes/accounts.js — Phase C accounts.
// Roles:  staff            → price quote only (booking form)
//         branch_manager   → their branch: overview, invoices, receipts, expenses, cash closing, balances, rate cards, branch P&L
//         super_admin / head_office → all branches + chart of accounts, journal, trial balance, P&L, balance sheet
// Reports are per currency (no conversion).
//
// GET  ?view=quote&branch&dest&cargo&kg&pieces&boxes
// GET  ?view=overview|invoices|invoice&id|payments|expenses|balances|cash&date|rates|ledger&from&to|journal   [&branch]
// POST { action: invoice | payment | invoice_void | payment_void | expense | expense_void | cash_close
//                | rate_save | rate_delete | account_save | journal, ... }
import { requireSession, serviceHeaders, ADMIN_ROLES } from '../_lib/auth.js';
import { pickCard, priceFor, PAY_MAP } from '../_lib/accounts.js';

const enc = encodeURIComponent;
const FULL = ADMIN_ROLES;                         // super_admin, head_office
const OPS = [...FULL, 'branch_manager'];
const METHODS = ['per_kg', 'vol_band', 'per_package', 'per_box'];
class UserError extends Error { constructor(m, s = 400) { super(m); this.status = s; } }

const today = () => new Date().toISOString().slice(0, 10);
const monthStart = () => today().slice(0, 8) + '01';
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

export default async function handler(req, res) {
    const session = await requireSession(req, res);
    if (!session) return;
    const rest = `${process.env.SUPABASE_URL}/rest/v1`;
    const role = session.role;
    const full = FULL.includes(role);
    const userName = session.employee?.full_name || session.user.email;
    const get = async (path) => { const r = await fetch(`${rest}/${path}`, { headers: serviceHeaders() }); return r.ok ? r.json() : []; };
    const rpc = async (fn, body) => {
        const r = await fetch(`${rest}/rpc/${fn}`, { method: 'POST', headers: serviceHeaders(), body: JSON.stringify(body) });
        const out = await r.json().catch(() => ({}));
        if (!r.ok) throw new UserError(out.message || `${fn} failed.`);
        return out;
    };
    const need = (roles) => { if (!roles.includes(role)) throw new UserError('You do not have access to accounts.', 403); };
    // Admins may look at one branch or all (null); everyone else is fixed to their own branch.
    const scope = (asked) => {
        if (full) return asked ? String(asked).toUpperCase() : null;
        if (!session.branch) throw new UserError('Your account has no branch assigned.', 403);
        return session.branch;
    };
    // A branch is required for writing (admins pick one).
    const writeBranch = (asked) => {
        const b = scope(asked);
        if (!b) throw new UserError('Choose the branch.');
        return b;
    };
    const branchRow = async (code) => {
        const b = (await get(`branches?branch_code=eq.${enc(code)}&select=branch_code,branch_name,currency,tax_rate`))[0];
        if (!b) throw new UserError(`Branch ${code} not found.`);
        return b;
    };
    const own = (doc) => {
        if (!doc) throw new UserError('Not found.', 404);
        if (!full && doc.branch_code !== session.branch) throw new UserError('This belongs to another branch.', 403);
        return doc;
    };
    const bf = (b) => (b ? `&branch_code=eq.${enc(b)}` : '');

    try {
        const q = req.query || {};
        if (req.method === 'GET') {
            const view = q.view || 'overview';

            if (view === 'quote') {
                const branch = String((full ? q.branch : session.branch) || '').toUpperCase();
                if (!branch) throw new UserError('Choose the branch.');
                const cards = await get(`rate_cards?branch_code=eq.${enc(branch)}&active=is.true&select=*`);
                const card = pickCard(cards, { dest: q.dest, cargo: q.cargo });
                if (!card) return res.status(200).json({ quote: null, message: 'No rate card for this route — enter the charge by hand.' });
                return res.status(200).json({ quote: priceFor(card, { kg: num(q.kg), pieces: num(q.pieces) || 1, boxes: num(q.boxes) || 1 }), card_id: card.id });
            }

            need(OPS);
            const branch = scope(q.branch);
            const from = q.from || monthStart(), to = q.to || today();

            if (view === 'overview') {
                const [inv, pay, exp, open, ledger, branches] = await Promise.all([
                    get(`invoices?status=neq.void&issued_at=gte.${from}${bf(branch)}&select=currency,total`),
                    get(`payments?void=is.false&received_at=gte.${from}${bf(branch)}&select=currency,amount,method`),
                    get(`expenses?void=is.false&expense_date=gte.${from}${bf(branch)}&select=currency,amount`),
                    get(`invoices?status=in.(unpaid,partial)${bf(branch)}&select=currency,balance,due_date`),
                    rpc('ledger_summary', { p_branch: branch, p_from: from, p_to: to }),
                    get('branches?select=branch_code,branch_name,currency,status&order=branch_name.asc')
                ]);
                const cur = {};
                const at = (c) => (cur[c] ||= { currency: c, invoiced: 0, collected: 0, cash: 0, card: 0, bank: 0, expenses: 0, receivable: 0, overdue: 0, income: 0, cost: 0 });
                inv.forEach(x => { at(x.currency).invoiced += +x.total; });
                pay.forEach(x => { const c = at(x.currency); c.collected += +x.amount; c[x.method] += +x.amount; });
                exp.forEach(x => { at(x.currency).expenses += +x.amount; });
                open.forEach(x => { const c = at(x.currency); c.receivable += +x.balance; if (x.due_date && x.due_date < today()) c.overdue += +x.balance; });
                ledger.forEach(l => { const c = at(l.currency); if (l.type === 'income') c.income += l.credit - l.debit; if (l.type === 'expense') c.cost += l.debit - l.credit; });
                const round = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'number' ? Math.round(v * 1000) / 1000 : v]));
                return res.status(200).json({
                    branch, from, to, full, role,
                    currencies: Object.values(cur).map(c => round({ ...c, profit: c.income - c.cost })),
                    branches: branches.filter(b => b.status !== 'Dismissed'),
                    my_branch: session.branch || null
                });
            }
            if (view === 'invoices') {
                const st = ['unpaid', 'partial', 'paid', 'void'].includes(q.status) ? `&status=eq.${q.status}` : q.status === 'open' ? '&status=in.(unpaid,partial)' : '';
                const s = String(q.q || '').replace(/[^\w\s+-]/g, '').trim();
                const search = s ? `&or=(invoice_no.ilike.*${enc(s)}*,awb.ilike.*${enc(s)}*,customer_name.ilike.*${enc(s)}*,customer_phone.ilike.*${enc(s)}*)` : '';
                return res.status(200).json({ invoices: await get(`invoices?issued_at=gte.${from}&issued_at=lt.${enc(nextDay(to))}${bf(branch)}${st}${search}&select=id,invoice_no,branch_code,awb,customer_name,customer_phone,currency,total,paid,balance,status,terms,issued_at,due_date&order=issued_at.desc&limit=300`) });
            }
            if (view === 'invoice') {
                const inv = own((await get(`invoices?id=eq.${enc(q.id)}&select=*`))[0]);
                const [payments, br] = await Promise.all([get(`payments?invoice_id=eq.${inv.id}&select=*&order=received_at.asc`), get(`branches?branch_code=eq.${enc(inv.branch_code)}&select=branch_name,address,phone_number`)]);
                return res.status(200).json({ invoice: inv, payments, branch: br[0] || null });
            }
            if (view === 'payments') {
                return res.status(200).json({ payments: await get(`payments?received_at=gte.${from}&received_at=lt.${enc(nextDay(to))}${bf(branch)}&select=*,invoices(invoice_no,awb)&order=received_at.desc&limit=300`) });
            }
            if (view === 'expenses') {
                const [expenses, accounts] = await Promise.all([
                    get(`expenses?expense_date=gte.${from}&expense_date=lte.${to}${bf(branch)}&select=*,accounts(name)&order=expense_date.desc,id.desc&limit=300`),
                    get('accounts?type=eq.expense&active=is.true&select=code,name&order=code')
                ]);
                return res.status(200).json({ expenses, categories: accounts });
            }
            if (view === 'balances') {
                const open = await get(`invoices?status=in.(unpaid,partial)${bf(branch)}&select=id,invoice_no,awb,customer_name,customer_phone,currency,balance,issued_at,due_date,branch_code&order=issued_at.asc&limit=1000`);
                const map = {};
                open.forEach(i => {
                    const key = `${i.customer_phone || i.customer_name || 'Unknown'}|${i.currency}`;
                    const c = (map[key] ||= { customer_name: i.customer_name, customer_phone: i.customer_phone, currency: i.currency, balance: 0, overdue: 0, invoices: [] });
                    c.balance += +i.balance;
                    if (i.due_date && i.due_date < today()) c.overdue += +i.balance;
                    c.invoices.push(i);
                });
                return res.status(200).json({ customers: Object.values(map).sort((a, b) => b.balance - a.balance) });
            }
            if (view === 'cash') {
                const b = writeBranch(q.branch);
                const date = q.date || today();
                const br = await branchRow(b);
                const used = await get(`journal_entries?branch_code=eq.${enc(b)}&select=currency&limit=1000`);
                const currencies = [...new Set([br.currency || 'OMR', ...used.map(u => u.currency)])];
                const days = await Promise.all(currencies.map(async c => ({ currency: c, ...(await rpc('cash_day', { p_branch: b, p_currency: c, p_date: date })) })));
                const closings = await get(`cash_closings?branch_code=eq.${enc(b)}&select=*&order=close_date.desc,currency&limit=60`);
                return res.status(200).json({ branch: b, date, days, closings });
            }
            if (view === 'rates') {
                const [cards, dests, cargo] = await Promise.all([
                    get(`rate_cards?select=*${bf(branch)}&order=branch_code,dest_country_code,cargo_type_code`),
                    get('destination_codes?select=country_code,country_name&order=country_name'),
                    get('cargo_types?active=is.true&select=code,name&order=code')
                ]);
                return res.status(200).json({ cards, destinations: dests, cargo_types: cargo });
            }

            need(FULL);
            if (view === 'ledger') {
                const [period, allTime, accounts] = await Promise.all([
                    rpc('ledger_summary', { p_branch: branch, p_from: from, p_to: to }),
                    rpc('ledger_summary', { p_branch: branch, p_from: null, p_to: to }),
                    get('accounts?select=*&order=code')
                ]);
                return res.status(200).json({ from, to, branch, period, to_date: allTime, accounts });
            }
            if (view === 'journal') {
                const acct = q.account ? `&journal_lines.account_code=eq.${enc(q.account)}` : '';
                const entries = await get(`journal_entries?entry_date=gte.${from}&entry_date=lte.${to}${bf(branch)}&select=*,journal_lines${acct ? '!inner' : ''}(account_code,debit,credit,note)${acct}&order=entry_date.desc,id.desc&limit=300`);
                return res.status(200).json({ entries, accounts: await get('accounts?select=code,name,type,active&order=code') });
            }
            throw new UserError('Unknown view.');
        }

        if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
        const b = req.body || {};
        need(OPS);

        switch (b.action) {
            case 'invoice': {
                const br = await branchRow(writeBranch(b.branch));
                const lines = (Array.isArray(b.lines) ? b.lines : []).map(l => ({ description: String(l.description || '').slice(0, 200), qty: num(l.qty) || 1, rate: num(l.rate) || 0 })).filter(l => l.rate > 0);
                if (!lines.length) throw new UserError('Add at least one line with an amount.');
                const out = await rpc('invoice_create', {
                    p_branch: br.branch_code, p_booking_id: null, p_awb: b.awb || null, p_customer_name: b.customer_name || null, p_customer_phone: b.customer_phone || null,
                    p_currency: br.currency || 'OMR', p_lines: lines, p_tax_rate: +br.tax_rate || 0,
                    p_pay_method: PAY_MAP[b.pay_method] || 'credit', p_due_days: num(b.due_days) || 30, p_notes: b.notes || null, p_user_name: userName
                });
                return res.status(200).json({ success: true, ...out });
            }
            case 'payment': {
                const inv = own((await get(`invoices?id=eq.${enc(b.invoice_id)}&select=id,branch_code`))[0]);
                const out = await rpc('payment_record', { p_invoice_id: inv.id, p_amount: num(b.amount), p_method: PAY_MAP[b.method] || b.method, p_reference: b.reference || null, p_user_name: userName });
                return res.status(200).json({ success: true, ...out });
            }
            case 'invoice_void':
            case 'payment_void':
            case 'expense_void': {
                const table = { invoice_void: 'invoices', payment_void: 'payments', expense_void: 'expenses' }[b.action];
                own((await get(`${table}?id=eq.${enc(b.id)}&select=id,branch_code`))[0]);
                await rpc(b.action, { p_id: +b.id, p_reason: b.reason || '', p_user_name: userName });
                return res.status(200).json({ success: true });
            }
            case 'expense': {
                const br = await branchRow(writeBranch(b.branch));
                const out = await rpc('expense_record', {
                    p_branch: br.branch_code, p_account: b.account_code, p_currency: br.currency || 'OMR', p_amount: num(b.amount),
                    p_method: PAY_MAP[b.method] || b.method, p_paid_to: b.paid_to || null, p_reference: b.reference || null,
                    p_date: b.date || null, p_notes: b.notes || null, p_user_name: userName
                });
                return res.status(200).json({ success: true, ...out });
            }
            case 'cash_close': {
                const out = await rpc('cash_close', { p_branch: writeBranch(b.branch), p_currency: b.currency, p_date: b.date || today(), p_counted: num(b.counted), p_notes: b.notes || null, p_user_name: userName });
                return res.status(200).json({ success: true, ...out });
            }
            case 'rate_save': {
                const branch = writeBranch(b.branch_code);
                const br = await branchRow(branch);
                if (!METHODS.includes(b.method)) throw new UserError('Choose a pricing method.');
                const bands = b.method === 'vol_band'
                    ? (Array.isArray(b.bands) ? b.bands : []).map(x => ({ upto: num(x.upto), price: num(x.price) })).filter(x => x.upto > 0 && x.price >= 0).sort((x, y) => x.upto - y.upto)
                    : [];
                if (b.method === 'vol_band' && !bands.length) throw new UserError('Add at least one weight band.');
                if (b.method !== 'vol_band' && !(num(b.rate) > 0)) throw new UserError('Enter the rate.');
                const dest = b.dest_country_code ? String(b.dest_country_code).toUpperCase() : '*';
                if (dest !== '*' && !/^[A-Z]{2}$/.test(dest)) throw new UserError('Destination must be a 2-letter country code or "any".');
                const row = {
                    branch_code: branch, dest_country_code: dest, cargo_type_code: b.cargo_type_code || '*', method: b.method,
                    currency: br.currency || 'OMR', rate: num(b.rate) || 0, min_charge: num(b.min_charge) || 0, bands,
                    extra_per_kg: num(b.extra_per_kg) || 0, note: b.note || null, active: b.active !== false,
                    updated_at: new Date().toISOString(), updated_by_name: userName
                };
                if (b.id) own((await get(`rate_cards?id=eq.${enc(b.id)}&select=id,branch_code`))[0]);
                const r = await fetch(`${rest}/rate_cards${b.id ? `?id=eq.${enc(b.id)}` : ''}`, {
                    method: b.id ? 'PATCH' : 'POST', headers: { ...serviceHeaders(), Prefer: 'return=representation' }, body: JSON.stringify(row)
                });
                const out = await r.json().catch(() => ({}));
                if (!r.ok) throw new UserError(/duplicate|unique/i.test(out.message || '') ? 'A rate card for this branch, destination and cargo already exists — edit that one.' : out.message || 'Could not save.');
                return res.status(200).json({ success: true, card: out[0] });
            }
            case 'rate_delete': {
                own((await get(`rate_cards?id=eq.${enc(b.id)}&select=id,branch_code`))[0]);
                await fetch(`${rest}/rate_cards?id=eq.${enc(b.id)}`, { method: 'DELETE', headers: serviceHeaders() });
                return res.status(200).json({ success: true });
            }
            case 'account_save': {
                need(FULL);
                const code = String(b.code || '').trim();
                if (!/^\d{4}$/.test(code)) throw new UserError('Account code must be 4 digits.');
                if (!['asset', 'liability', 'equity', 'income', 'expense'].includes(b.type)) throw new UserError('Choose the account type.');
                if (!String(b.name || '').trim()) throw new UserError('Enter the account name.');
                const r = await fetch(`${rest}/accounts?on_conflict=code`, {
                    method: 'POST', headers: { ...serviceHeaders(), Prefer: 'resolution=merge-duplicates' },
                    body: JSON.stringify({ code, name: String(b.name).trim().slice(0, 80), type: b.type, active: b.active !== false })
                });
                if (!r.ok) { const out = await r.json().catch(() => ({})); throw new UserError(/system_active/.test(out.message || '') ? 'System accounts cannot be switched off.' : out.message || 'Could not save.'); }
                return res.status(200).json({ success: true });
            }
            case 'journal': {
                need(FULL);
                const br = await branchRow(writeBranch(b.branch));
                const id = await rpc('post_journal', {
                    p_date: b.date || today(), p_branch: br.branch_code, p_currency: b.currency || br.currency || 'OMR', p_source: 'manual', p_source_id: null,
                    p_memo: String(b.memo || '').slice(0, 200) || 'Manual journal', p_user_name: userName,
                    p_lines: (Array.isArray(b.lines) ? b.lines : []).map(l => ({ account: String(l.account || ''), debit: num(l.debit) || 0, credit: num(l.credit) || 0, note: l.note || null }))
                });
                return res.status(200).json({ success: true, id });
            }
            default: throw new UserError('Unknown action.');
        }
    } catch (e) {
        if (e instanceof UserError) return res.status(e.status).json({ error: e.message });
        return res.status(500).json({ error: 'Accounts request failed.', details: e.message });
    }
}

function nextDay(d) { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10); }
