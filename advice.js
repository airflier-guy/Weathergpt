// Role-based action advice. Pure functions: hourly weather in, concrete recommendations out.
// Every recommendation is { code, vars } so it can be shown in English, Hindi or Bengali.
// All thresholds are practical rules of thumb, not agronomy/marine/medical standards.

export const ROLES = ['farmer', 'traveller', 'fisherman', 'worker'];

export function detectRole(text = '') {
  const s = text.toLowerCase();
  if (/farm|crop|kisan|harvest|irrigat|spray|खेती|किसान|सिंचाई|छिड़काव|फसल|চাষ|সেচ|স্প্রে|ফসল/.test(s)) return 'farmer';
  if (/fisher|fishing|\bboat|\bsea\b|\bfish\b|मछुआ|मछली|नाव|জেলে|মাছ|নৌকা/.test(s)) return 'fisherman';
  if (/\btravel|\btrip\b|journey|road ?trip|driving|यात्रा|सफर|ভ্রমণ|যাত্রা/.test(s)) return 'traveller';
  if (/worker|labou?r|construction|outdoor work|site work|मज़दूर|मजदूर|श्रमिक|শ্রমিক/.test(s)) return 'worker';
  return null;
}

const sum = a => a.reduce((x, y) => x + (y || 0), 0);
const r1 = x => Math.round(x * 10) / 10;
const hourOf = t => +t.slice(11, 13);
const dateOf = t => t.slice(0, 10);

// longest run of consecutive hours (same day) where pred is true and the run is at least minLen long
function bestRuns(hours, pred, minLen) {
  const runs = []; let cur = null;
  hours.forEach((h, i) => {
    const prev = hours[i - 1];
    const ok = pred(h, i);
    if (ok && cur && prev && dateOf(prev.t) === dateOf(h.t) && hourOf(h.t) === hourOf(prev.t) + 1) cur.to = hourOf(h.t) + 1;
    else if (ok) { cur = { date: dateOf(h.t), from: hourOf(h.t), to: hourOf(h.t) + 1 }; runs.push(cur); }
    else cur = null;
  });
  const byDay = new Map();
  for (const r of runs) {
    if (r.to - r.from < minLen) continue;
    const b = byDay.get(r.date);
    if (!b || r.to - r.from > b.to - b.from) byDay.set(r.date, r);
  }
  return [...byDay.values()];
}

