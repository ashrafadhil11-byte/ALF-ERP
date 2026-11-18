// Money and date formats used across the ERP pages (same as the old pages).
const THREE = ['OMR', 'BHD', 'KWD'];   // currencies with 3 decimals

export const money = (cur: string, v: unknown) => {
    const d = THREE.includes(cur) ? 3 : 2;
    return `${cur} ${(+(v as number) || 0).toLocaleString('en', { minimumFractionDigits: d, maximumFractionDigits: d })}`;
};
export const day = (v?: string | null) => v ? new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
