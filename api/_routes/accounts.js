// File: api/_routes/accounts.js — Phase C accounts.
// Roles:  staff            → price quote only (booking form)
//         branch_manager   → their branch: overview, invoices, receipts, expenses, cash closing, balances, rate cards, branch P&L
//         super_admin / head_office → all branches + chart of accounts, journal, trial balance, P&L, balance sheet
// Reports are per currency (no conversion).
//
// GET  ?view=quote&branch&dest&cargo&boxes=<JSON [{weight,l,w,h,commodity}]>   (or &kg&pieces for a simple quote)
// GET  ?view=booking_options&branch&dest      packages, extra charges, materials, commodities (any role)
// GET  ?view=pricing | materials | purchases | parties | costs | profit | inventory | requests | internal   (branch manager +)
// GET  ?view=overview|invoices|invoice&id|payments|expenses|balances|cash&date|rates|ledger&from&to|journal   [&branch]
// POST { action: invoice | payment | invoice_void | payment_void | expense | expense_void | cash_close
//                | rate_save | rate_delete | account_save | journal, ... }
import { requireSession, serviceHeaders, ADMIN_ROLES } from '../_lib/auth.js';
import { pickCard, priceFor, quoteShipment, cleanLines, PAY_MAP } from '../_lib/accounts.js';

