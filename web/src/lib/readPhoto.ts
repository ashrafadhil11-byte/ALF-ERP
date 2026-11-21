// Reads the text of a photo / screenshot in the browser (tesseract.js — free, no AI key; it downloads its own reader
// files the first time). Used to share a photographed list with Farah. Loaded only when someone reads a photo.
// Tables need help: small text is enlarged, the picture is made black-and-white, and the table's grid lines are erased
// (they make the reader stop after the first row).

type Opts = { psm?: string; scale?: number; lines?: boolean };

/** a cleaned copy of the picture, ready for reading */
export async function prepare(file: Blob, { scale, lines = true }: Opts = {}): Promise<HTMLCanvasElement> {
    const img = await createImageBitmap(file);
    const k = scale ?? Math.min(3, Math.max(1, 2400 / Math.max(img.width, 1)));          // small screenshots → ~2400 px wide
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    const g = c.getContext('2d', { willReadFrequently: true })!;
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    g.drawImage(img, 0, 0, c.width, c.height);
    const d = g.getImageData(0, 0, c.width, c.height), p = d.data, W = c.width, H = c.height;
    // black-and-white
    const dark = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) { const y = 0.299 * p[i * 4] + 0.587 * p[i * 4 + 1] + 0.114 * p[i * 4 + 2]; dark[i] = y < 150 ? 1 : 0; }
    if (lines) {
        // grid lines: long dark runs across a row or down a column
        const run = (len: number, get: (j: number) => number) => { let best = 0, cur = 0; for (let j = 0; j < len; j++) { cur = get(j) ? cur + 1 : 0; if (cur > best) best = cur; } return best; };
        const rowsOut: number[] = [], colsOut: number[] = [];
        for (let y = 0; y < H; y++) if (run(W, x => dark[y * W + x]) > W * 0.35) rowsOut.push(y);
        for (let x = 0; x < W; x++) if (run(H, y => dark[y * W + x]) > H * 0.6) colsOut.push(x);
        for (const y of rowsOut) dark.fill(0, y * W, y * W + W);
        for (const x of colsOut) for (let y = 0; y < H; y++) dark[y * W + x] = 0;
    }
    for (let i = 0; i < W * H; i++) { const v = dark[i] ? 0 : 255; p[i * 4] = p[i * 4 + 1] = p[i * 4 + 2] = v; p[i * 4 + 3] = 255; }
    g.putImageData(d, 0, 0);
    return c;
}

export async function readPhoto(file: Blob, onProgress?: (pct: number) => void, opts: Opts = {}): Promise<string> {
    const { createWorker } = await import('tesseract.js');
    const worker = await createWorker('eng', 1, {
        logger: (m: { status: string; progress: number }) => { if (m.status === 'recognizing text') onProgress?.(Math.round(m.progress * 100)); }
    });
    try {
        // a table: keep the spaces between columns; mode 4 = one line per table row (tested on a Delhivery list:
        // with the grid lines erased all rows are read; with the lines in, only the first)
        await worker.setParameters({ preserve_interword_spaces: '1', tessedit_pageseg_mode: (opts.psm || '4') as never });
        const { data } = await worker.recognize(await prepare(file, opts));
        return data.text || '';
    } finally {
        await worker.terminate();
    }
}
