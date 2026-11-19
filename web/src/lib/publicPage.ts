// Public pages (login, tracking) have their own <body> look and tab title, unlike the signed-in frame.
// While one is open it takes over <body>; leaving it puts the frame's body back.
import { useLayoutEffect } from 'react';

export function usePublicPage(page: string, bodyClass: string, title: string, opts: { noManifest?: boolean } = {}) {
    useLayoutEffect(() => {
        const body = document.body, before = { cls: body.className, title: document.title };
        body.className = bodyClass;
        body.dataset.page = page;
        document.title = title;
        // the tracking page is for customers: it never offered "install the app"
        const manifest = opts.noManifest ? document.querySelector('link[rel="manifest"]') : null;
        const parent = manifest?.parentNode, next = manifest?.nextSibling;
        manifest?.remove();
        return () => {
            body.className = before.cls;
            delete body.dataset.page;
            document.title = before.title;
            if (manifest && parent) parent.insertBefore(manifest, next || null);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
}
