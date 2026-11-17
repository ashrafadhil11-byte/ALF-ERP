// Phase 1 review page (/app/parts): the shared fields and popups the converted pages will use, to try them out.
import { useRef, useState } from 'react';
import { AppFrame } from '../components/frame/AppFrame';
import { Modal, useDismiss } from '../components/Modal';
import { openMenu } from '../components/RowMenu';
import { Icon } from '../components/Icon';
import { PhoneField, type PhoneHandle } from '../components/fields/PhoneField';
import { CityField, CountryField } from '../components/fields/PlaceFields';
import { ScanInput } from '../components/fields/Scan';
import { confirm } from '../lib/dialogs';
import { toast } from '../lib/toast';
import { whatsapp } from '../lib/whatsapp';

function FormBody({ onSaved }: { onSaved: () => void }) {
    const dismiss = useDismiss();
    const [country, setCountry] = useState('Oman');
    const phone = useRef<PhoneHandle>(null);
    return (
        <>
            <div>
                <h3 id="demoTitle" className="text-lg font-extrabold text-gray-900">New agent (demo)</h3>
                <p className="text-xs text-gray-500 mt-1">Type something, then click outside or press Esc — it asks before closing.</p>
            </div>
            <div className="grid sm:grid-cols-2 gap-3 mt-5">
                <div className="sm:col-span-2"><label className="ui-label" htmlFor="dName">Name</label><input id="dName" className="field" placeholder="Agent name" /></div>
                <div className="sm:col-span-2"><label className="ui-label" htmlFor="dPhone">Phone</label><PhoneField ref={phone} country="OM" inputProps={{ id: 'dPhone', className: 'field', placeholder: 'Mobile number' }} /></div>
                <div><label className="ui-label" htmlFor="dCountry">Country</label><CountryField defaultValue="Oman" onChange={(n) => setCountry(n)} inputProps={{ id: 'dCountry', className: 'field', placeholder: 'Country' }} /></div>
                <div><label className="ui-label" htmlFor="dCity">City</label><CityField country={country} inputProps={{ id: 'dCity', className: 'field', placeholder: 'City' }} /></div>
                <div className="sm:col-span-2"><label className="ui-label" htmlFor="dDocket">Agent docket</label><ScanInput mode="fill" inputProps={{ id: 'dDocket', className: 'field font-mono', placeholder: 'Scan or type', 'aria-label': 'agent docket' }} /></div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
                <button type="button" className="btn btn-light" onClick={dismiss}>Cancel</button>
                <button type="button" className="btn btn-dark" onClick={() => { toast(true, `Saved (demo) · phone ${phone.current?.value || '—'}`); onSaved(); }}>Save</button>
            </div>
        </>
    );
}

export function SharedParts() {
    const [open, setOpen] = useState(false);
    return (
        <AppFrame after={
            <Modal id="demoModal" open={open} onClose={() => setOpen(false)} panelClassName="max-w-xl" labelledBy="demoTitle">
                <FormBody onSaved={() => setOpen(false)} />
            </Modal>
        }>
            <section className="flex flex-wrap items-center gap-3 pb-5 mb-5 border-b border-gray-100">
                <p className="sd-label w-full">React frame · Phase 1 · shared parts</p>
                <button type="button" className="btn btn-dark" onClick={() => setOpen(true)}>Open a form popup</button>
                <button type="button" className="btn btn-light" onClick={async () => toast(await confirm({ title: 'Delete this?', message: 'This is only a demo.', confirmText: 'Delete', danger: true }), 'You answered the question.')}>Confirm question</button>
                <button type="button" className="btn btn-light" onClick={() => toast(true, 'Saved.')}>Success message</button>
                <button type="button" className="btn btn-light" onClick={() => toast(false, 'Something went wrong (demo).')}>Error message</button>
                <button type="button" className="icon-btn" aria-label="Row menu" onClick={(e) => openMenu(e.currentTarget, <>
                    <button type="button"><Icon name="edit" />Edit</button><button type="button"><Icon name="copy" />Copy</button><hr /><button type="button" className="danger"><Icon name="trash" />Delete</button>
                </>)}><Icon name="more" /></button>
                <button type="button" className="btn btn-light" onClick={() => whatsapp()}>Open WhatsApp window</button>
            </section>
            <p className="text-sm text-gray-500">Pages are converted from Phase 2 on; until then every menu item opens the current page.</p>
        </AppFrame>
    );
}
