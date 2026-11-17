import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './lib/query';
import { App } from './App';
import './index.css';
import '../../admin/components/ui.css'; // the one shared stylesheet, used by old and new pages alike

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <QueryClientProvider client={queryClient}>
            <BrowserRouter basename="/app">
                <App />
            </BrowserRouter>
        </QueryClientProvider>
    </StrictMode>
);
