// Country and city pickers — the old <input data-country> and <input data-city-of="…"> (UI.autoFields).
//   <CountryField id="sCountry" defaultValue="Oman" onChange={(name, cc) => setCountry(name)} inputProps={{ className: 'field' }} />
//   <CityField country={country} inputProps={{ className: 'field' }} />   — cities of that country; typing a new one is allowed
import { forwardRef, useEffect, useImperativeHandle, useRef, type InputHTMLAttributes } from 'react';
import { Combobox, type ComboboxHandle } from './Combobox';
import { citiesOfCountry, countries, countryItems } from '../../lib/geo';

type CountryProps = {
    defaultValue?: string;
    onChange?: (name: string, cc: string) => void;
    inputProps?: InputHTMLAttributes<HTMLInputElement>;
};

/** Country list with flags. Stores the country name; the ISO code is passed to onChange (the old input.dataset.cc). */
export const CountryField = forwardRef<ComboboxHandle, CountryProps>(function CountryField({ defaultValue, onChange, inputProps }, ref) {
    const box = useRef<ComboboxHandle>(null);
    useImperativeHandle(ref, () => box.current!);
    useEffect(() => {
        const c = countries().find(x => x.n.toLowerCase() === String(defaultValue || '').trim().toLowerCase());
        if (c) box.current?.setValue(c.c);
        else if (defaultValue) box.current?.setValue(defaultValue);
    }, [defaultValue]);
    return (
        <Combobox ref={box} load={countryItems} allowCustom inputProps={inputProps}
            onSelect={(it) => onChange?.(it?.label || '', it?.custom ? '' : it?.value || '')} />
    );
});

type CityProps = {
    /** the chosen country's name */
    country: string;
    defaultValue?: string;
    onChange?: (city: string, postalCode?: string) => void;
    inputProps?: InputHTMLAttributes<HTMLInputElement>;
};

export const CityField = forwardRef<ComboboxHandle, CityProps>(function CityField({ country, defaultValue, onChange, inputProps }, ref) {
    const box = useRef<ComboboxHandle>(null);
    const countryRef = useRef(country); countryRef.current = country;
    useImperativeHandle(ref, () => box.current!);
    useEffect(() => { box.current?.reload(); }, [country]);   // a new country brings its own city list
    useEffect(() => { if (defaultValue) box.current?.setValue(defaultValue); }, [defaultValue]);
    return (
        <Combobox ref={box} load={() => citiesOfCountry(countryRef.current.trim())} allowCustom emptyText="Pick the country first, or type the city"
            inputProps={inputProps} onSelect={(it) => onChange?.(it?.label || '', it?.postalCode)} />
    );
});
