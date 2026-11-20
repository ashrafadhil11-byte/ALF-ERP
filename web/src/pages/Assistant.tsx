// The AI assistant is now Farah, a chat in Messages (pinned first). This old address opens her chat.
import { useEffect } from 'react';

export function Assistant() {
    useEffect(() => { location.replace('/app/messages?farah=1'); }, []);
    return null;
}
