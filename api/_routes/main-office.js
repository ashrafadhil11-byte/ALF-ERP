// File: api/_routes/main-office.js — Main Office cash & bank (cashiers and super admins, after unlocking with their PIN).
// Branches never use this route: they send cash and ask for payments through /api/accounts.
//
//   GET  ?view=status                          access, has PIN, locked, unlocked, the Main Office location
//   POST { action:'set_pin', pin, current_pin? } | { action:'unlock', pin }   → { token, expires_at }  (one personal PIN, also the warehouse PIN)
//   — with header x-office-token —
//   GET  ?view=overview | approvals | bills | expenses | transfers | accounts | statement&branch&account | cash&date
//   POST { action:'receive', id, received, notes }                 confirm cash a branch sent (difference = cash over / short)
//        { action:'pay_request', id, pay_account, reference }      approve and pay a branch's payment request
//        { action:'reject_request', id, reason }
//        { action:'expense', branch, account_code, amount, pay_account, paid_to, reference, date, notes }   (branch = who the cost belongs to)
//        { action:'pay_bill', kind: cost|purchase, id, amount, pay_account, reference }
//        { action:'transfer', from_account, to_branch, to_account, amount, reference, notes, date }
//        { action:'transfer_cancel', id, reason }                   a float sent to a branch, not received yet
//        { action:'bill_split', supplier_id, cost_type, bill_ref, date, description, consolidation_id?, shares:[{branch, amount}] }
//              one agent / supplier bill recorded at Main Office and shared out to branches (each share = that branch's cost)
//   GET  ?view=split_options | split_preview&consolidation&amount   (shares by the shipments' chargeable weight / CBM)
//        { action:'expense_void', id, reason }                       an expense Main Office paid
//        { action:'bank_add', branch, name, bank, account_no }
//        { action:'cash_close', counted, notes, date }
import { requireSession, serviceHeaders } from '../_lib/auth.js';
import { canMainOffice, mainOfficeOf, pinAction } from '../_lib/pin.js';

const enc = encodeURIComponent;
class UserError extends Error { constructor(m, s = 400) { super(m); this.status = s; } }
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const str = (v, n = 200) => String(v ?? '').trim().slice(0, n) || null;
const today = () => new Date().toISOString().slice(0, 10);

