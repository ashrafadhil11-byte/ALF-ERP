import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
// Stylesheets first: Tailwind, then the shared ui.css, then each page's own CSS (imported by the pages below),
// the same order as the old pages (app.css → ui.css → the page's <style>).
import './index.css';
import '../../admin/components/ui.css'; // the one shared stylesheet, used by old and new pages alike
import { queryClient } from './lib/query';
import { router } from './App';
import { installWheelGuard } from './lib/wheelGuard';
import '../../admin/components/countries.js'; // window.ALF_COUNTRIES (same data file as the old pages)
import '../../admin/components/oman-places.js'; // window.ALF_OMAN, ALF_OMAN_SEARCH

installWheelGuard();   // the mouse wheel never changes a number box (lib/wheelGuard.ts)

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <QueryClientProvider client={queryClient}>
            <RouterProvider router={router} />
        </QueryClientProvider>
    </StrictMode>
);
