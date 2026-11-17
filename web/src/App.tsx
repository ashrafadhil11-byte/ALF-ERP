import { Navigate, Route, Routes } from 'react-router-dom';
import { RequireAuth } from './components/RequireAuth';
import { Placeholder } from './pages/Placeholder';

// Routes are added page by page (see docs/REACT_MIGRATION.md). Unknown paths fall back to the start page.
export function App() {
    return (
        <RequireAuth>
            <Routes>
                <Route path="/" element={<Placeholder />} />
                <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
        </RequireAuth>
    );
}
