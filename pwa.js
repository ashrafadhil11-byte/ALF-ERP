// File: pwa.js — registers the service worker and offers "Install app".
(function () {
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
    }

    const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    if (standalone) document.documentElement.classList.add('is-pwa');
    if (standalone) return;

    let dismissed = false;
    try { dismissed = localStorage.getItem('alf_install_dismissed') === '1'; } catch (e) {}
    if (dismissed) return;

    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
    let deferred = null;

    function show(content) {
        if (document.getElementById('pwa-install')) return;
        const box = document.createElement('div');
        box.id = 'pwa-install';
        box.setAttribute('role', 'dialog');
        box.setAttribute('aria-label', 'Install the app');
        box.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);z-index:80;width:min(420px,calc(100% - 24px));' +
            'bottom:calc(env(safe-area-inset-bottom,0px) + 88px);background:#111827;color:#fff;border-radius:22px;padding:12px 12px 12px 14px;' +
            'display:flex;align-items:center;gap:12px;box-shadow:0 20px 50px -12px rgba(0,0,0,.45);font-family:"Plus Jakarta Sans",system-ui,sans-serif';
        if (window.innerWidth >= 1024) box.style.bottom = '24px';
        box.innerHTML = `
            <img src="/icons/icon-192.png" alt="" width="40" height="40" style="border-radius:12px;flex-shrink:0">
            <div style="flex:1;min-width:0">
                <p style="margin:0;font-size:13px;font-weight:800">Install Al-Farha ERP</p>
                <p style="margin:2px 0 0;font-size:11px;color:#9CA3AF;line-height:1.35">${content}</p>
            </div>
            ${deferred ? '<button type="button" data-act="install" style="background:#E86D58;color:#fff;border:0;border-radius:9999px;padding:9px 16px;font-weight:800;font-size:12px;cursor:pointer;flex-shrink:0">Install</button>' : ''}
            <button type="button" data-act="close" aria-label="Not now" style="background:transparent;color:#9CA3AF;border:0;width:30px;height:30px;border-radius:9999px;cursor:pointer;flex-shrink:0;font-size:18px;line-height:1">&times;</button>`;
        box.addEventListener('click', async (e) => {
            const act = e.target.closest('[data-act]')?.dataset.act;
            if (act === 'install' && deferred) {
                deferred.prompt();
                await deferred.userChoice.catch(() => {});
                deferred = null;
                box.remove();
            } else if (act === 'close') {
                try { localStorage.setItem('alf_install_dismissed', '1'); } catch (err) {}
                box.remove();
            }
        });
        document.body.appendChild(box);
    }

    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferred = e;
        setTimeout(() => show('Open it like an app from your home screen or desktop.'), 1500);
    });
    window.addEventListener('appinstalled', () => document.getElementById('pwa-install')?.remove());

    // iPhone / iPad Safari has no install prompt: show the manual steps once.
    if (isIOS && /safari/i.test(navigator.userAgent) && !/crios|fxios/i.test(navigator.userAgent)) {
        window.addEventListener('load', () => setTimeout(() => show('Tap the Share button, then <b>Add to Home Screen</b>.'), 2500));
    }

    // Lets any page offer an "Install app" button: window.ALF_PWA.canInstall() / install()
    window.ALF_PWA = {
        canInstall: () => Boolean(deferred),
        install: () => deferred && deferred.prompt()
    };
})();
