// File: api/countries.js
const REGIONAL_CITIES = {
    OM: ['Salalah, Dhofar', 'Sanaiya (Salalah Industrial)', 'Muscat (Ruwi)', 'Seeb, Muscat', 'Sohar', 'Nizwa', 'Sur', 'Barka', 'Ibri', 'Duqm', 'Khasab'],
    AE: ['Dubai (Deira)', 'Dubai (Al Qusais)', 'Sharjah', 'Abu Dhabi', 'Ajman', 'Ras Al Khaimah', 'Fujairah', 'Al Ain'],
    SA: ['Riyadh', 'Jeddah', 'Dammam', 'Al Khobar', 'Mecca', 'Medina', 'Jubail'],
    QA: ['Doha', 'Al Wakrah', 'Al Khor', 'Industrial Area'],
    KW: ['Kuwait City', 'Farwaniya', 'Hawalli', 'Ahmadi', 'Salmiya'],
    BH: ['Manama', 'Muharraq', 'Riffa', 'Sitra'],
    IN: ['Kozhikode, Kerala', 'Kochi, Kerala', 'Thiruvananthapuram, Kerala', 'Thrissur, Kerala', 'Kannur, Kerala', 'Mumbai, Maharashtra', 'Delhi NCR', 'Chennai, TN', 'Bengaluru, KA', 'Mangaluru, KA', 'Hyderabad, TS'],
    PK: ['Karachi', 'Lahore', 'Islamabad', 'Sialkot', 'Faisalabad', 'Peshawar'],
    BD: ['Dhaka', 'Chittagong', 'Sylhet', 'Khulna'],
    LK: ['Colombo', 'Kandy', 'Galle', 'Negombo'],
    PH: ['Manila', 'Quezon City', 'Cebu City', 'Davao City'],
    EG: ['Cairo', 'Alexandria', 'Giza', 'Port Said'],
    DE: ['Frankfurt', 'Berlin', 'Hamburg', 'Munich', 'Cologne'],
    GB: ['London', 'Manchester', 'Birmingham', 'Glasgow'],
    US: ['New York, NY', 'Houston, TX', 'Chicago, IL', 'Los Angeles, CA'],
    CA: ['Toronto, ON', 'Vancouver, BC', 'Montreal, QC', 'Calgary, AB']
};

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const query = (req.query.q || '').trim();
    const API_KEY = process.env.RESTCOUNTRIES_API_KEY || 'rc_live_123b103f9d2647f3a9b0a66d5cbf42de';

    try {
        // Attempt Primary RESTCountries v5 API with Bearer Key, fallback to public v3.1 full list if needed
        const url = query
            ? `https://api.restcountries.com/countries/v5?q=${encodeURIComponent(query)}&pretty=1`
            : `https://api.restcountries.com/countries/v5?pretty=1`;

        let rawData = null;

        try {
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${API_KEY}`,
                    'Accept': 'application/json'
                }
            });
            if (response.ok) {
                rawData = await response.json();
            }
        } catch (err) {}

        // Fallback to full global dataset if v5 endpoint requires a query param on root
        if (!rawData) {
            const fallbackUrl = query
                ? `https://restcountries.com/v3.1/name/${encodeURIComponent(query)}?fields=name,cca2,cca3,idd,capital,region,subregion,flags`
                : `https://restcountries.com/v3.1/all?fields=name,cca2,cca3,idd,capital,region,subregion,flags`;
            const fbRes = await fetch(fallbackUrl);
            if (fbRes.ok) {
                rawData = await fbRes.json();
            }
        }

        const list = Array.isArray(rawData)
            ? rawData
            : (rawData?.data || rawData?.countries || (rawData ? [rawData] : []));

        const countries = list
            .filter(Boolean)
            .map(item => {
                const commonName = item?.name?.common || item?.name || 'Unknown';
                const officialName = item?.name?.official || commonName;
                const cca2 = (item?.cca2 || item?.alpha2Code || '').toUpperCase();
                const cca3 = (item?.cca3 || item?.alpha3Code || '').toUpperCase();
                const capital = Array.isArray(item?.capital) ? item.capital[0] : (item?.capital || '');
                const region = item?.subregion || item?.region || '';

                let dialCode = '+';
                if (item?.idd?.root) {
                    const suffix = Array.isArray(item.idd.suffixes) && item.idd.suffixes.length === 1
                        ? item.idd.suffixes[0]
                        : (Array.isArray(item.idd.suffixes) && item.idd.suffixes[0] ? item.idd.suffixes[0] : '');
                    dialCode = `${item.idd.root}${suffix}`;
                } else if (Array.isArray(item?.callingCodes) && item.callingCodes[0]) {
                    dialCode = `+${String(item.callingCodes[0]).replace(/^\+/, '')}`;
                }

                // Build City / Location options for this country
                const customCities = REGIONAL_CITIES[cca2] || [];
                const defaultCities = [
                    capital ? `${capital} (Capital)` : null,
                    region ? `${commonName} - ${region}` : null
                ].filter(Boolean);
                const cities = [...new Set([...customCities, ...defaultCities])];

                return {
                    name: commonName,
                    officialName,
                    cca2,
                    cca3,
                    capital,
                    region,
                    dialCode,
                    flag: item?.flags?.svg || item?.flags?.png || '',
                    cities
                };
            })
            .sort((a, b) => a.name.localeCompare(b.name));

        return res.status(200).json({ countries });
    } catch (error) {
        return res.status(500).json({ error: 'Unable to load countries', details: error.message });
    }
}
