// File: api/postal-lookup.js
export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { code, countryCode, countryName, mode } = req.query;
    const ZIPCODEBASE_KEY = process.env.ZIPCODEBASE_API_KEY || 'be0273c0-c868-11f1-a720-497e79275709';

    try {
        // =====================================================================
        // MODE 1: FETCH CONCURRENT CITIES FOR SELECTED COUNTRY
        // =====================================================================
        if (mode === 'cities' && countryName) {
            const citiesRes = await fetch('https://countriesnow.space/api/v0.1/countries/cities', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ country: countryName.trim() })
            });

            if (citiesRes.ok) {
                const citiesData = await citiesRes.json();
                if (Array.isArray(citiesData?.data) && citiesData.data.length > 0) {
                    return res.status(200).json({ cities: citiesData.data });
                }
            }
            return res.status(200).json({ cities: [] });
        }

        // =====================================================================
        // MODE 2: POSTAL / ZIP / PINCODE LOOKUP (Zipcodebase + India Post)
        // =====================================================================
        const cleanCode = (code || '').trim();
        if (!cleanCode) {
            return res.status(400).json({ error: 'Postal code is required' });
        }

        const iso2 = (countryCode || '').trim().toUpperCase();
        const locations = [];

        // 1. If Country is India (IN) or 6-digit Indian Pincode, fetch granular Post Offices first
        if ((iso2 === 'IN' || !iso2) && /^\d{6}$/.test(cleanCode)) {
            try {
                const inRes = await fetch(`https://api.postalpincode.in/pincode/${cleanCode}`);
                if (inRes.ok) {
                    const inData = await inRes.json();
                    const postOffices = inData?.[0]?.PostOffice;
                    if (Array.isArray(postOffices)) {
                        postOffices.forEach(po => {
                            locations.push({
                                postOffice: po.Name,
                                city: po.District || po.Block || po.Division || '',
                                state: po.State || '',
                                postalCode: cleanCode,
                                countryCode: 'IN',
                                branchType: po.BranchType || '',
                                deliveryStatus: po.DeliveryStatus || ''
                            });
                        });
                    }
                }
            } catch (e) {}
        }

        // 2. Query Zipcodebase API (Global Postal Code Engine)
        try {
            const zipUrl = new URL('https://app.zipcodebase.com/api/v1/search');
            zipUrl.searchParams.set('codes', cleanCode);
            if (iso2) {
                zipUrl.searchParams.set('country', iso2);
            }

            const zipRes = await fetch(zipUrl.toString(), {
                method: 'GET',
                headers: {
                    'apikey': ZIPCODEBASE_KEY,
                    'Accept': 'application/json'
                }
            });

            if (zipRes.ok) {
                const zipData = await zipRes.json();
                const codeResults = zipData?.results?.[cleanCode];
                if (Array.isArray(codeResults)) {
                    codeResults.forEach(item => {
                        const localityName = item.city || item.province || cleanCode;
                        const cityName = item.city_en || item.city || item.county || '';
                        const stateName = item.state || item.state_en || item.province || '';

                        // Avoid duplicating exact post office names already added
                        const alreadyExists = locations.some(
                            loc => loc.postOffice.toLowerCase() === String(localityName).toLowerCase()
                        );

                        if (!alreadyExists) {
                            locations.push({
                                postOffice: localityName,
                                city: cityName,
                                state: stateName,
                                postalCode: item.postal_code || cleanCode,
                                countryCode: item.country_code || iso2,
                                latitude: item.latitude,
                                longitude: item.longitude
                            });
                        }
                    });
                }
            }
        } catch (e) {}

        return res.status(200).json({
            code: cleanCode,
            count: locations.length,
            locations
        });

    } catch (error) {
        return res.status(500).json({ error: 'Failed to lookup postal code', details: error.message });
    }
}
