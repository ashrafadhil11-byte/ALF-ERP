// File: api/countries.js
const REGIONAL_CITIES = {
    OM: ['Salalah', 'Sanaiya (Salalah Industrial)', 'Muscat', 'Seeb', 'Sohar', 'Nizwa', 'Sur', 'Barka', 'Ibri', 'Duqm', 'Khasab'],
    SA: ['Riyadh', 'Jeddah', 'Dammam', 'Al Khobar', 'Mecca', 'Medina', 'Jubail', 'Tabuk', 'Abha'],
    AE: ['Dubai', 'Sharjah', 'Abu Dhabi', 'Ajman', 'Ras Al Khaimah', 'Fujairah', 'Al Ain'],
    QA: ['Doha', 'Al Wakrah', 'Al Khor', 'Al Rayyan', 'Lusail'],
    KW: ['Kuwait City', 'Farwaniya', 'Hawalli', 'Ahmadi', 'Salmiya', 'Jahra'],
    BH: ['Manama', 'Muharraq', 'Riffa', 'Sitra', 'Isa Town'],
    IN: ['Kozhikode', 'Kochi', 'Kannur', 'Thiruvananthapuram', 'Thrissur', 'Malappuram', 'Kasaragod', 'Mangaluru', 'Bengaluru', 'Chennai', 'Mumbai', 'Delhi'],
    PK: ['Karachi', 'Lahore', 'Islamabad', 'Rawalpindi', 'Sialkot', 'Faisalabad', 'Peshawar'],
    BD: ['Dhaka', 'Chittagong', 'Sylhet', 'Khulna', 'Rajshahi'],
    LK: ['Colombo', 'Kandy', 'Galle', 'Negombo', 'Jaffna'],
    PH: ['Manila', 'Quezon City', 'Cebu City', 'Davao City', 'Makati'],
    EG: ['Cairo', 'Alexandria', 'Giza', 'Port Said', 'Suez'],
    DE: ['Frankfurt', 'Berlin', 'Hamburg', 'Munich', 'Cologne'],
    GB: ['London', 'Manchester', 'Birmingham', 'Glasgow', 'Liverpool'],
    US: ['New York', 'Houston', 'Chicago', 'Los Angeles', 'Miami'],
    CA: ['Toronto', 'Vancouver', 'Montreal', 'Calgary', 'Ottawa']
};

// Normalize any country object from v5 or v3.1
function normalizeCountry(item) {
    if (!item || typeof item !== 'object') return null;

    const commonName =
        (typeof item.name === 'string' ? item.name : item?.name?.common) ||
        item?.common_name ||
        item?.country ||
        null;

    if (!commonName) return null;

    const officialName =
        (typeof item?.name === 'object' ? item?.name?.official : null) ||
        item?.official_name ||
        commonName;

    const cca2 = String(item?.cca2 || item?.alpha2Code || item?.iso2 || item?.code || '').toUpperCase();
    const cca3 = String(item?.cca3 || item?.alpha3Code || item?.iso3 || '').toUpperCase();
    const capital = Array.isArray(item?.capital) ? item.capital[0] : (item?.capital || '');
    const region = item?.subregion || item?.region || '';

    // Extract Dialing Code (e.g. +968, +966, +91)
    let dialCode = '+';
    if (item?.idd?.root) {
        const suffixes = Array.isArray(item.idd.suffixes) ? item.idd.suffixes : [];
        // Note: countries like US/CA have root "+1" and many area suffixes; keep "+1" clean
        const suffix = (item.idd.root === '+1' || suffixes.length > 1) ? '' : (suffixes[0] || '');
        dialCode = `${item.idd.root}${suffix}`;
    } else if (Array.isArray(item?.callingCodes) && item.callingCodes[0]) {
        dialCode = `+${String(item.callingCodes[0]).replace(/^\+/, '')}`;
    } else if (item?.dial_code || item?.phone_code) {
        dialCode = `+${String(item.dial_code || item.phone_code).replace(/^\+/, '')}`;
    }

    const flag =
        item?.flags?.svg ||
        item?.flags?.png ||
        item?.flag_url ||
        (cca2 ? `https://flagcdn.com/${cca2.toLowerCase()}.svg` : '');

    const customCities = REGIONAL_CITIES[cca2] || [];
    const defaultCities = [capital, region].filter(Boolean);
    const cities = [...new Set([...customCities, ...defaultCities])];

    return {
        name: commonName,
        officialName,
        cca2,
        cca3,
        capital,
        region,
        dialCode,
        flag,
        cities
    };
}

function extractArrayFromPayload(payload) {
    if (!payload) return [];
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload.data)) return payload.data;
    if (Array.isArray(payload.countries)) return payload.countries;
    if (Array.isArray(payload.results)) return payload.results;
    if (payload.name || payload.cca2 || payload.alpha2Code) return [payload];
    return [];
}

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const query = (req.query.q || '').trim();
    const API_KEY = process.env.RESTCOUNTRIES_API_KEY || 'rc_live_123b103f9d2647f3a9b0a66d5cbf42de';

    let extractedList = [];

    // 1. Primary: Call api.restcountries.com/countries/v5 with Bearer Key
    if (query) {
        try {
            const v5Res = await fetch(
                `https://api.restcountries.com/countries/v5?q=${encodeURIComponent(query)}&pretty=1`,
                {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${API_KEY}`,
                        'Accept': 'application/json'
                    }
                }
            );
            if (v5Res.ok) {
                const v5Json = await v5Res.json();
                extractedList = extractArrayFromPayload(v5Json);
            }
        } catch (err) {
            // Continue to fallback
        }
    }

    // 2. If initial load (no `q`) or v5 returned empty, fetch from restcountries.com v3.1
    if (extractedList.length === 0) {
        try {
            const v3Url = query
                ? `https://restcountries.com/v3.1/name/${encodeURIComponent(query)}?fields=name,cca2,cca3,idd,capital,region,subregion,flags`
                : `https://restcountries.com/v3.1/all?fields=name,cca2,cca3,idd,capital,region,subregion,flags`;

            const v3Res = await fetch(v3Url, {
                headers: { 'Accept': 'application/json' }
            });

            if (v3Res.ok) {
                const v3Json = await v3Res.json();
                extractedList = extractArrayFromPayload(v3Json);
            }
        } catch (err) {
            // Continue to backup list
        }
    }

    const countries = extractedList
        .map(normalizeCountry)
        .filter(Boolean)
        .sort((a, b) => a.name.localeCompare(b.name));

    return res.status(200).json({ countries });
}
