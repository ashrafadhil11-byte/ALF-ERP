import { ICONS, type IconName } from '../lib/icons';

/** Same SVG as UI.icon(name, cls) in the old pages. */
export function Icon({ name, cls = 'w-4 h-4' }: { name: IconName; cls?: string }) {
    return (
        <svg className={`${cls} flex-shrink-0`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
            strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" dangerouslySetInnerHTML={{ __html: ICONS[name] }} />
    );
}

/** Raw SVG path markup in the same stroke style (for icons that live outside the shared table). */
export function Svg({ d, cls, sw = 2 }: { d: string; cls: string; sw?: number }) {
    return (
        <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw}
            strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" dangerouslySetInnerHTML={{ __html: d }} />
    );
}
