// File: api/countries.js
export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const query = (req.query.q || 'oman').trim();
    const API_KEY = process.env.RESTCOUNTRIES_API_KEY || 'rc_live_123b103f9d2647f3a9b0a66d5cbf42de';

    try {
        const response = await fetch(
            `https://api.restcountries.com/countries/v5?q=${encodeURIComponent(query)}&pretty=1`,
            {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${API_KEY}`,
                    'Accept': 'application/json'
                }
            }
        );

        if (!response.ok) {
            throw new Error(`Countries API responded with ${response.status}`);
        }

        const rawData = await response.json();
        const list = Array.isArray(rawData) ? rawData : (rawData.data || rawData.countries || [rawData]);

        const countries = list.filter(Boolean).map(item => {
            const commonName = item?.name?.common || item?.name || 'Unknown';
            const officialName = item?.name?.official || commonName;
            const cca2 = item?.cca2 || item?.alpha2Code || '';
            const cca3 = item?.cca3 || item?.alpha3Code || '';
            const capital = Array.isArray(item?.capital) ? item.capital[0] : (item?.capital || '');
            const region = item?.subregion || item?.region || '';
            
            // Extract international dialing code (e.g. +968)
            let dialCode = '';
            if (item?.idd?.root) {
                const suffix = Array.isArray(item.idd.suffixes) && item.idd.suffixes.length === 1 ? item.idd.suffixes[0] : '';
                dialCode = `${item.idd.root}${suffix}`;
            } else if (Array.isArray(item?.callingCodes) && item.callingCodes[0]) {
                dialCode = `+${item.callingCodes[0].replace(/^\+/, '')}`;
            }

            return {
                name: commonName,
                officialName,
                cca2,
                cca3,
                capital,
                region,
                dialCode: dialCode || '+',
                flag: item?.flags?.svg || item?.flags?.png || ''
            };
        });

        return res.status(200).json({ countries });
    } catch (error) {
        return res.status(500).json({ error: 'Unable to fetch country details', details: error.message });
    }
}
