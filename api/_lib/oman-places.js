// File: api/_lib/oman-places.js — built-in Oman places: governorate → wilayat → town, with Oman Post postal codes.
// SINGLE SOURCE OF TRUTH. The browser copy admin/components/oman-places.js is generated from this file:
//     node scripts/build-oman-places.mjs
// (tests/oman-places.test.mjs fails if the two drift apart.)
//
// Structure: 11 governorates and their 61 wilayats as listed by the National Centre for Statistics and
// Information (NCSI) — plus Al Jabal Al Akhdar, which NCSI now lists as its own wilayat of Ad Dakhiliyah.
// Each town: { name, code, alt? } — `code` is the main Oman Post 3-digit postal code, `alt` are further codes
// other sources give for the same place (newer post-office codes). `code: ''` = no source confirms one.
//
// Postal code sources (codes were copied from these, none invented):
//  [1] Oman Post postal code table (Muscat 111–134, Dhofar 211–223, Al Batinah 311–329, Ash Sharqiyah 411–425,
//      Adh Dhahirah 511–518, Ad Dakhiliyah 611–621, Al Wusta 711–712, Musandam 811–814), as republished at
//      https://fursahgcc.com/oman-postal-code/  (Muscat 113, Salalah 211, Sohar 311, Sur 411 also at
//      https://omanofw.com/postal-code-number-oman/)
//  [2] Oman post office postal codes by governorate: https://www.zipcode.com.ng/2023/11/oman-postal-code.html
//  [3] datahub.io Oman postal codes sample (GeoNames coordinates, NCSI divisions): https://postal.datahub.io/om/om.csv
//      (datahub notes the codes' origin is undocumented; used only to corroborate [2])
// Where [1] and [2] disagree (e.g. Bidbid 613 vs 600, Ibra 413 vs 400), [1] is the main code and [2] is in `alt`.
// Places whose wilayat could not be confirmed were left out (Qairun Hairiti 212, Madinat Al Haq 219,
// Tawi Atair 221, Deemet 240, Al Tarif 321, Burj Al Radah 329, Al Bidaya 316, Noor Al Falaj 361, Al Kahal 713…).

const t = (name, code = '', alt) => (alt ? { name, code, alt } : { name, code });
const w = (name, towns) => ({ name, towns });

