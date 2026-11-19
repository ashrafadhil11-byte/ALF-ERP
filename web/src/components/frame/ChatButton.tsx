// Chat button in the top bar: opens Messages; the badge counts unread messages (checked every 20 s).
// While you are on another page, the tab title shows the unread count too.
import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { PageLink } from '../PageLink';
import { Icon } from '../Icon';

export function ChatButton() {
    const q = useQuery({ queryKey: ['chat-unread'], queryFn: () => api<{ unread: number }>('/api/chat?view=unread'), refetchInterval: 20_000, staleTime: 0, retry: false });
    const unread = q.data?.unread || 0;
    useEffect(() => {
        // the tab title shows unread messages while you are elsewhere
        const base = document.title.replace(/^\(\d+\+?\) /, '');
        document.title = unread && !location.pathname.endsWith('/messages') ? `(${unread > 99 ? '99+' : unread}) ${base}` : base;
    }, [unread]);
    return (
        <PageLink page="messages.html" id="chatBtn" title="Messages" aria-label={unread ? `Messages, ${unread} unread` : 'Messages'}
            className="relative w-11 h-11 bg-[#F8F8FA] rounded-full border border-gray-200/70 flex items-center justify-center text-gray-700 hover:bg-[#111827] hover:text-white hover:border-[#111827] transition-all shadow-sm flex-shrink-0">
            <Icon name="message" cls="w-[18px] h-[18px]" />
            <span id="chatBadge" className={`${unread ? 'notif-pop' : 'hidden'} absolute -top-1 -right-1 min-w-[20px] h-5 px-1.5 rounded-full bg-[#E86D58] text-white text-[10px] font-extrabold flex items-center justify-center ring-2 ring-white`}>
                {unread > 99 ? '99+' : unread}</span>
        </PageLink>
    );
}
