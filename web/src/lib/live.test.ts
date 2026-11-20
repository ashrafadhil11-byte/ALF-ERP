import { describe, expect, it, vi } from 'vitest';
import { changed, onChange, quiet } from './live';

describe('live data', () => {
    it('chat, "seen" and Farah replies do not reload other screens; real saves do', () => {
        expect(quiet('/api/chat', { action: 'send' })).toBe(true);
        expect(quiet('/api/notifications', { action: 'seen' })).toBe(true);
        expect(quiet('/api/assistant', { action: 'reply' })).toBe(true);
        expect(quiet('/api/assistant', { action: 'run' })).toBe(false);      // Farah's Confirm changes data
        expect(quiet('/api/status', { awbs: ['1'] })).toBe(false);
        expect(quiet('/api/todos', { action: 'done' })).toBe(false);
    });
    it('tells every listener about a save', () => {
        const fn = vi.fn();
        const off = onChange(fn);
        changed('/api/status');
        expect(fn).toHaveBeenCalledWith({ path: '/api/status', elsewhere: false });
        off(); changed('/api/status');
        expect(fn).toHaveBeenCalledTimes(1);
    });
});
