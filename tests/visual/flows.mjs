// Runs the same clicks and typing on the old page and on its React version, taking a screenshot after each step,
// so the two can be compared with compare.mjs. Selectors are the element ids both versions share.
//
//   node tests/visual/flows.mjs --target old --out flows-old     (mock server on :5178)
//   node tests/visual/flows.mjs --target new --out flows-new     (vite dev on :5173)
//   node tests/visual/compare.mjs --base flows-old --cur flows-new --diff flows-diff
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { PAGES } from './pages.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, '../../web/package.json'));
const { chromium } = require('playwright-core');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const target = arg('target', 'old');
const outDir = path.join(here, arg('out', `flows-${target}`));
const base = target === 'old' ? 'http://localhost:5178' : 'http://localhost:5173';
const only = arg('page', null);

// Each flow: [page name, [step name, action(page)] …]. A screenshot follows every step.
const FLOWS = {
    booking: [
        ['destination', async (p) => { await p.click('#destCountry'); await p.type('#destCountry', 'india'); await p.keyboard.press('Enter'); await p.waitForTimeout(600); }],
        ['cargo-and-sender', async (p) => { await p.click('#cargoOptions label:nth-child(2)'); await p.click('#senderPhone'); await p.type('#senderPhone', '91234567'); await p.press('#senderPhone', 'Enter'); await p.waitForTimeout(700); }],
        ['receiver', async (p) => {
            await p.fill('#senderName', 'Ali Hassan'); await p.fill('#rcvName', 'Rahul Nair'); await p.fill('#rcvPhone', '9876543210');
            await p.click('#rcvState'); await p.type('#rcvState', 'kera'); await p.waitForTimeout(500); await p.keyboard.press('Enter'); await p.waitForTimeout(500);
            await p.click('#rcvCity'); await p.type('#rcvCity', 'Kannur'); await p.keyboard.press('Enter'); await p.fill('#rcvHouse', 'Rose Villa'); await p.waitForTimeout(300);
        }],
        ['boxes-and-quote', async (p) => {
            await p.fill('#boxRows [data-box]:nth-child(1) [data-k="weight"]', '12.5'); await p.fill('#boxRows [data-box]:nth-child(1) [data-k="l"]', '50'); await p.fill('#boxRows [data-box]:nth-child(1) [data-k="w"]', '40'); await p.fill('#boxRows [data-box]:nth-child(1) [data-k="h"]', '40');
            await p.click('#addBox'); await p.fill('#boxRows [data-box]:nth-child(2) [data-k="weight"]', '8'); await p.waitForTimeout(1500);
        }],
        ['extras', async (p) => {
            const pick = async (sel) => { const v = await p.$eval(sel, s => [...s.options].find(o => o.value)?.value || ''); if (v) await p.selectOption(sel, v); };
            await pick('#addPackage'); await pick('#addCharge'); await pick('#addMaterial'); await p.click('#addOther'); await p.waitForTimeout(400);
        }],
        ['freight-removed', async (p) => { const f = p.locator('#chargeRows tr:has(.pill-dark) [data-cdel]'); if (await f.count()) await f.first().click(); await p.waitForTimeout(400); }],
        ['freight-back', async (p) => { const b = p.locator('#quoteHint button'); if (await b.count()) await b.click(); await p.waitForTimeout(1500); }],
        ['review', async (p) => { await p.fill('#declared', '120'); await p.click('#bookBtn'); await p.waitForTimeout(400); }],
        ['booked', async (p) => { await p.click('[data-confirm] [data-v="1"]'); await p.waitForTimeout(1200); }]
    ],
    branches: [
        ['search', async (p) => { await p.selectOption('#statusFilter', ''); await p.fill('#branchSearch', 'sal'); }],
        ['add-form', async (p) => { await p.fill('#branchSearch', ''); await p.click('#addBtn'); await p.waitForTimeout(1200); }],
        ['add-typed', async (p) => { await p.type('#b_name', 'Al-Farha Cargo Nizwa'); await p.fill('#b_digit', '1'); await p.fill('#b_street', 'Souq Rd'); await p.waitForTimeout(300); }],
        ['state-list', async (p) => { await p.click('#b_state'); await p.waitForTimeout(500); }],
        ['state-picked', async (p) => { await p.type('#b_state', 'dakh'); await p.keyboard.press('Enter'); await p.waitForTimeout(500); }],
        ['city-picked', async (p) => { await p.click('#b_city'); await p.type('#b_city', 'nizwa'); await p.waitForTimeout(400); await p.keyboard.press('Enter'); await p.waitForTimeout(400); }],
        ['postal', async (p) => { await p.fill('#b_postal', ''); await p.type('#b_postal', '611'); await p.waitForTimeout(900); }],
        ['save-asks', async (p) => { await p.fill('#b_digit', '9'); await p.fill('#b_phone', '25412345'); await p.click('#branchSave'); }],
        ['saved', async (p) => { await p.click('[data-confirm] [data-v="1"]'); }],
        ['edit', async (p) => { await p.click('#branchGrid article button[aria-label^="Actions"]'); await p.waitForTimeout(200); await p.click('.row-menu button:has-text("Edit branch")'); await p.waitForTimeout(1500); }],
        ['destinations', async (p) => { await p.keyboard.press('Escape'); await p.waitForTimeout(400); await p.click('[data-tab="destinations"]'); }],
        ['dest-edit', async (p) => { await p.click('#destRows button[aria-label^="Actions"]'); await p.waitForTimeout(200); await p.click('.row-menu button:has-text("Edit code")'); }],
        ['dest-add', async (p) => { await p.keyboard.press('Escape'); await p.waitForTimeout(400); await p.click('#addBtn'); await p.click('#d_country'); await p.type('#d_country', 'kenya'); await p.keyboard.press('Enter'); }],
        ['dest-saved', async (p) => { await p.click('#destForm button.btn-dark'); }],
        ['cargo', async (p) => { await p.click('[data-tab="cargo"]'); }],
        ['cargo-edit', async (p) => { await p.click('#cargoGrid button[aria-label^="Edit"]'); await p.waitForTimeout(300); await p.fill('#c_desc', 'Door to door'); }],
        ['cargo-saved', async (p) => { await p.click('#cargoForm button.btn-dark'); await p.waitForTimeout(300); await p.click('[data-tab="branches"]'); }]
    ],
    delivery: [
        ['select-two', async (p) => { const boxes = p.locator('#readyRows [data-sel]'); await boxes.nth(0).check(); if (await boxes.count() > 1) await boxes.nth(1).check(); }],
        ['search', async (p) => { await p.type('#pickInput', 'sal'); }],
        ['dispatch-form', async (p) => { await p.fill('#pickInput', ''); await p.dispatchEvent('#pickInput', 'input'); await p.click('#selSend'); }],
        ['dispatch-agent', async (p) => { await p.click('[data-mode="agent"]'); await p.click('#dAgent'); await p.type('#dAgent', 'aram'); }],
        ['dispatch-agent-picked', async (p) => { await p.keyboard.press('Enter'); await p.fill('#dRef', 'AX-77'); }],
        ['dispatched', async (p) => { await p.click('#dispatchBtn'); }],
        ['out-tab', async (p) => { await p.click('[data-tab="out"]'); }],
        ['pod', async (p) => { await p.click('#outCards [data-outcome="delivered"]'); }],
        ['pod-signed', async (p) => {
            const b = await p.locator('#sigPad').boundingBox();
            await p.mouse.move(b.x + 30, b.y + 60); await p.mouse.down(); await p.mouse.move(b.x + 120, b.y + 30, { steps: 8 }); await p.mouse.move(b.x + 220, b.y + 90, { steps: 8 }); await p.mouse.up();
            await p.fill('#pIdNo', '998877');
        }],
        ['pod-saved', async (p) => { await p.click('#podBtn'); await p.waitForTimeout(800); }],
        ['failed-form', async (p) => { await p.keyboard.press('Escape'); await p.waitForTimeout(400); const f = p.locator('#outCards [data-outcome="failed"]'); if (await f.count()) await f.first().click(); }],
        ['done-tab', async (p) => { await p.keyboard.press('Escape'); await p.waitForTimeout(400); await p.click('[data-tab="done"]'); }],
        ['collected', async (p) => { await p.click('[data-tab="ready"]'); await p.waitForTimeout(300); const c = p.locator('[data-collect]'); if (await c.count()) await c.first().click(); }]
    ],
    'create-user': [
        ['filter-all-staff', async (p) => { await p.selectOption('#activeFilter', ''); await p.selectOption('#roleFilter', 'staff'); }],
        ['search', async (p) => { await p.selectOption('#roleFilter', ''); await p.fill('#search', 'sara'); }],
        ['row-menu', async (p) => { await p.fill('#search', ''); await p.waitForTimeout(200); await p.click('#rows tr:nth-child(2) button[aria-label^="Actions"]'); }],
        ['edit', async (p) => { await p.click('.row-menu button:has-text("Edit user")'); }],
        ['edit-warehouse-on', async (p) => { await p.fill('#e_contact', '91112233'); await p.check('#e_wh'); await p.click('#e_off [data-dow="6"]'); await p.fill('#e_brStart', '13:00'); await p.fill('#e_brEnd', '14:00'); }],
        ['edit-role-change-asks', async (p) => { await p.selectOption('#e_role', 'head_office'); await p.click('#editForm button.btn-dark'); }],
        ['edit-saved', async (p) => { await p.click('[data-confirm] [data-v="1"]'); }],
        ['create-form', async (p) => { await p.click('button:has-text("Add User")'); await p.waitForTimeout(300); await p.selectOption('#c_role', 'branch_manager'); }],
        ['create-fill', async (p) => { await p.fill('#c_fullName', 'Noor Al Harthy'); await p.fill('#c_contact', '91234567'); await p.fill('#c_email', 'noor@example.com'); await p.fill('#c_username', 'nalharthy'); await p.fill('#c_password', 'Temp-pass-123'); await p.selectOption('#c_branch', { index: 1 }); }],
        ['create-confirm', async (p) => { await p.click('#createBtn'); }],
        ['create-done', async (p) => { await p.click('[data-confirm] [data-v="1"]'); await p.waitForTimeout(1200); }],
        ['deactivate-asks', async (p) => { await p.click('#rows tr:nth-child(2) button[aria-label^="Actions"]'); await p.waitForTimeout(200); await p.click('.row-menu button.danger'); }]
    ],
    shipments: [
        ['card', async (p) => { await p.click('#rows tr:nth-child(1) td:nth-child(3)'); }],
        ['card-track', async (p) => { await p.click('#drawer .sx-tab[data-tab="track"]'); }],
        ['card-pod', async (p) => { await p.click('#drawer .sx-tab[data-tab="pod"]'); }],
        ['card-copy', async (p) => { await p.click('#drawer [data-tab="info"]'); await p.click('#drawer .sx-copy'); }],
        ['card-close', async (p) => { await p.click('#drawer .sx-close'); }],
        ['row-edit', async (p) => { await p.click('#rows tr:nth-child(1) .icon-btn'); await p.waitForTimeout(300); await p.click('.row-menu button >> nth=1'); }],
        ['edit-change', async (p) => { await p.fill('#f_weight', '14'); await p.click('#f_intake [data-v="pickup"]'); }],
        ['edit-ask', async (p) => { await p.click('#saveBtn'); }],
        ['edit-go', async (p) => { await p.click('[data-confirm] [data-v="1"]'); }],
        ['branch-pick', async (p) => { await p.selectOption('#workBranch', { index: 1 }); }],
        ['scan-pickup', async (p) => { await p.click('[data-intake="pickup"]'); await p.fill('#scanInput', 'alf00999'); await p.press('#scanInput', 'Enter'); }],
        ['review-edit', async (p) => { await p.fill('#f_consignee_address', 'Ward 4, Bhaktapur'); await p.selectOption('#f_package_type', 'Parcel'); }],
        ['review-ask', async (p) => { await p.click('#saveBtn'); }],
        ['review-back', async (p) => { await p.click('[data-confirm] [data-v="0"]'); }],
        ['review-ask2', async (p) => { await p.click('#saveBtn'); }],
        ['review-add', async (p) => { await p.click('[data-confirm] [data-v="1"]'); }],
        ['bulk', async (p) => { await p.click('details summary'); await p.fill('#bulkInput', 'ALF1, ALF2\nBAD9'); await p.click('#bulkBtn'); }],
        ['bulk-go', async (p) => { await p.click('[data-confirm] [data-v="1"]'); }],
        ['filter', async (p) => { await p.fill('#search', 'fathima'); await p.selectOption('#statusFilter', { index: 2 }); }],
        ['menu', async (p) => { await p.locator('#rows tr:nth-child(2)').scrollIntoViewIfNeeded(); await p.waitForTimeout(500); await p.click('#rows tr:nth-child(2) .icon-btn'); }],
        ['menu-cancel', async (p) => { await p.click('.row-menu button.danger >> nth=0'); await p.waitForTimeout(300); await p.fill('#cancelReason', 'Customer cancelled'); }],
        ['cancel-go', async (p) => { await p.click('#cancelForm button.btn-coral'); }],
        ['menu2', async (p) => { await p.locator('#rows tr:nth-child(3)').scrollIntoViewIfNeeded(); await p.waitForTimeout(500); await p.click('#rows tr:nth-child(3) .icon-btn'); }],
        ['delete-ask', async (p) => { await p.click('.row-menu button.danger >> nth=-1'); }],
        ['delete-go', async (p) => { await p.click('[data-confirm] [data-v="1"]'); }],
        ['csv', async (p) => { await p.click('button:has-text("Upload CSV")'); await p.waitForTimeout(300);
            await p.setInputFiles('#csvFile', { name: 's.csv', mimeType: 'text/csv', buffer: Buffer.from('BookingID,Shipper,Consignee,Weight,DestCountry\n"A1","Ali","Sara, K.",3,India\nA1,X,Y,1,Nepal\nA2,,Z,2,India\n') }); }],
        ['csv-ask', async (p) => { await p.click('#csvSave'); }],
        ['csv-go', async (p) => { await p.click('[data-confirm] [data-v="1"]'); }],
        ['sync', async (p) => { await p.click('#syncBtn'); }]
    ],
    accounts: [
        ['new-invoice', async (p) => { await p.click('button:has-text("New invoice")'); await p.waitForTimeout(300); await p.fill('#iName', 'Ali'); await p.click('#formBody button:has-text("Add line")'); await p.fill('#iLines [data-line]:nth-child(2) [data-k=description]', 'Packing'); await p.fill('#iLines [data-line]:nth-child(2) [data-k=rate]', '2'); }],
        ['invoice-create', async (p) => { await p.click('#formOk'); }],
        ['invoice-open', async (p) => { await p.waitForTimeout(800); }],
        ['invoice-pay', async (p) => { await p.fill('#pAmt', '1'); await p.click('#formBody button:has-text("Receive")'); }],
        ['invoice-close', async (p) => { await p.click('#formModal .btn-light:has-text("Close")'); }],
        ['range-year', async (p) => { await p.click('[data-range="year"]'); }],
        ['branch', async (p) => { await p.selectOption('#fBranch', 'ALFSLL'); }],
        ['invoices', async (p) => { await p.click('[data-tab="invoices"]'); }],
        ['invoices-all', async (p) => { await p.click('[data-inv-status="all"]'); }],
        ['invoices-search', async (p) => { await p.fill('#invQ', 'fath'); await p.waitForTimeout(700); }],
        ['invoice-row', async (p) => { await p.click('[data-inv] >> nth=0'); }],
        ['invoice-void', async (p) => { const b = p.locator('#formExtra .btn-danger'); if (await b.count()) await b.click(); else await p.click('#formModal .btn-light:has-text("Close")'); }],
        ['void-close', async (p) => { await p.keyboard.press('Escape'); }],
        ['payments', async (p) => { await p.click('[data-tab="payments"]'); }],
        ['payment-void', async (p) => { await p.click('#panel button:has-text("Void") >> nth=0'); await p.fill('#vReason', 'twice'); }],
        ['payment-void-go', async (p) => { await p.click('#formOk'); }],
        ['expenses', async (p) => { await p.click('[data-tab="expenses"]'); }],
        ['expense-form', async (p) => { await p.click('button:has-text("Add expense")'); await p.waitForTimeout(300); await p.fill('#eAmt', '4.5'); await p.fill('#eTo', 'Shell'); }],
        ['expense-save', async (p) => { await p.click('#formOk'); }],
        ['cash', async (p) => { await p.click('[data-tab="cash"]'); }],
        ['cash-close', async (p) => { await p.fill('[data-close] [name=counted]', '41.25'); await p.click('[data-close] button.btn-dark'); }],
        ['cash-go', async (p) => { await p.click('[data-confirm] [data-v="1"]'); }],
        ['balances', async (p) => { await p.click('[data-tab="balances"]'); }],
        ['pricing', async (p) => { await p.click('[data-tab="pricing"]'); }],
        ['rate-edit', async (p) => { await p.click('[data-rate] >> nth=3'); }],
        ['rate-band', async (p) => { await p.click('[data-method="vol_band"]'); await p.click('#formBody button:has-text("Add band")'); await p.fill('#rBands [data-band]:nth-child(2) [data-k=upto]', '50'); }],
        ['rate-doc', async (p) => { await p.click('[data-method="doc_slab"]'); }],
        ['rate-save', async (p) => { await p.click('#formOk'); }],
        ['packages', async (p) => { await p.click('[data-psub="packages"]'); }],
        ['package-edit', async (p) => { await p.click('[data-pkg] >> nth=0'); }],
        ['package-save', async (p) => { await p.click('#formOk'); }],
        ['charges', async (p) => { await p.click('[data-psub="charges"]'); }],
        ['charge-new', async (p) => { await p.click('button:has-text("New charge")'); await p.waitForTimeout(300); await p.fill('#chName', 'Packing'); await p.fill('#chPrice', '1'); await p.check('#chAuto'); }],
        ['charge-save', async (p) => { await p.click('#formOk'); }],
        ['commodities', async (p) => { await p.click('[data-psub="commodities"]'); }],
        ['costs', async (p) => { await p.click('[data-tab="costs"]'); }],
        ['cost-new', async (p) => { await p.click('button:has-text("Add cost")'); await p.waitForTimeout(300); await p.selectOption('#cFor', '7'); await p.fill('#cAmt', '30'); }],
        ['cost-save', async (p) => { await p.click('#formOk'); }],
        ['cost-pay', async (p) => { await p.click('#panel button:has-text("Pay") >> nth=0'); }],
        ['cost-pay-go', async (p) => { await p.click('#formOk'); }],
        ['profit', async (p) => { await p.click('[data-csub="profit"]'); }],
        ['parties', async (p) => { await p.click('[data-tab="parties"]'); }],
        ['parties-agents', async (p) => { await p.click('[data-pkind="agent"]'); }],
        ['party-edit', async (p) => { await p.click('[data-party] >> nth=0'); }],
        ['party-save', async (p) => { await p.fill('#suNotes', 'Main sea agent'); await p.click('#formOk'); }],
        ['materials', async (p) => { await p.click('[data-tab="materials"]'); }],
        ['sale', async (p) => { await p.click('#panel button:has-text("Counter sale")'); await p.waitForTimeout(500); await p.click('#formBody button:has-text("Add item")'); await p.selectOption('#saLines [data-sl]:nth-child(2) [data-k=product_id]', '3'); await p.fill('#saLines [data-sl]:nth-child(2) [data-k=qty]', '2'); }],
        ['sale-go', async (p) => { await p.click('#formOk'); await p.waitForTimeout(600); }],
        ['sale-close', async (p) => { await p.click('#formModal .btn-light:has-text("Close")'); }],
        ['purchase', async (p) => { await p.click('#panel button:has-text("Purchase")'); await p.waitForTimeout(500); await p.selectOption('#puLines [data-pl] [data-k=product_id]', '1'); await p.fill('#puLines [data-k=qty]', '10'); await p.fill('#puLines [data-k=unit_cost]', '0.5'); }],
        ['purchase-save', async (p) => { await p.click('#formOk'); }],
        ['product-new', async (p) => { await p.click('#panel button:has-text("New item")'); await p.waitForTimeout(300); await p.fill('#prSku', 'TAPE-B'); await p.fill('#prName', 'Brown tape'); await p.click('[data-track="0"]'); }],
        ['product-save', async (p) => { await p.click('#formOk'); }],
        ['count', async (p) => { await p.click('#panel button.btn-sm:text-is("Count") >> nth=0'); await p.fill('#scQty', '180'); }],
        ['count-save', async (p) => { await p.click('#formOk'); }],
        ['inventory', async (p) => { await p.click('[data-tab="inventory"]'); }],
        ['moves', async (p) => { await p.click('[data-isub="moves"]'); }],
        ['requests', async (p) => { await p.click('[data-isub="requests"]'); }],
        ['request-new', async (p) => { await p.click('#panel button:has-text("Request stock")'); await p.waitForTimeout(300); await p.fill('#rqLines input', '25'); }],
        ['request-send', async (p) => { await p.click('#formOk'); }],
        ['internal', async (p) => { await p.click('[data-isub="internal"]'); }],
        ['settle', async (p) => { await p.click('#panel button:has-text("Settle")'); }],
        ['settle-go', async (p) => { await p.click('#formOk'); }],
        ['purchases', async (p) => { await p.click('[data-tab="purchases"]'); }],
        ['pay-supplier', async (p) => { await p.click('#panel button:has-text("Pay") >> nth=0'); }],
        ['pay-supplier-go', async (p) => { await p.click('#formOk'); }],
        ['journal', async (p) => { await p.click('[data-tab="journal"]'); }],
        ['journal-new', async (p) => { await p.click('button:has-text("Manual journal")'); await p.waitForTimeout(300); await p.fill('#jMemo', 'Opening cash'); await p.fill('#jLines [data-jl]:nth-child(1) [data-k=debit]', '100'); }],
        ['journal-diff', async (p) => { await p.selectOption('#jLines [data-jl]:nth-child(2) [data-k=account]', '3000'); await p.fill('#jLines [data-jl]:nth-child(2) [data-k=credit]', '100'); }],
        ['journal-post', async (p) => { await p.click('#formOk'); }],
        ['journal-filter', async (p) => { await p.selectOption('#jAcct', '1100'); }],
        ['chart', async (p) => { await p.click('[data-tab="chart"]'); }],
        ['account-edit', async (p) => { await p.click('[data-acct="5300"]'); }],
        ['account-save', async (p) => { await p.click('#formOk'); }]
    ],
    consolidation: [
        ['scan-held-boxes', async (p) => { await p.fill('#obInput', 'afc-849223'); await p.press('#obInput', 'Enter'); }],
        ['boxes-untick', async (p) => { await p.locator('.ui-modal.open input[type=checkbox]').nth(1).uncheck(); }],
        ['boxes-ok', async (p) => { await p.locator('.ui-modal.open .btn.btn-dark').last().click(); }],
        ['tick-row', async (p) => { await p.check('[data-ob="AFC-849221"]'); }],
        ['filter', async (p) => { await p.fill('#obFilter', 'kochi'); }],
        ['filter-clear', async (p) => { await p.fill('#obFilter', ''); await p.selectOption('#obTo', 'ALFKOC'); await p.fill('#obVehicle', 'Van 3'); await p.fill('#obSeal', 'S-1'); }],
        ['send-ask', async (p) => { await p.click('#obSend'); }],
        ['send-go', async (p) => { await p.click('[data-confirm] [data-v="1"]'); }],
        ['inbound', async (p) => { await p.click('[data-tab="inbound"]'); }],
        ['receive-scan', async (p) => { await p.fill('#ibNote', 'one box wet'); await p.fill('#ibInput', 'AFC-849302'); await p.press('#ibInput', 'Enter'); }],
        ['receive-ok', async (p) => { await p.locator('.ui-modal.open .btn.btn-dark').last().click(); }],
        ['receive-other', async (p) => { await p.fill('#ibInput', 'AFC-111111'); await p.press('#ibInput', 'Enter'); }],
        ['receive-all-ask', async (p) => { await p.click('[data-recv-all]'); }],
        ['receive-all', async (p) => { await p.click('[data-confirm] [data-v="1"]'); }],
        ['mawb', async (p) => { await p.click('[data-tab="mawb"]'); }],
        ['closed', async (p) => { await p.click('[data-cfilter="closed"]'); }],
        ['all', async (p) => { await p.click('[data-cfilter="all"]'); }],
        ['new-container', async (p) => { await p.click('#newCons'); await p.waitForTimeout(300); await p.click('[data-kind="container"]'); await p.fill('#cNo', 'msku7654321'); await p.fill('#cCarrier', 'Maersk'); await p.fill('#cVoy', '12W'); }],
        ['create', async (p) => { await p.click('#consForm button.btn-dark'); }],
        ['add-awb', async (p) => { await p.fill('#dInput', 'AFC-849241'); await p.press('#dInput', 'Enter'); }],
        ['bulk-open', async (p) => { await p.click('#bulkBox summary'); }],
        ['bulk-agent', async (p) => { await p.selectOption('#bStatus', 'ASSIGNED_TO_AGENT'); await p.fill('#bAgent', 'SMSA'); await p.fill('#bDocket', 'D-77'); }],
        ['bulk-one', async (p) => { await p.selectOption('#bTarget', 'AFC-849232'); }],
        ['bulk-ask', async (p) => { await p.click('#bApply'); }],
        ['bulk-go', async (p) => { await p.click('[data-confirm] [data-v="1"]'); }],
        ['cost-form', async (p) => { await p.click('#costAdd'); await p.fill('#kAmt', '45'); await p.fill('#kRef', 'EK-1'); }],
        ['cost-save', async (p) => { await p.click('#costForm button.btn-dark'); }],
        ['remove-ask', async (p) => { await p.click('[data-remove="AFC-849231"]'); }],
        ['remove-go', async (p) => { await p.click('[data-confirm] [data-v="1"]'); }],
        ['close-ask', async (p) => { await p.click('#dClose'); }],
        ['close-go', async (p) => { await p.click('[data-confirm] [data-v="1"]'); }]
    ],
    warehouse: [
        ['pin-mismatch', async (p) => { await p.fill('#gPin', '1234'); await p.fill('#gPin2', '1235'); await p.click('#gBtn'); }],
        ['set-pin', async (p) => { await p.fill('#gPin', '1234'); await p.fill('#gPin2', '1234'); await p.click('#gBtn'); }],
        ['send-form', async (p) => { await p.click('[data-send]'); }],
        ['send-edit-close-asks', async (p) => { await p.fill('#sLines [data-q]', '3'); await p.mouse.click(8, 400); }],
        ['send-go', async (p) => { await p.click('[data-confirm] [data-v="0"]'); await p.waitForTimeout(300); await p.click('#sGo'); }],
        ['stock', async (p) => { await p.click('[data-tab="stock"]'); }],
        ['price-save', async (p) => { await p.fill('[data-item="1"] [data-price]', '0.800'); await p.click('[data-item="1"] [data-save]'); }],
        ['new-item', async (p) => { await p.click('#newItem'); await p.waitForTimeout(300); await p.fill('#iSku', 'TAPE-B'); await p.fill('#iName', 'Brown tape'); await p.fill('#iPrice', '0.4'); await p.click('#itemForm button.btn-coral'); }],
        ['purchases', async (p) => { await p.click('[data-tab="purchases"]'); }],
        ['buy-form', async (p) => { await p.click('#newBuy'); await p.waitForTimeout(300); await p.click('#bAdd'); await p.fill('#bLines [data-bl]:nth-child(1) [data-qty]', '10'); await p.fill('#bLines [data-bl]:nth-child(1) [data-cost]', '0.5'); await p.fill('#bRef', 'MP-9'); }],
        ['buy-save', async (p) => { await p.click('#buyForm button.btn-coral'); }],
        ['change-pin', async (p) => { await p.click('#changePinBtn'); }],
        ['change-cancel', async (p) => { await p.click('#gCancel'); }],
        ['lock', async (p) => { await p.click('#lockBtn'); }]
    ],
    attendance: [
        ['month-back', async (p) => { await p.click('#mPrev'); }],
        ['leave-form', async (p) => { await p.click('#askLeave'); await p.waitForTimeout(300); await p.fill('#lFrom', '2026-11-20'); await p.dispatchEvent('#lFrom', 'change'); await p.fill('#lReason', 'Family visit'); }],
        ['leave-send', async (p) => { await p.click('#leaveForm button.btn-coral'); }],
        ['today', async (p) => { await p.click('[data-tab="today"]'); }],
        ['correct', async (p) => { await p.click('[data-fix="day:0"]'); await p.waitForTimeout(300); await p.fill('#fxReason', 'Phone battery died'); }],
        ['correct-save', async (p) => { await p.click('#fixForm button.btn-coral'); }],
        ['report', async (p) => { await p.click('[data-tab="report"]'); }],
        ['leave-tab', async (p) => { await p.click('[data-tab="leave"]'); }],
        ['approve', async (p) => { const b = p.locator('[data-decide^="approved"]').first(); if (await b.count()) await b.click(); }],
        ['shifts', async (p) => { await p.click('[data-tab="shifts"]'); }],
        ['shift-edit', async (p) => { await p.click('[data-shift="0"]'); await p.waitForTimeout(300); await p.click('#shOff [data-dow="6"]'); }],
        ['shift-save', async (p) => { await p.click('#shiftForm button.btn-coral'); }],
        ['back-to-me-break', async (p) => { await p.click('[data-tab="me"]'); await p.waitForTimeout(800); const b = p.locator('#breakBtn'); if (await b.count()) await b.click(); }]
    ],
    'super-dashboard': [
        ['scrolled-middle', async (p) => { await p.evaluate(() => { document.querySelector('.dash-scroll').scrollTop = 600; }); }],
        ['scrolled-bottom', async (p) => { await p.evaluate(() => { const s = document.querySelector('.dash-scroll'); s.scrollTop = s.scrollHeight; }); }],
        ['customize', async (p) => { await p.evaluate(() => { document.querySelector('.dash-scroll').scrollTop = 0; }); await p.click('#editLayoutBtn'); }],
        ['resize-pill', async (p) => { await p.click('[data-widget-id="global-shipments"] button:has-text("2×3")'); }],
        ['catalog', async (p) => { await p.click('#editLayoutBtn'); await p.click('button[title="Add or remove widgets"]'); }],
        ['catalog-remove', async (p) => { await p.click('#widget-catalog-list > div:nth-child(2) button'); }],
        ['search-bookings', async (p) => { await p.click('#widget-modal button:has-text("Done")'); await p.evaluate(() => { const s = document.querySelector('.dash-scroll'); s.scrollTop = s.scrollHeight; }); await p.type('input[placeholder^="Search AWB, consignee"]', 'afc'); }]
    ],
    activity: [
        ['row-detail', async (p) => { await p.click('#rows tr[data-i="0"]'); }],
        ['failed-filter', async (p) => { await p.keyboard.press('Escape'); await p.waitForTimeout(400); await p.check('#fFailed'); }]
    ],
    customers: [
        ['profile', async (p) => { await p.click('#rows tr[data-c]'); }],
        ['edit-then-close-asks', async (p) => { await p.fill('#fNotes', ''); await p.type('#fNotes', 'Calls after 5 pm'); await p.mouse.click(8, 400); }],
        ['keep-editing', async (p) => { await p.click('[data-confirm] [data-v="0"]'); }],
        ['merge-search', async (p) => { await p.click('#mergeBtn'); await p.waitForTimeout(200); await p.type('#mSearch', 'al'); await p.waitForTimeout(700); }],
        ['save', async (p) => { await p.keyboard.press('Escape'); await p.waitForTimeout(400); await p.fill('#fTags', 'VIP, corporate'); await p.click('#pForm button:has-text("Save details")'); await p.waitForTimeout(800); }]
    ],
    crm: [
        ['pick-customer', async (p) => { await p.click('#list .cust'); }],
        ['booked-template', async (p) => { await p.click('[data-tpl="booked"]'); await p.type('#awb', 'AFC-849208'); }],
        ['search', async (p) => { await p.type('#q', 'zz-nobody'); await p.waitForTimeout(700); }]
    ],
    'status-update': [
        ['scan-awb', async (p) => { await p.fill('#scanInput', 'AFC-849208'); await p.press('#scanInput', 'Enter'); await p.waitForTimeout(800); }],
        ['boxes-ok', async (p) => { if (await p.locator('.ui-modal.open [aria-labelledby="pbTitle"], .ui-modal.open #pbTitle').count()) await p.click('.ui-modal.open .btn-dark'); }],
        ['milestone-with-agent', async (p) => {
            const v = await p.$eval('#statusSelect', (s) => [...s.options].find(o => /assign/i.test(o.text))?.value || [...s.options].find(o => o.value)?.value);
            await p.selectOption('#statusSelect', v);
        }],
        ['bad-awb', async (p) => { await p.fill('#scanInput', 'NOPE-0000'); await p.press('#scanInput', 'Enter'); await p.waitForTimeout(800); }],
        ['submit', async (p) => {
            if (await p.locator('.ui-modal.open .btn-dark').count()) await p.click('.ui-modal.open .btn-dark');
            for (const el of await p.$$('[data-extra]')) await el.fill((await el.getAttribute('data-extra')) === 'fwd_docket' ? '290012345' : 'SMSA');
            await p.fill('#remark', 'Handed at counter');
            await p.click('#updateBtn'); await p.waitForTimeout(300); await p.click('[data-confirm] [data-v="1"]'); await p.waitForTimeout(800);
        }]
    ],
    integrations: [
        ['edit-form', async (p) => { await p.click('#list button:has-text("Edit")'); }],
        ['add-form', async (p) => { await p.click('#formModal button:has-text("Cancel")'); await p.waitForTimeout(300); await p.click('#addBtn'); }],
        ['save-new', async (p) => { await p.fill('#fName', 'Test Carrier'); await p.fill('#fUrl', 'https://api.example.com'); await p.check('#fActive'); await p.click('#saveBtn'); await p.waitForTimeout(800); }]
    ]
};

