import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './lib/query';
import { router } from './App';
import './index.css';
import '../../admin/components/ui.css'; // the one shared stylesheet, used by old and new pages alike
import '../../admin/components/countries.js'; // window.ALF_COUNTRIES (same data file as the old pages)
import '../../admin/components/oman-places.js'; // window.ALF_OMAN, ALF_OMAN_SEARCH

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <QueryClientProvider client={queryClient}>
            <RouterProvider router={router} />
        </QueryClientProvider>
    </StrictMode>
);