export default async function handler(req, res) {
    const session = await requireSession(req, res);
    if (!session) return;
    const rest = `${process.env.SUPABASE_URL}/rest/v1`;
    const e = session.employee || {};
    const userName = e.full_name || session.user.email;
    const get = async (path) => { const r = await fetch(`${rest}/${path}`, { headers: serviceHeaders() }); return r.ok ? r.json() : []; };
    const rpc = async (fn, body) => {
        const r = await fetch(`${rest}/rpc/${fn}`, { method: 'POST', headers: serviceHeaders(), body: JSON.stringify(body) });
        const out = await r.json().catch(() => ({}));
        if (!r.ok) throw new UserError(out.message || `${fn} failed.`);
        return out;
    };
    const patchEmp = (id, body) => fetch(`${rest}/employees?id=eq.${enc(id)}`, { method: 'PATCH', headers: serviceHeaders(), body: JSON.stringify(body) });

    try {
        const q = req.query || {};
        const b = req.body || {};
        const mo = (await get('branches?branch_type=eq.main_office&select=branch_code,branch_name,currency'))[0] || null;

        // ---------- access / PIN ----------
        if (req.method === 'GET' && (!q.view || q.view === 'status')) {
            return res.status(200).json({
                access: canMainOffice(session), main_office: mo,
                has_pin: Boolean(e.wh_pin_hash), locked_until: e.wh_pin_locked_until && new Date(e.wh_pin_locked_until) > new Date() ? e.wh_pin_locked_until : null,
                unlocked: Boolean(mo && mainOfficeOf(session, req) === mo.branch_code)
            });
        }
        if (!canMainOffice(session)) throw new UserError('Only Main Office cashiers can open Main Office. Ask an admin to give you access.', 403);
        if (!mo) throw new UserError('There is no Main Office yet — add one in Branch Network (type: Main Office).', 409);
        if (req.method === 'POST' && (b.action === 'set_pin' || b.action === 'unlock')) {
            try { return res.status(200).json({ success: true, ...(await pinAction(b, { ...e, id: e.id || session.user.id }, patchEmp, `MO:${mo.branch_code}`)) }); }
            catch (err) { throw new UserError(err.message, err.status || 400); }
        }

        // ---------- unlocked only ----------
        if (mainOfficeOf(session, req) !== mo.branch_code) throw new UserError('Main Office is locked — enter your PIN.', 423);
        const M = mo.branch_code;
        const names = async () => Object.fromEntries((await get('branches?select=branch_code,branch_name')).map(x => [x.branch_code, x.branch_name]));

        if (req.method === 'GET') {
            if (q.view === 'overview') {
                const [money, offices, day, incoming, requests, moves] = await Promise.all([
                    rpc('money_balances', { p_branch: M }),
                    rpc('interoffice_balances', {}),
                    rpc('cash_day', { p_branch: M, p_currency: mo.currency || 'OMR', p_date: today() }),
                    get(`cash_transfers?to_branch=eq.${enc(M)}&status=eq.sent&select=id`),
                    get('payment_requests?status=eq.requested&select=id'),
                    get(`journal_lines?select=account_code,debit,credit,note,journal_entries!inner(id,entry_date,memo,source,created_by_name,branch_code)&journal_entries.branch_code=eq.${enc(M)}&account_code=in.(1000,1020,${(await get(`money_accounts?branch_code=eq.${enc(M)}&select=account_code`)).map(a => a.account_code).join(',') || '0'})&order=entry_id.desc&limit=40`)
                ]);
                return res.status(200).json({ main_office: mo, money, offices, today: day, pending: { transfers: incoming.length, requests: requests.length }, moves });
            }
            if (q.view === 'approvals') {
                const [transfers, requests, br, accts] = await Promise.all([
                    get(`cash_transfers?to_branch=eq.${enc(M)}&status=eq.sent&select=*&order=sent_at.asc`),
                    get('payment_requests?status=eq.requested&select=*&order=requested_at.asc'),
                    names(),
                    get('accounts?type=eq.expense&select=code,name')
                ]);
                const an = Object.fromEntries(accts.map(a => [a.code, a.name]));
                return res.status(200).json({
                    transfers: transfers.map(t => ({ ...t, from_name: br[t.from_branch] || t.from_branch })),
                    requests: requests.map(r => ({ ...r, branch_name: br[r.branch_code] || r.branch_code, account_name: an[r.account_code] || r.account_code })),
                    money: await rpc('money_balances', { p_branch: M })
                });
            }
            if (q.view === 'bills') {
                const [cost, purchases, br] = await Promise.all([
                    get('cost_bills?status=in.(unpaid,partial)&select=id,bill_no,bill_date,branch_code,currency,amount,paid,cost_type,description,bill_ref,split,suppliers(name),consolidations(mawb,kind),bookings(awb),cost_bill_shares(branch_code,amount)&order=bill_date.asc&limit=300'),
                    get('purchases?status=in.(unpaid,partial)&select=id,purchase_no,purchase_date,branch_code,currency,total,paid,bill_ref,suppliers(name)&order=purchase_date.asc&limit=300'),
                    names()
                ]);
                return res.status(200).json({
                    bills: [
                        ...cost.map(c => ({ kind: 'cost', id: c.id, no: c.bill_no, date: c.bill_date, branch_code: c.branch_code, branch_name: br[c.branch_code], currency: c.currency, total: +c.amount, owed: +c.amount - +c.paid, party: c.suppliers?.name || null, ref: c.bill_ref, about: [c.cost_type, c.consolidations ? `${c.consolidations.kind} ${c.consolidations.mawb}` : c.bookings?.awb, c.description, c.split ? `split: ${(c.cost_bill_shares || []).map(s => `${s.branch_code} ${s.amount}`).join(', ')}` : null].filter(Boolean).join(' · ') })),
                        ...purchases.map(p => ({ kind: 'purchase', id: p.id, no: p.purchase_no, date: p.purchase_date, branch_code: p.branch_code, branch_name: br[p.branch_code], currency: p.currency, total: +p.total, owed: +p.total - +p.paid, party: p.suppliers?.name || null, ref: p.bill_ref, about: 'purchase' }))
                    ].sort((x, y) => String(x.date).localeCompare(String(y.date))),
                    money: await rpc('money_balances', { p_branch: M })
                });
            }
            if (q.view === 'expenses') {
                const [expenses, br, categories, branches] = await Promise.all([
                    get(`expenses?paid_from_branch=eq.${enc(M)}&select=*,accounts(name)&order=expense_date.desc,id.desc&limit=150`),
                    names(),
                    get('accounts?type=eq.expense&active=is.true&select=code,name&order=code'),
                    get(`branches?currency=eq.${enc(mo.currency || 'OMR')}&select=branch_code,branch_name,branch_type&order=branch_name`)
                ]);
                return res.status(200).json({ expenses: expenses.map(x => ({ ...x, branch_name: br[x.branch_code] || x.branch_code })), categories, branches, money: await rpc('money_balances', { p_branch: M }) });
            }
            if (q.view === 'transfers') {
                const [transfers, br, branches, banks] = await Promise.all([
                    get(`cash_transfers?or=(from_branch.eq.${enc(M)},to_branch.eq.${enc(M)})&select=*&order=sent_at.desc&limit=150`),
                    names(),
                    get(`branches?currency=eq.${enc(mo.currency || 'OMR')}&branch_type=neq.main_office&select=branch_code,branch_name&order=branch_name`),
                    get('money_accounts?active=is.true&select=branch_code,account_code,name')
                ]);
                return res.status(200).json({ transfers: transfers.map(t => ({ ...t, from_name: br[t.from_branch] || t.from_branch, to_name: br[t.to_branch] || t.to_branch })), branches, banks, money: await rpc('money_balances', { p_branch: M }) });
            }
            if (q.view === 'accounts') {
                const [accts, br] = await Promise.all([get('money_accounts?select=*&order=branch_code,account_code'), names()]);
                const balances = {};
                for (const code of [...new Set([M, ...accts.map(a => a.branch_code)])]) for (const m of await rpc('money_balances', { p_branch: code })) balances[`${code}|${m.account_code}`] = +m.balance;
                return res.status(200).json({
                    main_office: mo,
                    accounts: [
                        { branch_code: M, account_code: '1000', name: 'Main Office Cash', kind: 'cash', currency: mo.currency, active: true },
                        ...accts.map(a => ({ ...a, kind: 'bank' }))
                    ].map(a => ({ ...a, branch_name: br[a.branch_code] || a.branch_code, balance: balances[`${a.branch_code}|${a.account_code}`] ?? 0 })),
                    branches: (await get('branches?select=branch_code,branch_name,branch_type&order=branch_name'))
                });
            }
            if (q.view === 'statement') {
                const branch = String(q.branch || M), account = String(q.account || '1000');
                if (branch !== M && !(await get(`money_accounts?branch_code=eq.${enc(branch)}&account_code=eq.${enc(account)}&select=id`)).length) throw new UserError('Not a bank account of that location.');
                const lines = await get(`journal_lines?select=debit,credit,note,journal_entries!inner(id,entry_date,memo,source,created_by_name,branch_code)&journal_entries.branch_code=eq.${enc(branch)}&account_code=eq.${enc(account)}&order=entry_id.asc&limit=1000`);
                return res.status(200).json({ branch, account, lines });
            }
            if (q.view === 'split_options') {
                const [suppliers, consolidations, branches] = await Promise.all([
                    get('suppliers?active=is.true&select=id,name,kind&order=name'),
                    get('consolidations?select=id,kind,mawb,closed,dest_country,created_at&order=created_at.desc&limit=100'),
                    get(`branches?currency=eq.${enc(mo.currency || 'OMR')}&status=neq.Dismissed&select=branch_code,branch_name,branch_type&order=branch_name`)
                ]);
                return res.status(200).json({ suppliers, consolidations, branches });
            }
            if (q.view === 'split_preview') {
                const shares = await rpc('consolidation_branch_shares', { p_id: +q.consolidation });
                const amount = num(q.amount) || 0;
                // round each share to 3 decimals; the last branch takes the rounding so the shares add up to the bill
                let left = Math.round(amount * 1000);
                const rows = shares.map((s, i) => {
                    const a = i === shares.length - 1 ? left : Math.round(amount * 1000 * +s.share);
                    left -= a;
                    return { branch: s.branch_code, basis: +s.basis, share: +s.share, amount: a / 1000 };
                });
                return res.status(200).json({ shares: rows });
            }
            if (q.view === 'cash') {
                const date = /^\d{4}-\d{2}-\d{2}$/.test(String(q.date || '')) ? q.date : today();
                const [day, closings] = await Promise.all([
                    rpc('cash_day', { p_branch: M, p_currency: mo.currency || 'OMR', p_date: date }),
                    get(`cash_closings?branch_code=eq.${enc(M)}&select=*&order=close_date.desc&limit=60`)
                ]);
                return res.status(200).json({ date, currency: mo.currency || 'OMR', day, closings });
            }
            throw new UserError('Unknown view.');
        }

        if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
        switch (b.action) {
            case 'receive': {
                const t = (await get(`cash_transfers?id=eq.${enc(b.id)}&select=to_branch`))[0];
                if (!t || t.to_branch !== M) throw new UserError('Transfer not found.', 404);
                return res.status(200).json({ success: true, ...(await rpc('transfer_receive', { p_id: +b.id, p_received: num(b.received), p_notes: str(b.notes), p_user_name: userName })) });
            }
            case 'pay_request':
                return res.status(200).json({ success: true, ...(await rpc('payment_request_pay', { p_id: +b.id, p_pay_branch: M, p_pay_account: String(b.pay_account || ''), p_reference: str(b.reference), p_user_name: userName })) });
            case 'reject_request':
                await rpc('payment_request_decline', { p_id: +b.id, p_status: 'rejected', p_reason: str(b.reason), p_user_name: userName });
                return res.status(200).json({ success: true });
            case 'expense':
                return res.status(200).json({ success: true, ...(await rpc('expense_record_from', {
                    p_branch: String(b.branch || M), p_account: String(b.account_code || ''), p_amount: num(b.amount), p_pay_branch: M, p_pay_account: String(b.pay_account || ''),
                    p_paid_to: str(b.paid_to), p_reference: str(b.reference), p_date: b.date || null, p_notes: str(b.notes), p_user_name: userName
                })) });
            case 'pay_bill':
                return res.status(200).json({ success: true, ...(await rpc('bill_pay_from', { p_kind: b.kind === 'purchase' ? 'purchase' : 'cost', p_id: +b.id, p_amount: num(b.amount), p_pay_branch: M, p_pay_account: String(b.pay_account || ''), p_reference: str(b.reference), p_user_name: userName })) });
            case 'transfer':
                return res.status(200).json({ success: true, ...(await rpc('money_transfer', {
                    p_from_branch: M, p_from_account: String(b.from_account || ''), p_to_branch: String(b.to_branch || M), p_to_account: String(b.to_account || ''),
                    p_amount: num(b.amount), p_reference: str(b.reference), p_notes: str(b.notes), p_date: b.date || null, p_user_name: userName
                })) });
            case 'transfer_cancel': {
                const t = (await get(`cash_transfers?id=eq.${enc(b.id)}&select=from_branch`))[0];
                if (!t || t.from_branch !== M) throw new UserError('Transfer not found.', 404);
                await rpc('transfer_cancel', { p_id: +b.id, p_reason: str(b.reason), p_user_name: userName });
                return res.status(200).json({ success: true });
            }
            case 'bill_split': {
                const shares = (Array.isArray(b.shares) ? b.shares : []).slice(0, 50).map(s => ({ branch: String(s.branch || ''), amount: num(s.amount) }));
                return res.status(200).json({ success: true, ...(await rpc('cost_bill_split', {
                    p_supplier_id: b.supplier_id ? +b.supplier_id : null, p_consolidation_id: b.consolidation_id ? +b.consolidation_id : null, p_type: String(b.cost_type || ''),
                    p_description: str(b.description), p_bill_ref: str(b.bill_ref), p_date: b.date || null, p_shares: shares, p_user_name: userName
                })) });
            }
            case 'expense_void': {
                const x = (await get(`expenses?id=eq.${enc(b.id)}&select=paid_from_branch`))[0];
                if (!x || x.paid_from_branch !== M) throw new UserError('Expense not found.', 404);
                await rpc('expense_void', { p_id: +b.id, p_reason: str(b.reason) || '', p_user_name: userName });
                return res.status(200).json({ success: true });
            }
            case 'bank_add':
                return res.status(200).json({ success: true, ...(await rpc('bank_account_add', { p_branch: String(b.branch || M), p_name: str(b.name, 80), p_bank: str(b.bank, 80), p_account_no: str(b.account_no, 40), p_user_name: userName })) });
            case 'cash_close':
                return res.status(200).json({ success: true, ...(await rpc('cash_close', { p_branch: M, p_currency: mo.currency || 'OMR', p_date: b.date || today(), p_counted: num(b.counted), p_notes: str(b.notes), p_user_name: userName })) });
            default: throw new UserError('Unknown action.');
        }
    } catch (err) {
        if (err instanceof UserError) return res.status(err.status).json({ error: err.message });
        return res.status(500).json({ error: 'Main Office request failed.', details: err.message });
    }
}