// hours: [{t:'2026-11-25T14:00', temp, feels, rain, pop, wind, gust, soil, wave}]  (future hours only)
// daily: {date:[], et0:[], rain:[]}
export function computeAdvice(role, hours, daily = {}) {
  const recs = [];
  const days = [...new Set(hours.map(h => dateOf(h.t)))].slice(0, 3);
  const next48 = hours.slice(0, 48);
  const rain48 = r1(sum(next48.map(h => h.rain)));
  const soils = hours.slice(0, 6).map(h => h.soil).filter(v => v != null);
  const soil = soils.length ? r1(sum(soils) / soils.length * 100) / 100 : null;
  const summary = {
    rain_next_48h_mm: rain48,
    max_wind_kmh: Math.round(Math.max(0, ...next48.map(h => h.wind || 0))),
    max_gust_kmh: Math.round(Math.max(0, ...next48.map(h => h.gust || 0))),
    max_temp_c: r1(Math.max(-99, ...next48.map(h => h.temp ?? -99))),
    soil_moisture: soil
  };

  if (role === 'farmer') {
    // Spraying: daylight, light wind, no rain for the hour and the 3 hours after (rainfast time), not too hot
    const rainFree = (i) => [0, 1, 2, 3].every(k => hours[i + k] && !(hours[i + k].rain > 0.1) && (hours[i + k].pop ?? 0) < 40);
    const spray = bestRuns(hours.slice(0, 48), (h, i) => { const hr = hourOf(h.t); return hr >= 6 && hr <= 18 && h.wind <= 15 && (h.gust ?? h.wind) <= 25 && h.temp <= 35 && rainFree(i); }, 2).slice(0, 2);
    if (spray.length) spray.forEach(w => recs.push({ code: 'SPRAY_WINDOW', vars: w }));
    else recs.push({ code: 'SPRAY_NONE', vars: {} });

    // Irrigation: water demand (ET0) minus the rain that will actually help, plus a soil moisture check
    const et2 = daily.et0 && daily.et0.length ? sum(daily.et0.slice(0, 2)) : 8; // 4 mm/day typical if unknown
    const deficit = et2 - 0.8 * rain48;
    if (rain48 >= 10) recs.push({ code: 'IRRIGATE_SKIP_RAIN', vars: { mm: Math.round(rain48) } });
    else if ((soil != null && soil < 0.18) || deficit >= 8) recs.push({ code: 'IRRIGATE', vars: { mm: Math.min(30, Math.max(8, Math.round(deficit))) } });
    else recs.push({ code: 'IRRIGATE_HOLD', vars: {} });

    const harvest = days.filter(d => { const hs = hours.filter(h => dateOf(h.t) === d); return hs.length >= 8 && sum(hs.map(h => h.rain)) < 1 && Math.max(...hs.map(h => h.pop ?? 0)) < 30; });
    if (harvest.length) recs.push({ code: 'HARVEST_OK', vars: { date: harvest[0] } });
  }

  if (role === 'traveller') {
    const day = hours.slice(0, 48).filter(h => hourOf(h.t) >= 6 && hourOf(h.t) <= 21);
    const clear = bestRuns(day, h => (h.pop ?? 0) < 30 && !(h.rain > 0.1), 2).slice(0, 2);
    clear.forEach(w => recs.push({ code: 'TRAVEL_CLEAR', vars: w }));
    const wet = bestRuns(day, h => (h.pop ?? 0) >= 60 || h.rain >= 1, 1).slice(0, 2);
    wet.forEach(w => recs.push({ code: 'TRAVEL_RAIN', vars: w }));
    if (!clear.length && !wet.length) recs.push({ code: 'TRAVEL_MIXED', vars: {} });
  }

  if (role === 'fisherman') {
    const hasWave = hours.some(h => h.wave != null);
    const safe = bestRuns(hours.slice(0, 48), h => { const hr = hourOf(h.t); return hr >= 4 && hr <= 18 && (h.gust ?? h.wind) <= 30 && !(h.rain > 2) && (h.wave == null || h.wave <= 1.5); }, 3).slice(0, 2);
    if (safe.length) safe.forEach(w => recs.push({ code: 'SEA_SAFE', vars: w }));
    else recs.push({ code: 'SEA_UNSAFE', vars: { gust: summary.max_gust_kmh, wave: hasWave ? r1(Math.max(...hours.slice(0, 48).map(h => h.wave ?? 0))) : null } });
  }

  if (role === 'worker') {
    const hot = bestRuns(hours.slice(0, 48), h => (h.feels ?? h.temp) >= 38, 1).slice(0, 1);
    if (hot.length) {
      recs.push({ code: 'HEAT_AVOID', vars: hot[0] });
      if (hot[0].from > 8) recs.push({ code: 'WORK_WINDOW', vars: { date: hot[0].date, from: 6, to: hot[0].from } });
    } else recs.push({ code: 'HEAT_OK', vars: {} });
    const wet = bestRuns(hours.slice(0, 24), h => h.rain >= 0.5, 1).slice(0, 1);
    if (wet.length) recs.push({ code: 'WORK_RAIN', vars: wet[0] });
  }
  return { recommendations: recs, summary };
}

/* ---------------- wording (en / hi / bn) ---------------- */
const pad = n => String(n).padStart(2, '0');
const hh = n => `${pad(n)}:00`;
const LOC = { en: 'en-IN', hi: 'hi-IN', bn: 'bn-IN' };
const dn = (d, lang) => new Date(d + 'T12:00:00').toLocaleDateString(LOC[lang] || 'en-IN', { weekday: 'short', day: 'numeric', month: 'short' });