// ALF_BROWSER=chrome uses Chrome when Edge will not start headless (e.g. an Edge update waiting for a restart)
const exe = [...(process.env.ALF_BROWSER === 'chrome' ? [] : ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe']), 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p => fs.existsSync(p));
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ executablePath: exe, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1366, height: 800 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
await ctx.addInitScript(() => {
    localStorage.setItem('cargo_auth_token', 'h.eyJzdWIiOiJ1MSJ9.s');
    localStorage.setItem('cargo_user_role', 'super_admin');
    localStorage.setItem('cargo_user_name', 'Test User');
    // print windows: keep them, but skip the print dialog (it stalls headless screenshots)
    const open = window.open.bind(window);
    window.open = (...a) => { const w = open(...a); if (w) try { w.print = () => {}; } catch { } return w; };
});
let fails = 0;
for (const [name, steps] of Object.entries(FLOWS)) {
    if (only && name !== only) continue;
    const pg = PAGES.find(x => x.name === name);
    const url = base + (target === 'old' ? pg.old : pg.new);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const writes = [];   // what the page sends to the server (compared old vs new)
    page.on('request', r => { const u = new URL(r.url()); if (u.pathname.startsWith('/api/') && r.method() !== 'GET') { let body; try { body = r.postDataJSON(); } catch { body = r.postData(); } writes.push({ method: r.method(), path: u.pathname + u.search, body }); } });
    await page.clock.setFixedTime(new Date('2026-11-17T07:30:00Z'));
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    await page.evaluate(() => { document.getElementById('checkinPop')?.querySelector('[data-snooze]')?.click(); });
    for (const [step, act] of steps) {
        try {
            await act(page);
            await page.waitForTimeout(900);
            // a print window opened by the step takes focus and the page stops painting: close it, come back
            for (const other of ctx.pages()) if (other !== page) await other.close().catch(() => {});
            await page.bringToFront();
            await page.screenshot({ path: path.join(outDir, `${name}.${step}.png`), animations: 'disabled', caret: 'hide' });
            console.log(`${name} · ${step}: ok`);
        } catch (e) { fails++; console.log(`${name} · ${step}: FAILED ${e.message.split('\n')[0]}`); }
    }
    if (errors.length) { fails++; console.log(`${name}: page errors: ${errors.join(' / ')}`); }
    fs.writeFileSync(path.join(outDir, `${name}.requests.json`), JSON.stringify(writes, null, 2));
    await page.close();
}
await browser.close();
process.exit(fails ? 1 : 0);
