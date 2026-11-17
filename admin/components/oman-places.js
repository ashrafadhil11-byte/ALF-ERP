// File: admin/components/oman-places.js — GENERATED from api/_lib/oman-places.js. Do not edit by hand;
// edit the shared module and run the script below.
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

// window.ALF_OMAN = [{ name: governorate, wilayats: [{ name: wilayat, towns: [{ name, code, alt? }] }] }]
window.ALF_OMAN = [
    {"name":"Muscat","wilayats":[{"name":"Muscat","towns":[{"name":"Muscat","code":"113","alt":["100"]}]},{"name":"Muttrah","towns":[{"name":"Muttrah","code":"125","alt":["169"]},{"name":"Ruwi","code":"112","alt":["168"]},{"name":"Al Wadi Al Kabir","code":"117","alt":["144"]},{"name":"Jibroo","code":"114"},{"name":"Mina Al Fahal","code":"116"},{"name":"Al Hamriyah","code":"131"},{"name":"Oman Commercial Center (OCC)","code":"126"},{"name":"Khoula Hospital","code":"127"}]},{"name":"Bawshar","towns":[{"name":"Bawshar","code":""},{"name":"Madinat Sultan Qaboos","code":"115"},{"name":"Al Khuwair","code":"133"},{"name":"Al Azaiba","code":"130"},{"name":"Al Ghubra","code":"146"},{"name":"Al Ansab","code":"142"},{"name":"Jawharat Al Shati","code":"134"},{"name":"Al Harthy Complex","code":"118"}]},{"name":"As Seeb","towns":[{"name":"As Seeb","code":"121","alt":["159"]},{"name":"Central Post Office / Airport Heights","code":"111"},{"name":"Seeb Airport","code":"128"},{"name":"Al Murtafa'a","code":"129"},{"name":"Al Khoud","code":"132"},{"name":"Sultan Qaboos University","code":"123"},{"name":"Al Rusayl","code":"124"},{"name":"Al Maabilah","code":"122","alt":["171"]},{"name":"Al Mouj","code":"138"},{"name":"Al Hail","code":"143"},{"name":"Al Mawaleh","code":"160"}]},{"name":"Al Amrat","towns":[{"name":"Al Amrat","code":"119","alt":["145","170"]}]},{"name":"Qurayyat","towns":[{"name":"Qurayyat","code":"120","alt":["151","161"]}]}]},
    {"name":"Dhofar","wilayats":[{"name":"Salalah","towns":[{"name":"Salalah","code":"211","alt":["226","235"]},{"name":"Teetam","code":"213"},{"name":"Al Dahariz","code":"214"},{"name":"Al Hafa","code":"216"},{"name":"Al Awqadain","code":"217"},{"name":"Awqad","code":"231"},{"name":"Bint Al Arab","code":"241"}]},{"name":"Taqah","towns":[{"name":"Taqah","code":"218","alt":["236"]}]},{"name":"Mirbat","towns":[{"name":"Mirbat","code":"220","alt":["232","234"]},{"name":"Marfa Mirbat","code":"242"}]},{"name":"Thumrait","towns":[{"name":"Thumrait","code":"222","alt":["230"]}]},{"name":"Sadah","towns":[{"name":"Sadah","code":"223","alt":["225","227"]}]},{"name":"Rakhyut","towns":[{"name":"Rakhyut","code":"237"}]},{"name":"Dhalkut","towns":[{"name":"Dhalkut","code":"238"}]},{"name":"Al Mazyunah","towns":[{"name":"Al Mazyunah","code":"239"}]},{"name":"Muqshin","towns":[{"name":"Muqshin","code":""}]},{"name":"Shalim and the Hallaniyat Islands","towns":[{"name":"Shalim","code":""}]}]},
    {"name":"Musandam","wilayats":[{"name":"Khasab","towns":[{"name":"Khasab","code":"811","alt":["815","819"]}]},{"name":"Daba","towns":[{"name":"Daba","code":"813","alt":["800","818","820"]}]},{"name":"Bukha","towns":[{"name":"Bukha","code":"812","alt":["816"]}]},{"name":"Madha","towns":[{"name":"Madha","code":"814","alt":["817"]}]}]},
    {"name":"Al Buraimi","wilayats":[{"name":"Al Buraimi","towns":[{"name":"Al Buraimi","code":"512","alt":["524","525","530"]}]},{"name":"Mahdah","towns":[{"name":"Mahdah","code":"518","alt":["526"]}]},{"name":"As Sunaynah","towns":[{"name":"As Sunaynah","code":"517"}]}]},
    {"name":"Ad Dakhiliyah","wilayats":[{"name":"Nizwa","towns":[{"name":"Nizwa","code":"611"},{"name":"Nizwa Daris","code":"625","alt":["643"]},{"name":"Nizwa Farq","code":"635"},{"name":"Birkat Al Mawz","code":"616","alt":["633"]},{"name":"Al Emtiaz","code":"645"}]},{"name":"Bahla","towns":[{"name":"Bahla","code":"612","alt":["626","630","632"]},{"name":"Al Ghafat","code":"641"}]},{"name":"Manah","towns":[{"name":"Manah","code":"619","alt":["642"]}]},{"name":"Al Hamra","towns":[{"name":"Al Hamra","code":"617","alt":["634"]}]},{"name":"Adam","towns":[{"name":"Adam","code":"618","alt":["631"]}]},{"name":"Izki","towns":[{"name":"Izki","code":"614","alt":["629","638"]}]},{"name":"Samail","towns":[{"name":"Samail","code":"620","alt":["636","640"]},{"name":"Lizq","code":"615","alt":["624"]}]},{"name":"Bidbid","towns":[{"name":"Bidbid","code":"613","alt":["600"]},{"name":"Fanja","code":"623","alt":["637"]}]},{"name":"Al Jabal Al Akhdar","towns":[{"name":"Al Jabal Al Akhdar","code":"627","alt":["644"]},{"name":"Saiq","code":"621"}]}]},
    {"name":"Al Batinah North","wilayats":[{"name":"Sohar","towns":[{"name":"Sohar","code":"311","alt":["341","356"]},{"name":"Sohar Industrial","code":"327"},{"name":"Sohar Majz","code":"343"},{"name":"Falaj Al Qabail","code":"322","alt":["344","357"]}]},{"name":"Shinas","towns":[{"name":"Shinas","code":"324","alt":["339","355"]}]},{"name":"Liwa","towns":[{"name":"Liwa","code":"325","alt":["345"]}]},{"name":"Saham","towns":[{"name":"Saham","code":"319","alt":["342","354"]}]},{"name":"Al Khaburah","towns":[{"name":"Al Khaburah","code":"326","alt":["340","347"]}]},{"name":"As Suwayq","towns":[{"name":"As Suwayq","code":"315","alt":["334"]}]}]},
    {"name":"Al Batinah South","wilayats":[{"name":"Ar Rustaq","towns":[{"name":"Ar Rustaq","code":"318","alt":["338"]},{"name":"Rustaq New","code":"350"},{"name":"Al Hoqain","code":"358"}]},{"name":"Al Awabi","towns":[{"name":"Al Awabi","code":"317","alt":["336","348"]}]},{"name":"Nakhal","towns":[{"name":"Nakhal","code":"323","alt":["332","352"]}]},{"name":"Wadi Al Maawil","towns":[{"name":"Wadi Al Maawil","code":"353"}]},{"name":"Barka","towns":[{"name":"Barka","code":"320","alt":["335"]},{"name":"Al Rumays","code":"328"}]},{"name":"Al Musannah","towns":[{"name":"Al Musannah","code":"312","alt":["333","351"]},{"name":"Wudam Al Sahil","code":"313"},{"name":"Al Muladdah","code":"314"}]}]},
    {"name":"Ash Sharqiyah South","wilayats":[{"name":"Sur","towns":[{"name":"Sur","code":"411","alt":["427","449","453"]},{"name":"Sur Commercial District","code":"425"}]},{"name":"Al Kamil Wal Wafi","towns":[{"name":"Al Kamil Wal Wafi","code":"412","alt":["431","437"]}]},{"name":"Jaalan Bani Bu Hassan","towns":[{"name":"Jaalan Bani Bu Hassan","code":"415","alt":["433","439"]}]},{"name":"Jaalan Bani Bu Ali","towns":[{"name":"Jaalan Bani Bu Ali","code":"416","alt":["432","440"]},{"name":"Al Ashkharah","code":"422"}]},{"name":"Masirah","towns":[{"name":"Masirah","code":"414","alt":["436","441"]}]}]},
    {"name":"Ash Sharqiyah North","wilayats":[{"name":"Ibra","towns":[{"name":"Ibra","code":"413","alt":["400","429","444"]}]},{"name":"Al Mudaybi","towns":[{"name":"Al Mudaybi","code":"420","alt":["447","450"]},{"name":"Sinaw","code":"418","alt":["428","451"]},{"name":"Samad Al Shan","code":"423","alt":["445"]}]},{"name":"Bidiyah","towns":[{"name":"Bidiyah","code":"421","alt":["435","443"]}]},{"name":"Al Qabil","towns":[{"name":"Al Qabil","code":"442"},{"name":"Al Mudhairib","code":"419"}]},{"name":"Wadi Bani Khalid","towns":[{"name":"Wadi Bani Khalid","code":"417","alt":["452"]}]},{"name":"Dima Wa Al Taiyyin","towns":[{"name":"Dima Wa Al Taiyyin","code":"424","alt":["446"]}]}]},
    {"name":"Adh Dhahirah","wilayats":[{"name":"Ibri","towns":[{"name":"Ibri","code":"511","alt":["523","531"]},{"name":"Al Araqi","code":"515","alt":["528"]},{"name":"Al Akhdar","code":"516"}]},{"name":"Yanqul","towns":[{"name":"Yanqul","code":"513","alt":["500","532"]}]},{"name":"Dhank","towns":[{"name":"Dhank","code":"514","alt":["522","529"]}]}]},
    {"name":"Al Wusta","wilayats":[{"name":"Haima","towns":[{"name":"Haima","code":"711","alt":["714"]}]},{"name":"Duqm","towns":[{"name":"Duqm","code":"716","alt":["700","718"]}]},{"name":"Mahout","towns":[{"name":"Mahout","code":"717"}]},{"name":"Al Jazir","towns":[{"name":"Al Jazir","code":"712"}]}]}];
// window.ALF_OMAN_SEARCH('211' | 'ruwi') → [{ postOffice, city, wilayat, state, postalCode, countryCode }]
window.ALF_OMAN_SEARCH = (q) => (function searchOmanIn(data, query) {
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
})(window.ALF_OMAN, q);
