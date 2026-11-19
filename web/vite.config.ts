import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The React app is served at /app/ next to the old pages while the migration runs.
// In development, everything that is not the React app (API, old pages, icons, fonts) goes to the mock server.
const MOCK = 'http://localhost:5178';
export default defineConfig({
    base: '/app/',
    plugins: [react()],
    server: {
        port: 5173,
        strictPort: true,
        proxy: {
            ...Object.fromEntries(['/api', '/admin', '/assets', '/icons', '/login.html', '/track.html', '/manifest.webmanifest', '/pwa.js', '/sw.js'].map(p => [p, MOCK])),
            // index.html's <script src="/pwa.js">: the dev server serves it under /app/ (the build keeps /pwa.js)
            '/app/pwa.js': { target: MOCK, rewrite: () => '/pwa.js' }
        }
    },
    // Built into /app at the repo root, which Vercel serves next to the old pages (vercel.json buildCommand).
    build: { outDir: '../app', emptyOutDir: true, sourcemap: true },
    test: { environment: 'jsdom', setupFiles: ['./src/test-setup.ts'] }
} as any);
