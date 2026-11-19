import { useEffect } from 'react';
import { createBrowserRouter, Navigate, Outlet, useBlocker } from 'react-router-dom';
import { RequireAuth } from './components/RequireAuth';
import { RowMenuHost } from './components/RowMenu';
import { DialogHost } from './lib/dialogs';
import { Toaster } from './lib/toast';
import { anyDirty, confirmDiscard, installGuard, markClean, DIRTY_SELECTOR } from './lib/guard';
import { FramePreview } from './pages/FramePreview';

/** Moving to another React page with an unsaved popup or form open asks first (like leaving an old page did). */
function NavigationGuard() {
    const blocker = useBlocker(({ currentLocation, nextLocation }) => currentLocation.pathname !== nextLocation.pathname && anyDirty());
    useEffect(() => {
        if (blocker.state !== 'blocked') return;
        confirmDiscard().then(ok => {
            if (ok) { document.querySelectorAll(DIRTY_SELECTOR).forEach(markClean); blocker.proceed(); }
            else blocker.reset();
        });
    }, [blocker]);
    return null;
}

function Shell() {
    useEffect(installGuard, []);
    return (
        <RequireAuth>
            <Outlet />
            <NavigationGuard />
            <DialogHost />
            <RowMenuHost />
            <Toaster />
        </RequireAuth>
    );
}

// Pages are added here as they are converted (see docs/REACT_MIGRATION.md and lib/pages.ts).
export const router = createBrowserRouter([
    // public pages: no sign-in, no frame
    { path: '/login', lazy: () => import('./pages/Login').then(m => ({ Component: m.Login })) },
    { path: '/track', lazy: () => import('./pages/Track').then(m => ({ Component: m.Track })) },
    {
        element: <Shell />,
        children: [
            { path: '/', element: <FramePreview /> },
            // each page is downloaded the first time it is opened (the router waits for it, so the current page stays until then)
            { path: '/activity', lazy: () => import('./pages/Activity').then(m => ({ Component: m.Activity })) },
            { path: '/crm', lazy: () => import('./pages/Crm').then(m => ({ Component: m.Crm })) },
            { path: '/status-update', lazy: () => import('./pages/StatusUpdate').then(m => ({ Component: m.StatusUpdate })) },
            { path: '/customers', lazy: () => import('./pages/Customers').then(m => ({ Component: m.Customers })) },
            { path: '/integrations', lazy: () => import('./pages/Integrations').then(m => ({ Component: m.Integrations })) },
            { path: '/super-dashboard', lazy: () => import('./pages/dashboard/Dashboard').then(m => ({ Component: m.Dashboard })) },
            { path: '/attendance', lazy: () => import('./pages/Attendance').then(m => ({ Component: m.Attendance })) },
            { path: '/warehouse', lazy: () => import('./pages/Warehouse').then(m => ({ Component: m.Warehouse })) },
            { path: '/create-user', lazy: () => import('./pages/Users').then(m => ({ Component: m.Users })) },
            { path: '/branches', lazy: () => import('./pages/Branches').then(m => ({ Component: m.Branches })) },
            { path: '/booking', lazy: () => import('./pages/Booking').then(m => ({ Component: m.Booking })) },
            { path: '/consolidation', lazy: () => import('./pages/Consolidation').then(m => ({ Component: m.Consolidation })) },
            { path: '/shipments', lazy: () => import('./pages/Shipments').then(m => ({ Component: m.Shipments })) },
            { path: '/reports', lazy: () => import('./pages/Reports').then(m => ({ Component: m.Reports })) },
            { path: '/accounts', lazy: () => import('./pages/Accounts').then(m => ({ Component: m.Accounts })) },
            { path: '/delivery', lazy: () => import('./pages/Delivery').then(m => ({ Component: m.Delivery })) },
            { path: '*', element: <Navigate to="/" replace /> }
        ]
    }
], { basename: '/app' });
