// Phase 1 preview: the React frame with an empty page, so it can be checked against the old pages.
// /app/?as=activity.html shows the frame as it looks on that page (same sidebar item highlighted).
import { useSearchParams } from 'react-router-dom';
import { AppFrame } from '../components/frame/AppFrame';
import { pageByFile, type PageFile } from '../lib/pages';

export function FramePreview() {
    const [params] = useSearchParams();
    const as = params.get('as');
    const page = as && pageByFile(as) ? (as as PageFile) : undefined;
    // /app/ on its own is not a page yet: go to the dashboard (still the old page) instead of an empty frame
    if (!page) { location.replace('/admin/super-dashboard.html'); return null; }
    // these two pages use a slightly roomier main panel (p-6); the pages themselves will pass it when converted
    const roomy = page === 'super-dashboard.html' || page === 'integrations.html';
    return (
        <AppFrame page={page} mainClassName={roomy ? 'flex-1 bg-white rounded-[2.5rem] shadow-[0_20px_60px_-15px_rgba(0,0,0,0.05)] p-6 lg:p-8 flex flex-col relative z-10 overflow-hidden border border-white' : undefined}>
            <section data-preview className="flex-1 flex items-center justify-center text-center">
                <div>
                    <p className="sd-label">React frame · Phase 1</p>
                    <p className="text-sm text-gray-500 mt-2">Sidebar, top bar, check-in, notifications and profile are React now. Pages follow in Phase 2.</p>
                </div>
            </section>
        </AppFrame>
    );
}