const T = {
  en: {
    SPRAY_WINDOW: v => `🌾 Best time to spray: ${v.d}, ${v.fr}–${v.to} (light wind, no rain for 4 hours after).`,
    SPRAY_NONE: () => '🌾 No safe spraying window in the next 2 days (too windy, hot or rainy). Check again tomorrow.',
    IRRIGATE: v => `💧 Irrigate: the field needs about ${v.mm} mm over the next 2 days. Water early morning (05:00–08:00) to cut evaporation.`,
    IRRIGATE_SKIP_RAIN: v => `💧 Skip irrigation: about ${v.mm} mm of rain is expected within 48 hours.`,
    IRRIGATE_HOLD: () => '💧 No irrigation needed yet: soil and rain cover the next 2 days. Re-check tomorrow.',
    HARVEST_OK: v => `🌾 Good day for harvesting or drying: ${v.d} (almost no rain).`,
    TRAVEL_CLEAR: v => `🚗 Best time to travel: ${v.d}, ${v.fr}–${v.to} (dry).`,
    TRAVEL_RAIN: v => `☔ Expect rain: ${v.d}, ${v.fr}–${v.to}. Avoid driving then or allow extra time.`,
    TRAVEL_MIXED: () => '🚗 Mixed conditions: keep an umbrella and check again before leaving.',
    SEA_SAFE: v => `🎣 Safer window at sea: ${v.d}, ${v.fr}–${v.to} (gusts under 30 km/h).`,
    SEA_UNSAFE: v => `⛔ Not advised to go out: gusts up to ${v.gust} km/h${v.wave ? `, waves up to ${v.wave} m` : ''}. Follow fisheries and coast guard warnings.`,
    HEAT_AVOID: v => `🥵 Avoid heavy outdoor work ${v.d}, ${v.fr}–${v.to} (feels like 38 °C or more). Take water and shade breaks.`,
    WORK_WINDOW: v => `🛠️ Best working hours: ${v.d}, ${v.fr}–${v.to} (cooler).`,
    HEAT_OK: () => '🛠️ No dangerous heat expected in the next 2 days. Still drink water regularly.',
    WORK_RAIN: v => `🌧️ Rain likely ${v.d}, ${v.fr}–${v.to}: protect materials and avoid work at height.`,
    head: { farmer: 'Farming advice', traveller: 'Travel advice', fisherman: 'Fishing advice', worker: 'Outdoor work advice' },
    data: s => `📊 Next 48 h: rain ${s.rain_next_48h_mm} mm · wind up to ${s.max_wind_kmh} km/h · max ${s.max_temp_c}°C${s.soil_moisture != null ? ` · soil moisture ${s.soil_moisture}` : ''}`,
    disc: 'ℹ️ Rule-of-thumb guidance from forecast data. Local soil, crop, vehicle and boat conditions vary; follow official warnings.'
  },
  hi: {
    SPRAY_WINDOW: v => `🌾 छिड़काव का सबसे अच्छा समय: ${v.d}, ${v.fr}–${v.to} (हल्की हवा, बाद के 4 घंटे बारिश नहीं)।`,
    SPRAY_NONE: () => '🌾 अगले 2 दिनों में छिड़काव का सुरक्षित समय नहीं (तेज़ हवा, गर्मी या बारिश)। कल फिर देखें।',
    IRRIGATE: v => `💧 सिंचाई करें: अगले 2 दिनों में खेत को लगभग ${v.mm} मिमी पानी चाहिए। वाष्पीकरण घटाने के लिए सुबह (05:00–08:00) पानी दें।`,
    IRRIGATE_SKIP_RAIN: v => `💧 सिंचाई न करें: 48 घंटे में लगभग ${v.mm} मिमी बारिश की संभावना है।`,
    IRRIGATE_HOLD: () => '💧 अभी सिंचाई की ज़रूरत नहीं: मिट्टी की नमी और बारिश अगले 2 दिन के लिए काफ़ी है। कल फिर देखें।',
    HARVEST_OK: v => `🌾 कटाई या सुखाने के लिए अच्छा दिन: ${v.d} (लगभग बारिश नहीं)।`,
    TRAVEL_CLEAR: v => `🚗 यात्रा का सबसे अच्छा समय: ${v.d}, ${v.fr}–${v.to} (सूखा मौसम)।`,
    TRAVEL_RAIN: v => `☔ बारिश की संभावना: ${v.d}, ${v.fr}–${v.to}। तब गाड़ी चलाने से बचें या अतिरिक्त समय रखें।`,
    TRAVEL_MIXED: () => '🚗 मिला-जुला मौसम: छाता रखें और निकलने से पहले फिर देखें।',
    SEA_SAFE: v => `🎣 समुद्र में अपेक्षाकृत सुरक्षित समय: ${v.d}, ${v.fr}–${v.to} (झोंके 30 किमी/घं से कम)।`,
    SEA_UNSAFE: v => `⛔ समुद्र में जाना ठीक नहीं: झोंके ${v.gust} किमी/घं तक${v.wave ? `, लहरें ${v.wave} मीटर तक` : ''}। मत्स्य विभाग और तटरक्षक की चेतावनी मानें।`,
    HEAT_AVOID: v => `🥵 भारी बाहरी काम से बचें ${v.d}, ${v.fr}–${v.to} (महसूस 38 °C या अधिक)। पानी और छाँव में विश्राम लें।`,
    WORK_WINDOW: v => `🛠️ काम के सबसे अच्छे घंटे: ${v.d}, ${v.fr}–${v.to} (ठंडा समय)।`,
    HEAT_OK: () => '🛠️ अगले 2 दिनों में खतरनाक गर्मी नहीं दिख रही। फिर भी नियमित पानी पिएँ।',
    WORK_RAIN: v => `🌧️ बारिश की संभावना ${v.d}, ${v.fr}–${v.to}: सामान ढकें और ऊँचाई पर काम न करें।`,
    head: { farmer: 'खेती की सलाह', traveller: 'यात्रा की सलाह', fisherman: 'मछली पकड़ने की सलाह', worker: 'बाहरी काम की सलाह' },
    data: s => `📊 अगले 48 घंटे: बारिश ${s.rain_next_48h_mm} मिमी · हवा ${s.max_wind_kmh} किमी/घं तक · अधिकतम ${s.max_temp_c}°C${s.soil_moisture != null ? ` · मिट्टी की नमी ${s.soil_moisture}` : ''}`,
    disc: 'ℹ️ यह पूर्वानुमान आँकड़ों पर आधारित मोटा मार्गदर्शन है। स्थानीय मिट्टी, फसल, वाहन और नाव की स्थिति अलग हो सकती है; आधिकारिक चेतावनी मानें।'
  },
  bn: {
    SPRAY_WINDOW: v => `🌾 স্প্রে করার সেরা সময়: ${v.d}, ${v.fr}–${v.to} (হালকা বাতাস, পরের ৪ ঘণ্টা বৃষ্টি নেই)।`,
    SPRAY_NONE: () => '🌾 আগামী ২ দিনে স্প্রে করার নিরাপদ সময় নেই (বাতাস, গরম বা বৃষ্টি)। কাল আবার দেখুন।',
    IRRIGATE: v => `💧 সেচ দিন: আগামী ২ দিনে জমির প্রায় ${v.mm} মিমি জল দরকার। বাষ্পীভবন কমাতে সকালে (০৫:০০–০৮:০০) জল দিন।`,
    IRRIGATE_SKIP_RAIN: v => `💧 সেচ দেবেন না: ৪৮ ঘণ্টায় প্রায় ${v.mm} মিমি বৃষ্টির সম্ভাবনা।`,
    IRRIGATE_HOLD: () => '💧 এখনই সেচ দরকার নেই: মাটির আর্দ্রতা ও বৃষ্টি আগামী ২ দিনের জন্য যথেষ্ট। কাল আবার দেখুন।',
    HARVEST_OK: v => `🌾 ফসল তোলা বা শুকানোর ভালো দিন: ${v.d} (প্রায় বৃষ্টি নেই)।`,
    TRAVEL_CLEAR: v => `🚗 ভ্রমণের সেরা সময়: ${v.d}, ${v.fr}–${v.to} (শুকনো)।`,
    TRAVEL_RAIN: v => `☔ বৃষ্টির সম্ভাবনা: ${v.d}, ${v.fr}–${v.to}। তখন গাড়ি চালানো এড়ান বা বাড়তি সময় রাখুন।`,
    TRAVEL_MIXED: () => '🚗 মিশ্র আবহাওয়া: ছাতা রাখুন এবং বেরোনোর আগে আবার দেখুন।',
    SEA_SAFE: v => `🎣 সমুদ্রে তুলনামূলক নিরাপদ সময়: ${v.d}, ${v.fr}–${v.to} (দমকা বাতাস ৩০ কিমি/ঘণ্টার কম)।`,
    SEA_UNSAFE: v => `⛔ সমুদ্রে যাওয়া ঠিক নয়: দমকা বাতাস ${v.gust} কিমি/ঘণ্টা পর্যন্ত${v.wave ? `, ঢেউ ${v.wave} মিটার পর্যন্ত` : ''}। মৎস্য দপ্তর ও কোস্ট গার্ডের সতর্কতা মানুন।`,
    HEAT_AVOID: v => `🥵 ভারী বাইরের কাজ এড়ান ${v.d}, ${v.fr}–${v.to} (অনুভূত ৩৮ °C বা বেশি)। জল ও ছায়ায় বিরতি নিন।`,
    WORK_WINDOW: v => `🛠️ কাজের সেরা সময়: ${v.d}, ${v.fr}–${v.to} (ঠান্ডা)।`,
    HEAT_OK: () => '🛠️ আগামী ২ দিনে বিপজ্জনক গরম দেখা যাচ্ছে না। তবুও নিয়মিত জল পান করুন।',
    WORK_RAIN: v => `🌧️ বৃষ্টির সম্ভাবনা ${v.d}, ${v.fr}–${v.to}: সামগ্রী ঢেকে রাখুন, উঁচুতে কাজ করবেন না।`,
    head: { farmer: 'চাষের পরামর্শ', traveller: 'ভ্রমণের পরামর্শ', fisherman: 'মাছ ধরার পরামর্শ', worker: 'বাইরের কাজের পরামর্শ' },
    data: s => `📊 আগামী ৪৮ ঘণ্টা: বৃষ্টি ${s.rain_next_48h_mm} মিমি · বাতাস ${s.max_wind_kmh} কিমি/ঘণ্টা পর্যন্ত · সর্বোচ্চ ${s.max_temp_c}°C${s.soil_moisture != null ? ` · মাটির আর্দ্রতা ${s.soil_moisture}` : ''}`,
    disc: 'ℹ️ এটি পূর্বাভাসের তথ্যভিত্তিক মোটামুটি পরামর্শ। স্থানীয় মাটি, ফসল, যান ও নৌকার অবস্থা ভিন্ন হতে পারে; সরকারি সতর্কতা মানুন।'
  }
};

export function renderRec(rec, lang = 'en') {
  const t = T[lang] || T.en, f = t[rec.code];
  if (!f) return '';
  const v = { ...rec.vars };
  if (v.date) v.d = dn(v.date, lang);
  if (v.from != null) v.fr = hh(v.from);
  if (v.to != null) v.to = hh(v.to);
  return f(v);
}
export const adviceHead = (role, lang = 'en') => (T[lang] || T.en).head[role];
export const adviceData = (summary, lang = 'en') => (T[lang] || T.en).data(summary);
export const adviceDisclaimer = (lang = 'en') => (T[lang] || T.en).disc;
