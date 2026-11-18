import { useEffect } from 'react';
import { createBrowserRouter, Navigate, Outlet, useBlocker } from 'react-router-dom';
import { RequireAuth } from './components/RequireAuth';
import { RowMenuHost } from './components/RowMenu';
import { DialogHost } from './lib/dialogs';
import { Toaster } from './lib/toast';
import { anyDirty, confirmDiscard, installGuard, markClean, DIRTY_SELECTOR } from './lib/guard';
import { FramePreview } from './pages/FramePreview';
import { Activity } from './pages/Activity';
import { Crm } from './pages/Crm';
import { StatusUpdate } from './pages/StatusUpdate';
import { Customers } from './pages/Customers';
import { Integrations } from './pages/Integrations';

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
    {
        element: <Shell />,
        children: [
            { path: '/', element: <FramePreview /> },
            { path: '/activity', element: <Activity /> },
            { path: '/crm', element: <Crm /> },
            { path: '/status-update', element: <StatusUpdate /> },
            { path: '/customers', element: <Customers /> },
            { path: '/integrations', element: <Integrations /> },
            { path: '*', element: <Navigate to="/" replace /> }
        ]
    }
], { basename: '/app' });