const enc = encodeURIComponent;
const FULL = ADMIN_ROLES;                         // super_admin, head_office
const OPS = [...FULL, 'branch_manager'];
const METHODS = ['per_kg', 'vol_band', 'per_package', 'per_box', 'per_cbm', 'box_size', 'doc_slab'];
const BASES = ['per_shipment', 'per_box', 'per_kg'];
const COST_TYPES = ['freight', 'customs', 'trucking', 'handling', 'other'];
const SERVICES = ['air', 'sea', 'customs', 'delivery', 'trucking', 'packing', 'materials'];
const str = (v, n = 120) => String(v ?? '').trim().slice(0, n);
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
                const [cards, coms] = await Promise.all([
                    get(`rate_cards?branch_code=eq.${enc(branch)}&active=is.true&select=*`),
                    get('commodities?select=code,name')
                ]);
                let boxes = null;
                try { boxes = q.boxes ? JSON.parse(q.boxes) : null; } catch (e) { boxes = null; }
                if (Array.isArray(boxes) && boxes.length) {
                    const out = quoteShipment(cards, { dest: q.dest, cargo: q.cargo, boxes: boxes.slice(0, 200), commodityNames: Object.fromEntries(coms.map(c => [c.code, c.name])) });
                    return res.status(200).json({ quote: out.lines.length ? out : null, missing: out.missing,
                        message: out.lines.length ? null : 'No rate card for this route — enter the charge by hand.' });
                }
                const card = pickCard(cards, { dest: q.dest, cargo: q.cargo });
                if (!card) return res.status(200).json({ quote: null, message: 'No rate card for this route — enter the charge by hand.' });
                return res.status(200).json({ quote: priceFor(card, { kg: num(q.kg), pieces: num(q.pieces) || 1, boxes: num(q.boxes) || 1 }), card_id: card.id });
            }
            if (view === 'booking_options') {
                const branch = String((full ? q.branch : session.branch) || '').toUpperCase();
                if (!branch) throw new UserError('Choose the branch.');
                const dest = String(q.dest || '').toUpperCase();
                const [packages, charges, materials, commodities] = await Promise.all([
                    get(`package_rates?branch_code=eq.${enc(branch)}&active=is.true&dest_country_code=in.(%22*%22,%22${enc(dest || '*')}%22)&select=id,name,price,includes,dest_country_code&order=name`),
                    get(`charge_items?branch_code=eq.${enc(branch)}&active=is.true&dest_country_code=in.(%22*%22,%22${enc(dest || '*')}%22)&select=id,name,basis,price,cargo_type_code,dest_country_code,auto_add&order=name`),
                    get(`branch_products?branch_code=eq.${enc(branch)}&sell_price=gt.0&select=product_id,sell_price,qty,products!inner(name,unit,track_stock,active)&products.active=is.true`),
                    get('commodities?active=is.true&select=code,name&order=sort,name')
                ]);
                return res.status(200).json({
                    packages, charges, commodities,
                    materials: materials.map(m => ({ product_id: m.product_id, name: m.products.name, unit: m.products.unit, price: m.sell_price, qty: m.products.track_stock ? m.qty : null }))
                });
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
            if (view === 'rates' || view === 'pricing') {
                const [cards, dests, cargo, packages, charges, commodities] = await Promise.all([
                    get(`rate_cards?select=*${bf(branch)}&order=branch_code,dest_country_code,cargo_type_code,commodity`),
                    get('destination_codes?select=country_code,country_name&order=country_name'),
                    get('cargo_types?active=is.true&select=code,name&order=code'),
                    get(`package_rates?select=*${bf(branch)}&order=branch_code,name`),
                    get(`charge_items?select=*${bf(branch)}&order=branch_code,name`),
                    get('commodities?select=*&order=sort,name')
                ]);
                return res.status(200).json({ cards, destinations: dests, cargo_types: cargo, packages, charges, commodities });
            }
            if (view === 'materials') {
                const b = writeBranch(q.branch);
                const [products, stock, suppliers, moves] = await Promise.all([
                    get('products?select=*&order=name'),
                    get(`branch_products?branch_code=eq.${enc(b)}&select=*`),
                    get('suppliers?select=*&order=name'),
                    get(`stock_moves?branch_code=eq.${enc(b)}&select=*,products(name,unit)&order=created_at.desc&limit=60`)
                ]);
                const br = await branchRow(b);
                return res.status(200).json({
                    branch: b, currency: br.currency, suppliers, moves,
                    products: products.map(pr => { const st = stock.find(x => x.product_id === pr.id) || {}; return { ...pr, sell_price: st.sell_price ?? 0, avg_cost: st.avg_cost ?? 0, qty: st.qty ?? 0, reorder_level: st.reorder_level ?? 0 }; })
                });
            }
            if (view === 'parties') {
                const [parties, pur, cb] = await Promise.all([
                    get('suppliers?select=*&order=name'),
                    get(`purchases?status=in.(unpaid,partial)${bf(branch)}&select=supplier_id,currency,balance`),
                    get(`cost_bills?status=in.(unpaid,partial)${bf(branch)}&select=supplier_id,currency,balance`)
                ]);
                const owed = {};
                [...pur, ...cb].forEach(o => { if (!o.supplier_id) return; const k = `${o.supplier_id}|${o.currency}`; owed[k] = (owed[k] || 0) + +o.balance; });
                return res.status(200).json({ parties: parties.map(x => ({ ...x, owed: Object.entries(owed).filter(([k]) => k.startsWith(x.id + '|')).map(([k, v]) => ({ currency: k.split('|')[1], balance: Math.round(v * 1000) / 1000 })) })) });
            }
            if (view === 'costs') {
                const [bills, cons, parties] = await Promise.all([
                    get(`cost_bills?bill_date=gte.${from}&bill_date=lte.${to}${bf(branch)}&select=*,suppliers(name),consolidations(mawb,kind),bookings(awb)&order=bill_date.desc,id.desc&limit=300`),
                    get(`consolidations?select=id,mawb,kind,closed,origin_branch&order=closed.asc,created_at.desc&limit=100${full ? '' : `&origin_branch=eq.${enc(session.branch || '-')}`}`),
                    get('suppliers?active=is.true&select=id,name,kind&order=name')
                ]);
                return res.status(200).json({ bills, consolidations: cons, parties });
            }
            if (view === 'profit') {
                return res.status(200).json({ rows: await rpc('shipment_profit', { p_branch: branch, p_from: from, p_to: to }) });
            }
            if (view === 'inventory') {
                const [stock, branches, moves] = await Promise.all([
                    get(`branch_products?select=branch_code,product_id,qty,avg_cost,sell_price,reorder_level,products!inner(sku,name,unit,track_stock,active)&products.track_stock=is.true${bf(branch)}&order=branch_code`),
                    get('branches?select=branch_code,branch_name,currency,branch_type&order=branch_name'),
                    get(`stock_moves?created_at=gte.${from}&created_at=lt.${enc(nextDay(to))}${bf(branch)}${q.product ? `&product_id=eq.${enc(q.product)}` : ''}&select=*,products(name,unit)&order=created_at.desc&limit=300`)
                ]);
                return res.status(200).json({ stock, branches, moves });
            }
            if (view === 'requests') {
                const mine = full ? '' : `&or=(branch_code.eq.${enc(session.branch || '-')},warehouse.eq.${enc(session.branch || '-')})`;
                const [requests, warehouses] = await Promise.all([
                    get(`stock_requests?select=*${mine}&order=requested_at.desc&limit=200`),
                    get('branches?branch_type=eq.warehouse&select=branch_code,branch_name,currency')
                ]);
                const whStock = warehouses.length ? await get(`branch_products?branch_code=in.(${warehouses.map(w => enc(w.branch_code)).join(',')})&select=branch_code,product_id,qty,sell_price,products!inner(name,unit,track_stock,active)&products.track_stock=is.true&products.active=is.true`) : [];
                return res.status(200).json({ requests, warehouses, warehouse_stock: whStock, my_branch: session.branch || null });
            }
            if (view === 'internal') {
                const [reqs, sets] = await Promise.all([
                    get('stock_requests?status=in.(dispatched,received)&select=warehouse,branch_code,currency,total'),
                    get('internal_settlements?select=*&order=settled_at.desc&limit=100')
                ]);
                const bal = {};
                reqs.forEach(r => { const k = `${r.warehouse}|${r.branch_code}|${r.currency}`; bal[k] = (bal[k] || 0) + +r.total; });
                sets.forEach(x => { const k = `${x.warehouse}|${x.branch_code}|${x.currency}`; bal[k] = (bal[k] || 0) - +x.amount; });
                const rows = Object.entries(bal).map(([k, v]) => { const [warehouse, branch_code, currency] = k.split('|'); return { warehouse, branch_code, currency, owed: Math.round(v * 1000) / 1000 }; })
                    .filter(r => full || r.branch_code === session.branch || r.warehouse === session.branch);
                return res.status(200).json({ balances: rows, settlements: sets.filter(x => full || x.branch_code === session.branch || x.warehouse === session.branch) });
            }
            if (view === 'purchases') {
                const [purchases, suppliers] = await Promise.all([
                    get(`purchases?purchase_date=gte.${from}&purchase_date=lte.${to}${bf(branch)}&select=*,suppliers(name)&order=purchase_date.desc,id.desc&limit=300`),
                    get('suppliers?select=*&order=name')
                ]);
                const owed = await get(`purchases?status=in.(unpaid,partial)${bf(branch)}&select=supplier_id,currency,balance`);
                const bySup = {};
                owed.forEach(o => { const k = `${o.supplier_id}|${o.currency}`; bySup[k] = (bySup[k] || 0) + +o.balance; });
                return res.status(200).json({ purchases, suppliers, owed: Object.entries(bySup).map(([k, v]) => { const [id, cur] = k.split('|'); return { supplier_id: +id, currency: cur, balance: Math.round(v * 1000) / 1000 }; }) });
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
                const lines = cleanLines(b.lines);
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
                const sizes = b.method === 'box_size'
                    ? (Array.isArray(b.sizes) ? b.sizes : []).map(x => ({ name: str(x.name, 40), l: num(x.l), w: num(x.w), h: num(x.h), price: num(x.price) })).filter(x => x.name && x.l > 0 && x.w > 0 && x.h > 0 && x.price >= 0)
                    : [];
                if (b.method === 'vol_band' && !bands.length) throw new UserError('Add at least one weight band.');
                if (b.method === 'box_size' && !sizes.length) throw new UserError('Add at least one box size (name, L × W × H cm, price).');
                const slab = b.method === 'doc_slab' ? { base_kg: num(b.slab?.base_kg), base_price: num(b.slab?.base_price), step_kg: num(b.slab?.step_kg) || 0, step_price: num(b.slab?.step_price) || 0 } : {};
                if (b.method === 'doc_slab' && !(slab.base_kg > 0 && slab.base_price >= 0 && b.slab?.base_price !== '')) throw new UserError('Enter the first slab weight and its price.');
                if (b.method === 'doc_slab' && slab.step_price > 0 && !(slab.step_kg > 0)) throw new UserError('Enter the weight of each extra step.');
                if (!['vol_band', 'box_size', 'doc_slab'].includes(b.method) && !(num(b.rate) > 0)) throw new UserError('Enter the rate.');
                const dest = b.dest_country_code ? String(b.dest_country_code).toUpperCase() : '*';
                if (dest !== '*' && !/^[A-Z]{2}$/.test(dest)) throw new UserError('Destination must be a 2-letter country code or "any".');
                const row = {
                    branch_code: branch, dest_country_code: dest, cargo_type_code: b.cargo_type_code || '*', commodity: b.commodity || '*', method: b.method, sizes, slab,
                    currency: br.currency || 'OMR', rate: num(b.rate) || 0, min_charge: num(b.min_charge) || 0, bands,
                    extra_per_kg: num(b.extra_per_kg) || 0, note: b.note || null, active: b.active !== false,
                    updated_at: new Date().toISOString(), updated_by_name: userName
                };
                if (b.id) own((await get(`rate_cards?id=eq.${enc(b.id)}&select=id,branch_code`))[0]);
                const r = await fetch(`${rest}/rate_cards${b.id ? `?id=eq.${enc(b.id)}` : ''}`, {
                    method: b.id ? 'PATCH' : 'POST', headers: { ...serviceHeaders(), Prefer: 'return=representation' }, body: JSON.stringify(row)
                });
                const out = await r.json().catch(() => ({}));
                if (!r.ok) throw new UserError(/duplicate|unique/i.test(out.message || '') ? 'A rate card for this branch, destination, cargo and commodity already exists — edit that one.' : out.message || 'Could not save.');
                return res.status(200).json({ success: true, card: out[0] });
            }
            case 'rate_delete': {
                own((await get(`rate_cards?id=eq.${enc(b.id)}&select=id,branch_code`))[0]);
                await fetch(`${rest}/rate_cards?id=eq.${enc(b.id)}`, { method: 'DELETE', headers: serviceHeaders() });
                return res.status(200).json({ success: true });
            }
            case 'package_save':
            case 'charge_save': {
                const isPkg = b.action === 'package_save';
                const branch = writeBranch(b.branch_code);
                const name = str(b.name, 80);
                if (!name) throw new UserError('Enter the name.');
                if (!(num(b.price) >= 0) || b.price === '' || b.price === null) throw new UserError('Enter the price.');
                if (!isPkg && !BASES.includes(b.basis)) throw new UserError('Choose how the charge is counted.');
                const table = isPkg ? 'package_rates' : 'charge_items';
                const row = isPkg
                    ? { branch_code: branch, dest_country_code: /^[A-Z]{2}$/.test(String(b.dest_country_code || '').toUpperCase()) ? String(b.dest_country_code).toUpperCase() : '*', name, price: num(b.price), includes: str(b.includes, 200) || null, active: b.active !== false, updated_at: new Date().toISOString() }
                    : { branch_code: branch, name, basis: b.basis, price: num(b.price), active: b.active !== false, auto_add: Boolean(b.auto_add),
                        cargo_type_code: str(b.cargo_type_code, 10) || '*',
                        dest_country_code: /^[A-Z]{2}$/.test(String(b.dest_country_code || '').toUpperCase()) ? String(b.dest_country_code).toUpperCase() : '*' };
                if (b.id) own((await get(`${table}?id=eq.${enc(b.id)}&select=id,branch_code`))[0]);
                const r = await fetch(`${rest}/${table}${b.id ? `?id=eq.${enc(b.id)}` : ''}`, { method: b.id ? 'PATCH' : 'POST', headers: serviceHeaders(), body: JSON.stringify(row) });
                if (!r.ok) { const out = await r.json().catch(() => ({})); throw new UserError(/duplicate|unique/i.test(out.message || '') ? (isPkg ? 'That name already exists for this branch.' : 'This charge already exists for the same cargo type and destination.') : out.message || 'Could not save.'); }
                return res.status(200).json({ success: true });
            }
            case 'package_delete':
            case 'charge_delete': {
                const table = b.action === 'package_delete' ? 'package_rates' : 'charge_items';
                own((await get(`${table}?id=eq.${enc(b.id)}&select=id,branch_code`))[0]);
                await fetch(`${rest}/${table}?id=eq.${enc(b.id)}`, { method: 'DELETE', headers: serviceHeaders() });
                return res.status(200).json({ success: true });
            }
            case 'commodity_save': {
                need(FULL);
                const code = String(b.code || '').trim().toUpperCase();
                if (!/^[A-Z0-9]{2,8}$/.test(code)) throw new UserError('Commodity code: 2–8 letters / numbers (e.g. ELEC).');
                if (!str(b.name, 40)) throw new UserError('Enter the commodity name.');
                const r = await fetch(`${rest}/commodities?on_conflict=code`, { method: 'POST', headers: { ...serviceHeaders(), Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify({ code, name: str(b.name, 40), active: b.active !== false }) });
                if (!r.ok) throw new UserError('Could not save.');
                return res.status(200).json({ success: true });
            }
            case 'product_save': {
                const sku = String(b.sku || '').trim().toUpperCase().replace(/\s+/g, '-');
                if (!/^[A-Z0-9-]{2,20}$/.test(sku)) throw new UserError('Item code: 2–20 letters, numbers or dashes.');
                if (!str(b.name, 80)) throw new UserError('Enter the item name.');
                const row = { sku, name: str(b.name, 80), unit: str(b.unit, 10) || 'pcs', track_stock: b.track_stock !== false, active: b.active !== false };
                const r = await fetch(`${rest}/products${b.id ? `?id=eq.${enc(b.id)}` : ''}`, { method: b.id ? 'PATCH' : 'POST', headers: { ...serviceHeaders(), Prefer: 'return=representation' }, body: JSON.stringify(row) });
                const out = await r.json().catch(() => ({}));
                if (!r.ok) throw new UserError(/duplicate|unique/i.test(out.message || '') ? `Item code ${sku} is already used.` : out.message || 'Could not save.');
                const id = b.id || out[0]?.id;
                if (b.branch_code !== undefined || b.sell_price !== undefined) {
                    const branch = writeBranch(b.branch_code);
                    await fetch(`${rest}/branch_products?on_conflict=branch_code,product_id`, {
                        method: 'POST', headers: { ...serviceHeaders(), Prefer: 'resolution=merge-duplicates' },
                        body: JSON.stringify({ branch_code: branch, product_id: id, sell_price: num(b.sell_price) || 0, reorder_level: num(b.reorder_level) || 0 })
                    });
                }
                return res.status(200).json({ success: true, id });
            }
            case 'supplier_save': {
                if (!str(b.name, 80)) throw new UserError('Enter the supplier name.');
                const row = {
                    name: str(b.name, 80), phone: str(b.phone, 30) || null, notes: str(b.notes, 200) || null, active: b.active !== false,
                    kind: ['supplier', 'agent', 'both'].includes(b.kind) ? b.kind : 'supplier',
                    contact_person: str(b.contact_person, 80) || null, email: str(b.email, 120) || null, address: str(b.address, 300) || null,
                    country: str(b.country, 60) || null, tax_no: str(b.tax_no, 40) || null,
                    payment_terms_days: Math.max(0, Math.min(365, parseInt(b.payment_terms_days, 10) || 0)),
                    services: (Array.isArray(b.services) ? b.services : []).filter(x => SERVICES.includes(x))
                };
                if (row.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(row.email)) throw new UserError('Check the email address.');
                const r = await fetch(`${rest}/suppliers${b.id ? `?id=eq.${enc(b.id)}` : ''}`, { method: b.id ? 'PATCH' : 'POST', headers: { ...serviceHeaders(), Prefer: 'return=representation' }, body: JSON.stringify(row) });
                const out = await r.json().catch(() => ({}));
                if (!r.ok) throw new UserError(/duplicate|unique/i.test(out.message || '') ? 'A supplier with that name exists.' : 'Could not save.');
                return res.status(200).json({ success: true, id: b.id || out[0]?.id });
            }
            case 'purchase': {
                const br = await branchRow(writeBranch(b.branch));
                const lines = (Array.isArray(b.lines) ? b.lines : []).slice(0, 60).map(l => ({ product_id: l.product_id ? Number(l.product_id) : null, description: str(l.description, 200), qty: num(l.qty), unit_cost: num(l.unit_cost) })).filter(l => l.qty > 0);
                if (!lines.length) throw new UserError('Add at least one item.');
                const out = await rpc('purchase_create', {
                    p_branch: br.branch_code, p_supplier_id: b.supplier_id ? Number(b.supplier_id) : null, p_currency: br.currency || 'OMR', p_lines: lines,
                    p_pay_method: b.pay_method === 'credit' ? 'credit' : (PAY_MAP[b.pay_method] || b.pay_method), p_bill_ref: b.bill_ref || null, p_date: b.date || null, p_notes: b.notes || null, p_user_name: userName
                });
                return res.status(200).json({ success: true, ...out });
            }
            case 'supplier_pay': {
                own((await get(`purchases?id=eq.${enc(b.purchase_id)}&select=id,branch_code`))[0]);
                const out = await rpc('supplier_pay', { p_purchase_id: Number(b.purchase_id), p_amount: num(b.amount), p_method: PAY_MAP[b.method] || b.method, p_reference: b.reference || null, p_user_name: userName });
                return res.status(200).json({ success: true, ...out });
            }
            case 'purchase_void': {
                own((await get(`purchases?id=eq.${enc(b.id)}&select=id,branch_code`))[0]);
                await rpc('purchase_void', { p_id: Number(b.id), p_reason: b.reason || '', p_user_name: userName });
                return res.status(200).json({ success: true });
            }
            case 'stock_count': {
                const br = await branchRow(writeBranch(b.branch));
                const out = await rpc('stock_count', { p_branch: br.branch_code, p_product: Number(b.product_id), p_counted: num(b.counted), p_note: b.note || null, p_user_name: userName, p_currency: br.currency || 'OMR' });
                return res.status(200).json({ success: true, ...out });
            }
            case 'cost_bill': {
                const br = await branchRow(writeBranch(b.branch));
                if (!COST_TYPES.includes(b.cost_type)) throw new UserError('Choose the cost type.');
                let bookingId = null;
                if (b.awb) {
                    const bk = (await get(`bookings?awb=eq.${enc(String(b.awb).trim().toUpperCase())}&select=id,branch_code`))[0];
                    if (!bk) throw new UserError(`Shipment ${b.awb} not found.`);
                    bookingId = bk.id;
                }
                if (!b.consolidation_id && !bookingId) throw new UserError('Choose the MAWB / container, or enter the shipment AWB.');
                const out = await rpc('cost_bill_create', {
                    p_branch: br.branch_code, p_supplier_id: b.supplier_id ? Number(b.supplier_id) : null, p_consolidation_id: b.consolidation_id ? Number(b.consolidation_id) : null,
                    p_booking_id: bookingId, p_type: b.cost_type, p_description: b.description || null, p_currency: br.currency || 'OMR', p_amount: num(b.amount),
                    p_pay_method: b.pay_method === 'credit' ? 'credit' : (PAY_MAP[b.pay_method] || b.pay_method), p_bill_ref: b.bill_ref || null, p_date: b.date || null, p_user_name: userName
                });
                return res.status(200).json({ success: true, ...out });
            }
            case 'cost_bill_pay': {
                own((await get(`cost_bills?id=eq.${enc(b.id)}&select=id,branch_code`))[0]);
                const out = await rpc('cost_bill_pay', { p_id: Number(b.id), p_amount: num(b.amount), p_method: PAY_MAP[b.method] || b.method, p_reference: b.reference || null, p_user_name: userName });
                return res.status(200).json({ success: true, ...out });
            }
            case 'cost_bill_void': {
                own((await get(`cost_bills?id=eq.${enc(b.id)}&select=id,branch_code`))[0]);
                await rpc('cost_bill_void', { p_id: Number(b.id), p_reason: b.reason || '', p_user_name: userName });
                return res.status(200).json({ success: true });
            }
            case 'stock_request': {
                const out = await rpc('stock_request_create', { p_branch: writeBranch(b.branch), p_warehouse: String(b.warehouse || '').toUpperCase(), p_lines: Array.isArray(b.lines) ? b.lines.slice(0, 60) : [], p_notes: b.notes || null, p_user_name: userName });
                return res.status(200).json({ success: true, ...out });
            }
            case 'stock_dispatch':
            case 'stock_reject':
                throw new UserError('Send or reject requests on the Warehouse page (needs your warehouse PIN).', 403);
            case 'stock_receive':
            case 'stock_cancel': {
                const r = (await get(`stock_requests?id=eq.${enc(b.id)}&select=*`))[0];
                if (!r) throw new UserError('Request not found.', 404);
                if (!full && session.branch !== r.branch_code) throw new UserError('Only the requesting branch can do this.', 403);
                if (b.action === 'stock_receive') return res.status(200).json({ success: true, ...(await rpc('stock_request_receive', { p_id: r.id, p_user_name: userName })) });
                if (r.status !== 'requested') throw new UserError(`${r.request_no} is already ${r.status}.`);
                await fetch(`${rest}/stock_requests?id=eq.${r.id}&status=eq.requested`, { method: 'PATCH', headers: serviceHeaders(), body: JSON.stringify({ status: 'cancelled' }) });
                return res.status(200).json({ success: true });
            }
            case 'internal_settle': {
                need(FULL);
                const out = await rpc('internal_settle', { p_warehouse: String(b.warehouse || '').toUpperCase(), p_branch: String(b.branch_code || '').toUpperCase(), p_amount: num(b.amount), p_method: PAY_MAP[b.method] || b.method, p_reference: b.reference || null, p_user_name: userName });
                return res.status(200).json({ success: true, ...out });
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
