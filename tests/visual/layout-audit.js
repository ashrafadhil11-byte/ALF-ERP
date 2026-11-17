// Runs inside a page. Reports anything wider than the screen, sticking out of the main card, or spilling out of a popup.
// Returns ['OK'] when clean. Used by capture.mjs for both the old pages and the React pages.
async () => {
    const out = [];
    const W = innerWidth;
    const label = (el) => el.id ? '#' + el.id : el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.split(/\s+/).slice(0, 3).join('.') : '');
    const scrollX = (el) => { for (let p = el.parentElement; p; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden') return p; } return null; };
    if (document.documentElement.scrollWidth > W + 1) out.push(`PAGE wider than screen (${document.documentElement.scrollWidth} > ${W})`);
    const main = document.querySelector('main');
    if (main) {
        const mr = main.getBoundingClientRect();
        const bad = [...main.querySelectorAll('*')].filter(el => {
            const r = el.getBoundingClientRect();
            if (!r.width || !r.height || getComputedStyle(el).position === 'fixed') return false;
            const box = scrollX(el); const lim = box && box !== main ? box.getBoundingClientRect().right : mr.right;
            return r.right > lim + 2 && !(box && box !== main && ['auto', 'scroll'].includes(getComputedStyle(box).overflowX));
        });
        bad.filter(el => !bad.includes(el.parentElement)).slice(0, 6)
            .forEach(el => out.push(`STICKS OUT ${Math.round(el.getBoundingClientRect().right - mr.right)}px: ${label(el)} "${(el.innerText || '').trim().slice(0, 40)}"`));
    }
    for (const m of document.querySelectorAll('.ui-modal[id]')) {
        m.classList.add('open'); await new Promise(r => setTimeout(r, 450));
        const p = m.querySelector(':scope > .panel'); if (!p) { m.classList.remove('open'); continue; }
        const pr = p.getBoundingClientRect();
        if (pr.height > innerHeight + 1) out.push(`POPUP #${m.id} taller than screen`);
        const spill = [...p.querySelectorAll('*')].filter(el => {
            const r = el.getBoundingClientRect(); if (!r.width || !r.height) return false;
            let clip = null; for (let q = el.parentElement; q && q !== p.parentElement; q = q.parentElement) { const s = getComputedStyle(q); if (/(auto|scroll|hidden)/.test(s.overflowY + s.overflowX)) { clip = q; break; } }
            return (clip === p || !clip) && (r.bottom > pr.bottom + 2 || r.right > pr.right + 2);
        });
        const tops = spill.filter(el => !spill.includes(el.parentElement));
        if (tops.length) out.push(`POPUP #${m.id} spills: ${tops.slice(0, 3).map(label).join(', ')}`);
        m.classList.remove('open');
    }
    return out.length ? out : ['OK'];
}