export const OMAN = [
    { name: 'Muscat', wilayats: [
        w('Muscat', [t('Muscat', '113', ['100'])]),
        w('Muttrah', [t('Muttrah', '125', ['169']), t('Ruwi', '112', ['168']), t('Al Wadi Al Kabir', '117', ['144']), t('Jibroo', '114'),
            t('Mina Al Fahal', '116'), t('Al Hamriyah', '131'), t('Oman Commercial Center (OCC)', '126'), t('Khoula Hospital', '127')]),
        w('Bawshar', [t('Bawshar'), t('Madinat Sultan Qaboos', '115'), t('Al Khuwair', '133'), t('Al Azaiba', '130'), t('Al Ghubra', '146'),
            t('Al Ansab', '142'), t('Jawharat Al Shati', '134'), t('Al Harthy Complex', '118')]),
        w('As Seeb', [t('As Seeb', '121', ['159']), t('Central Post Office / Airport Heights', '111'), t('Seeb Airport', '128'),
            t('Al Murtafa\'a', '129'), t('Al Khoud', '132'), t('Sultan Qaboos University', '123'), t('Al Rusayl', '124'),
            t('Al Maabilah', '122', ['171']), t('Al Mouj', '138'), t('Al Hail', '143'), t('Al Mawaleh', '160')]),
        w('Al Amrat', [t('Al Amrat', '119', ['145', '170'])]),
        w('Qurayyat', [t('Qurayyat', '120', ['151', '161'])])
    ] },
    { name: 'Dhofar', wilayats: [
        w('Salalah', [t('Salalah', '211', ['226', '235']), t('Teetam', '213'), t('Al Dahariz', '214'), t('Al Hafa', '216'),
            t('Al Awqadain', '217'), t('Awqad', '231'), t('Bint Al Arab', '241')]),
        w('Taqah', [t('Taqah', '218', ['236'])]),
        w('Mirbat', [t('Mirbat', '220', ['232', '234']), t('Marfa Mirbat', '242')]),
        w('Thumrait', [t('Thumrait', '222', ['230'])]),
        w('Sadah', [t('Sadah', '223', ['225', '227'])]),
        w('Rakhyut', [t('Rakhyut', '237')]),
        w('Dhalkut', [t('Dhalkut', '238')]),
        w('Al Mazyunah', [t('Al Mazyunah', '239')]),
        w('Muqshin', [t('Muqshin')]),
        w('Shalim and the Hallaniyat Islands', [t('Shalim')])
    ] },
    { name: 'Musandam', wilayats: [
        w('Khasab', [t('Khasab', '811', ['815', '819'])]),
        w('Daba', [t('Daba', '813', ['800', '818', '820'])]),
        w('Bukha', [t('Bukha', '812', ['816'])]),
        w('Madha', [t('Madha', '814', ['817'])])
    ] },
    { name: 'Al Buraimi', wilayats: [
        w('Al Buraimi', [t('Al Buraimi', '512', ['524', '525', '530'])]),
        w('Mahdah', [t('Mahdah', '518', ['526'])]),
        w('As Sunaynah', [t('As Sunaynah', '517')])
    ] },
    { name: 'Ad Dakhiliyah', wilayats: [
        w('Nizwa', [t('Nizwa', '611'), t('Nizwa Daris', '625', ['643']), t('Nizwa Farq', '635'), t('Birkat Al Mawz', '616', ['633']), t('Al Emtiaz', '645')]),
        w('Bahla', [t('Bahla', '612', ['626', '630', '632']), t('Al Ghafat', '641')]),
        w('Manah', [t('Manah', '619', ['642'])]),
        w('Al Hamra', [t('Al Hamra', '617', ['634'])]),
        w('Adam', [t('Adam', '618', ['631'])]),
        w('Izki', [t('Izki', '614', ['629', '638'])]),
        w('Samail', [t('Samail', '620', ['636', '640']), t('Lizq', '615', ['624'])]),
        w('Bidbid', [t('Bidbid', '613', ['600']), t('Fanja', '623', ['637'])]),
        w('Al Jabal Al Akhdar', [t('Al Jabal Al Akhdar', '627', ['644']), t('Saiq', '621')])
    ] },
    { name: 'Al Batinah North', wilayats: [
        w('Sohar', [t('Sohar', '311', ['341', '356']), t('Sohar Industrial', '327'), t('Sohar Majz', '343'), t('Falaj Al Qabail', '322', ['344', '357'])]),
        w('Shinas', [t('Shinas', '324', ['339', '355'])]),
        w('Liwa', [t('Liwa', '325', ['345'])]),
        w('Saham', [t('Saham', '319', ['342', '354'])]),
        w('Al Khaburah', [t('Al Khaburah', '326', ['340', '347'])]),
        w('As Suwayq', [t('As Suwayq', '315', ['334'])])
    ] },
    { name: 'Al Batinah South', wilayats: [
        w('Ar Rustaq', [t('Ar Rustaq', '318', ['338']), t('Rustaq New', '350'), t('Al Hoqain', '358')]),
        w('Al Awabi', [t('Al Awabi', '317', ['336', '348'])]),
        w('Nakhal', [t('Nakhal', '323', ['332', '352'])]),
        w('Wadi Al Maawil', [t('Wadi Al Maawil', '353')]),
        w('Barka', [t('Barka', '320', ['335']), t('Al Rumays', '328')]),
        w('Al Musannah', [t('Al Musannah', '312', ['333', '351']), t('Wudam Al Sahil', '313'), t('Al Muladdah', '314')])
    ] },
    { name: 'Ash Sharqiyah South', wilayats: [
        w('Sur', [t('Sur', '411', ['427', '449', '453']), t('Sur Commercial District', '425')]),
        w('Al Kamil Wal Wafi', [t('Al Kamil Wal Wafi', '412', ['431', '437'])]),
        w('Jaalan Bani Bu Hassan', [t('Jaalan Bani Bu Hassan', '415', ['433', '439'])]),
        w('Jaalan Bani Bu Ali', [t('Jaalan Bani Bu Ali', '416', ['432', '440']), t('Al Ashkharah', '422')]),
        w('Masirah', [t('Masirah', '414', ['436', '441'])])
    ] },
    { name: 'Ash Sharqiyah North', wilayats: [
        w('Ibra', [t('Ibra', '413', ['400', '429', '444'])]),
        w('Al Mudaybi', [t('Al Mudaybi', '420', ['447', '450']), t('Sinaw', '418', ['428', '451']), t('Samad Al Shan', '423', ['445'])]),
        w('Bidiyah', [t('Bidiyah', '421', ['435', '443'])]),
        w('Al Qabil', [t('Al Qabil', '442'), t('Al Mudhairib', '419')]),
        w('Wadi Bani Khalid', [t('Wadi Bani Khalid', '417', ['452'])]),
        w('Dima Wa Al Taiyyin', [t('Dima Wa Al Taiyyin', '424', ['446'])])
    ] },
    { name: 'Adh Dhahirah', wilayats: [
        w('Ibri', [t('Ibri', '511', ['523', '531']), t('Al Araqi', '515', ['528']), t('Al Akhdar', '516')]),
        w('Yanqul', [t('Yanqul', '513', ['500', '532'])]),
        w('Dhank', [t('Dhank', '514', ['522', '529'])])
    ] },
    { name: 'Al Wusta', wilayats: [
        w('Haima', [t('Haima', '711', ['714'])]),
        w('Duqm', [t('Duqm', '716', ['700', '718'])]),
        w('Mahout', [t('Mahout', '717')]),
        w('Al Jazir', [t('Al Jazir', '712')])
    ] }
];

/**
 * Search the Oman data by postal code ("211") or place name ("salalah", "ruwi", "nizwa").
 * Self-contained (no outer references) so the browser copy can embed it with Function#toString.
 * @returns places like the other postal providers: [{ postOffice, city, state, postalCode, countryCode, wilayat }]
 */
export function searchOmanIn(data, query) {
    const fold = (v) => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const q = fold(query);
    if (!q) return [];
    const isCode = /^\d+$/.test(q);
    const out = [];
    for (const g of data) for (const wil of g.wilayats) for (const tw of wil.towns) {
        const codes = [tw.code, ...(tw.alt || [])].filter(Boolean);
        let rank = 9, code = tw.code;
        if (isCode) {
            const hit = codes.find(c => c === q) || codes.find(c => c.startsWith(q));
            if (hit) { rank = hit === q ? 0 : 1; code = hit; }
        } else {
            const n = fold(tw.name), wn = fold(wil.name);
            if (n === q) rank = 0;
            else if (n.startsWith(q) || n.split(' ').some(x => x.startsWith(q))) rank = 1;
            else if (wn === q || wn.startsWith(q)) rank = 2;
            else if (n.includes(q)) rank = 3;
        }
        if (rank < 9) out.push({ rank, place: { postOffice: tw.name, city: tw.name, wilayat: wil.name, state: g.name, postalCode: code, countryCode: 'OM' } });
    }
    return out.sort((a, b) => a.rank - b.rank).slice(0, 25).map(x => x.place);
}

export const searchOman = (query) => searchOmanIn(OMAN, query);
