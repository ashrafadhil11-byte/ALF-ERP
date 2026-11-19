// Shipping label (100×150 mm, Code 128) and customer receipt — the same admin/components/print.js the old pages use,
// so prints come out identical. Usage: printDoc('label', booking, branch) / printDoc('receipt', booking, branch)
import '../../../admin/components/print.js';

declare global {
    interface Window { ALF_PRINT: { label: (b: any, br: any) => void; receipt: (b: any, br: any) => void } }
}
export const printDoc = (kind: 'label' | 'receipt', booking: any, branch: any) => window.ALF_PRINT[kind](booking, branch);
