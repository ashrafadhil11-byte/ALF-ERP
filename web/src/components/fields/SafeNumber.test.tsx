import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SafeNumber } from './SafeNumber';
import { DialogHost } from '../../lib/dialogs';

afterEach(cleanup);

describe('SafeNumber', () => {
    it('shows the value as text; it changes only after Edit and ✓ / Enter; Esc cancels', async () => {
        const save = vi.fn().mockResolvedValue(undefined);
        render(<SafeNumber value={1.5} label="Price" format={(v) => v.toFixed(3)} onSave={save} />);
        expect(screen.queryByRole('spinbutton')).toBeNull();               // no open box to scroll over
        fireEvent.click(screen.getByRole('button', { name: /Price: 1.500/ }));
        const box = screen.getByRole('spinbutton');
        fireEvent.change(box, { target: { value: '2' } });
        fireEvent.keyDown(box, { key: 'Escape' });
        expect(save).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: /Price/ }));
        fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '2' } });
        await act(async () => { fireEvent.keyDown(screen.getByRole('spinbutton'), { key: 'Enter' }); });
        expect(save).toHaveBeenCalledWith('2');
    });
    it('a big jump asks first', async () => {
        const save = vi.fn().mockResolvedValue(undefined);
        render(<><DialogHost /><SafeNumber value={1.5} label="Price" onSave={save} /></>);
        fireEvent.click(screen.getByRole('button', { name: /Price/ }));
        fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '150' } });
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })); });
        expect(save).not.toHaveBeenCalled();
        expect(screen.getByText(/Big change/)).toBeTruthy();
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Yes, save' })); });
        expect(save).toHaveBeenCalledWith('150');
    });
});
