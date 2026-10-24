// Built-in "basic mode": answers weather questions WITHOUT any LLM or API key.
// It detects intent (forecast / alerts / climate) and a place name with simple rules,
// calls the same tools as the AI mode, and formats the answer in English, Hindi or Bengali.

import { getForecast, getAlerts, getClimate } from './tools.js';

const STOP = new Set((
  // English
  "what whats what's is the weather forecast temperature today tomorrow tonight now will it rain raining in at of for how about me tell show please umbrella need do i crop crops farming farm farmer advice alert alerts warning warnings climate average normal history historical monthly are there any this week next days day be a an and when should near my am irrigate irrigation harvest much like does have get current currently check hot cold wet dry going to on rainfall humid hi hello kal mausam ka ki " +
  // Hindi
  "मौसम का की के में कल आज लिए चेतावनी जलवायु खेती सलाह बारिश होगी होगा क्या कैसा कैसी है हैं मैं किसान पास कब करूँ सिंचाई इस हफ़्ते हफ्ते छाता चाहिए कोई पूर्वानुमान तापमान और से पर को " +
  // Bengali
  "আবহাওয়া আবহাওয়ার সতর্কতা জলবায়ু কাল আজ বৃষ্টি হবে কি কী কেমন জন্য চাষের পরামর্শ কোনো আছে আমি চাষি কাছে কখন সেচ দেব এই সপ্তাহে ছাতা লাগবে পূর্বাভাস তাপমাত্রা"
).split(/\s+/));

const stripBn = w => /[ঀ-৿]/.test(w) ? w.replace(/(য়ে|এর|র|ে)$/u, '') : w;

export function extractPlace(text) {
  const tokens = text.replace(/[?!.,।;:()"“”]/g, ' ').split(/\s+/).filter(Boolean);
  const keep = tokens.filter(w => !STOP.has(w.toLowerCase()) && !STOP.has(stripBn(w)));
  const place = keep.map(stripBn).join(' ').trim();
  return place || null;
}

export function parseIntent(text) {
  const s = text.toLowerCase();
  const tokens = s.replace(/[?!.,।]/g, ' ').split(/\s+/);
  return {
    intent: /alert|warning|cyclone|heat ?wave|flood|storm|चेतावनी|সতর্ক/.test(s) ? 'alerts'
          : /climate|average|normal|histor|जलवायु|জলবায়ু/.test(s) ? 'climate' : 'forecast',
    tomorrow: tokens.some(t => ['tomorrow', 'kal', 'कल', 'কাল', 'কালকে'].includes(t)),
    farm: /farm|crop|kisan|harvest|irrigat|खेती|किसान|सिंचाई|চাষ|সেচ/.test(s)
  };
}

/* ---------------- translations ---------------- */
const MON = { en: 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' '),
              hi: ['जन', 'फ़र', 'मार्च', 'अप्रै', 'मई', 'जून', 'जुला', 'अग', 'सित', 'अक्टू', 'नव', 'दिस'],
              bn: ['জানু', 'ফেব্রু', 'মার্চ', 'এপ্রি', 'মে', 'জুন', 'জুলাই', 'আগস্ট', 'সেপ্টে', 'অক্টো', 'নভে', 'ডিসে'] };

const S = {
  en: {
    ask: 'Which place do you mean? For example: "weather in Kolkata", "alerts for Puri" or "climate of Shimla".',
    notFound: p => `I couldn't find a place called "${p}". Please try a nearby city or check the spelling.`,
    err: 'I could not fetch weather data right now. Please check your connection and try again.',
    now: 'now', tomorrow: 'tomorrow', today: 'Today', feels: 'feels like', hum: 'humidity', wind: 'wind', rain: 'rain',
    week: 'Next 7 days', alertsTitle: 'Weather alerts (next 7 days)', none: 'No significant weather hazards in the next 7 days.',
    disc: 'These alerts are calculated from forecast values, not official warnings. Follow IMD (mausam.imd.gov.in) and local authorities. In an emergency call 112.',
    climTitle: 'Climate, last 5-year average', hottest: 'Hottest', coldest: 'Coldest', wettest: 'Wettest', driest: 'Driest', avgTemp: 'avg temp',
    rainHi: '☔ Rain is likely – carry an umbrella and avoid waterlogged routes.', rainMid: '🌂 Some chance of rain – keep an umbrella handy.', rainLo: '✅ Low chance of rain.',
    hot: '🥵 Very hot – drink plenty of water and avoid midday sun.', uv: '🧴 UV index is very high – use sunscreen.',
    farmWet: '🌾 Farming: postpone spraying and fertiliser; check field drainage.', farmDry: '🌾 Farming: good for harvesting and drying; irrigate early morning or evening.', farmOk: '🌾 Farming: normal field work is fine; watch the next 2–3 days for rain.',
    levels: { RED: '🔴 Red', ORANGE: '🟠 Orange' },
    types: { 'Extremely heavy rainfall (flood risk)': 'Extremely heavy rainfall (flood risk)', 'Very heavy rainfall': 'Very heavy rainfall', 'Heavy rainfall': 'Heavy rainfall', 'Severe heatwave': 'Severe heatwave', 'Heatwave conditions': 'Heatwave conditions', 'Thunderstorm': 'Thunderstorm', 'Very strong winds': 'Very strong winds', 'Strong winds': 'Strong winds' },
    cond: {}, locale: 'en-IN'
  },
  hi: {
    ask: 'आप किस स्थान की बात कर रहे हैं? जैसे: "कोलकाता का मौसम", "पुरी के लिए चेतावनी" या "शिमला की जलवायु"।',
    notFound: p => `"${p}" नाम का स्थान नहीं मिला। पास का कोई शहर आज़माएँ या वर्तनी जाँचें।`,
    err: 'अभी मौसम का डेटा नहीं मिल पाया। इंटरनेट जाँचकर फिर कोशिश करें।',
    now: 'अभी', tomorrow: 'कल', today: 'आज', feels: 'महसूस', hum: 'नमी', wind: 'हवा', rain: 'बारिश',
    week: 'अगले 7 दिन', alertsTitle: 'मौसम चेतावनी (अगले 7 दिन)', none: 'अगले 7 दिनों में कोई बड़ा मौसमी खतरा नहीं दिख रहा।',
    disc: 'ये चेतावनियाँ पूर्वानुमान के आँकड़ों से बनी हैं, आधिकारिक चेतावनी नहीं। IMD (mausam.imd.gov.in) और स्थानीय प्रशासन की सूचना मानें। आपात स्थिति में 112 पर कॉल करें।',
    climTitle: 'जलवायु, पिछले 5 वर्षों का औसत', hottest: 'सबसे गर्म', coldest: 'सबसे ठंडा', wettest: 'सबसे ज़्यादा बारिश', driest: 'सबसे सूखा', avgTemp: 'औसत तापमान',
    rainHi: '☔ बारिश की संभावना अधिक – छाता रखें, जलभराव वाले रास्तों से बचें।', rainMid: '🌂 थोड़ी बारिश संभव – छाता साथ रखें।', rainLo: '✅ बारिश की संभावना कम।',
    hot: '🥵 बहुत गर्मी – खूब पानी पिएँ, दोपहर की धूप से बचें।', uv: '🧴 UV बहुत अधिक – सनस्क्रीन लगाएँ।',
    farmWet: '🌾 खेती: छिड़काव और खाद टालें; खेत में जल निकासी जाँचें।', farmDry: '🌾 खेती: कटाई/सुखाने के लिए अच्छा; सिंचाई सुबह या शाम करें।', farmOk: '🌾 खेती: सामान्य कार्य ठीक; अगले 2–3 दिन बारिश पर नज़र रखें।',
    levels: { RED: '🔴 लाल', ORANGE: '🟠 नारंगी' },
    types: { 'Extremely heavy rainfall (flood risk)': 'अत्यधिक भारी वर्षा (बाढ़ का खतरा)', 'Very heavy rainfall': 'बहुत भारी वर्षा', 'Heavy rainfall': 'भारी वर्षा', 'Severe heatwave': 'भीषण लू', 'Heatwave conditions': 'लू जैसी स्थिति', 'Thunderstorm': 'आँधी-तूफ़ान', 'Very strong winds': 'बहुत तेज़ हवाएँ', 'Strong winds': 'तेज़ हवाएँ' },
    cond: { 'Clear sky': 'साफ़ आसमान', 'Mostly clear': 'ज़्यादातर साफ़', 'Partly cloudy': 'आंशिक बादल', 'Overcast': 'घने बादल', 'Fog': 'कोहरा', 'Rime fog': 'कोहरा', 'Light drizzle': 'हल्की फुहार', 'Drizzle': 'फुहार', 'Heavy drizzle': 'तेज़ फुहार', 'Light rain': 'हल्की बारिश', 'Rain': 'बारिश', 'Heavy rain': 'भारी बारिश', 'Light snow': 'हल्की बर्फ़बारी', 'Snow': 'बर्फ़बारी', 'Heavy snow': 'भारी बर्फ़बारी', 'Rain showers': 'बौछारें', 'Violent rain showers': 'तेज़ बौछारें', 'Thunderstorm': 'आँधी-तूफ़ान', 'Thunderstorm with hail': 'ओलों के साथ तूफ़ान', 'Severe thunderstorm with hail': 'ओलों के साथ भीषण तूफ़ान' },
    locale: 'hi-IN'
  },
  bn: {
    ask: 'কোন জায়গার কথা বলছেন? যেমন: "কলকাতার আবহাওয়া", "পুরীর সতর্কতা" বা "শিমলার জলবায়ু"।',
    notFound: p => `"${p}" নামের জায়গা খুঁজে পাইনি। কাছের কোনো শহর চেষ্টা করুন বা বানান দেখুন।`,
    err: 'এখন আবহাওয়ার তথ্য আনা যাচ্ছে না। ইন্টারনেট দেখে আবার চেষ্টা করুন।',
    now: 'এখন', tomorrow: 'আগামীকাল', today: 'আজ', feels: 'অনুভূত', hum: 'আর্দ্রতা', wind: 'বাতাস', rain: 'বৃষ্টি',
    week: 'আগামী ৭ দিন', alertsTitle: 'আবহাওয়া সতর্কতা (আগামী ৭ দিন)', none: 'আগামী ৭ দিনে বড় কোনো আবহাওয়া ঝুঁকি দেখা যাচ্ছে না।',
    disc: 'এই সতর্কতা পূর্বাভাসের সংখ্যা থেকে তৈরি, সরকারি সতর্কতা নয়। IMD (mausam.imd.gov.in) ও স্থানীয় প্রশাসনের নির্দেশ মানুন। জরুরি অবস্থায় ১১২ নম্বরে ফোন করুন।',
    climTitle: 'জলবায়ু, গত ৫ বছরের গড়', hottest: 'সবচেয়ে গরম', coldest: 'সবচেয়ে ঠান্ডা', wettest: 'সবচেয়ে বেশি বৃষ্টি', driest: 'সবচেয়ে শুকনো', avgTemp: 'গড় তাপমাত্রা',
    rainHi: '☔ বৃষ্টির সম্ভাবনা বেশি – ছাতা রাখুন, জলমগ্ন রাস্তা এড়ান।', rainMid: '🌂 সামান্য বৃষ্টির সম্ভাবনা – ছাতা সঙ্গে রাখুন।', rainLo: '✅ বৃষ্টির সম্ভাবনা কম।',
    hot: '🥵 প্রচণ্ড গরম – প্রচুর জল পান করুন, দুপুরের রোদ এড়ান।', uv: '🧴 UV খুব বেশি – সানস্ক্রিন লাগান।',
    farmWet: '🌾 চাষ: স্প্রে ও সার দেওয়া পিছিয়ে দিন; জল নিকাশি দেখুন।', farmDry: '🌾 চাষ: ফসল তোলা/শুকানোর ভালো দিন; সকাল বা সন্ধ্যায় সেচ দিন।', farmOk: '🌾 চাষ: স্বাভাবিক কাজ চলবে; পরের ২–৩ দিন বৃষ্টির দিকে নজর রাখুন।',
    levels: { RED: '🔴 লাল', ORANGE: '🟠 কমলা' },
    types: { 'Extremely heavy rainfall (flood risk)': 'অত্যন্ত ভারী বৃষ্টি (বন্যার ঝুঁকি)', 'Very heavy rainfall': 'অতি ভারী বৃষ্টি', 'Heavy rainfall': 'ভারী বৃষ্টি', 'Severe heatwave': 'তীব্র তাপপ্রবাহ', 'Heatwave conditions': 'তাপপ্রবাহের পরিস্থিতি', 'Thunderstorm': 'বজ্রঝড়', 'Very strong winds': 'অতি প্রবল বাতাস', 'Strong winds': 'প্রবল বাতাস' },
    cond: { 'Clear sky': 'পরিষ্কার আকাশ', 'Mostly clear': 'মূলত পরিষ্কার', 'Partly cloudy': 'আংশিক মেঘলা', 'Overcast': 'মেঘলা', 'Fog': 'কুয়াশা', 'Rime fog': 'কুয়াশা', 'Light drizzle': 'হালকা গুঁড়ি বৃষ্টি', 'Drizzle': 'গুঁড়ি বৃষ্টি', 'Heavy drizzle': 'ঘন গুঁড়ি বৃষ্টি', 'Light rain': 'হালকা বৃষ্টি', 'Rain': 'বৃষ্টি', 'Heavy rain': 'ভারী বৃষ্টি', 'Light snow': 'হালকা তুষারপাত', 'Snow': 'তুষারপাত', 'Heavy snow': 'ভারী তুষারপাত', 'Rain showers': 'বৃষ্টির ঝাপটা', 'Violent rain showers': 'প্রবল বৃষ্টির ঝাপটা', 'Thunderstorm': 'বজ্রঝড়', 'Thunderstorm with hail': 'শিলাবৃষ্টিসহ ঝড়', 'Severe thunderstorm with hail': 'শিলাবৃষ্টিসহ প্রবল ঝড়' },
    locale: 'bn-IN'
  }
};

const icon = c => ({ 'Clear sky': '☀️', 'Mostly clear': '🌤️', 'Partly cloudy': '⛅', 'Overcast': '☁️', 'Fog': '🌫️', 'Rime fog': '🌫️' }[c]
  ?? (/drizzle/i.test(c) ? '🌦️' : /thunder/i.test(c) ? '⛈️' : /snow/i.test(c) ? '❄️' : /rain|shower/i.test(c) ? '🌧️' : '🌡️'));

/* ---------------- formatters ---------------- */
function adviceLines(day, tomorrowOrToday, farm, s) {
  const out = [];
  const pop = day.rain_probability_pct ?? 0, mm = day.rain_mm ?? 0;
  out.push(pop >= 60 || mm >= 10 ? s.rainHi : pop >= 30 ? s.rainMid : s.rainLo);
  if (day.max >= 38) out.push(s.hot);
  if (day.uv_index >= 8) out.push(s.uv);
  if (farm) out.push(pop >= 60 ? s.farmWet : (pop < 30 && day.max >= 33) ? s.farmDry : s.farmOk);
  return out;
}
const dayName = (iso, s) => new Date(iso + 'T12:00:00').toLocaleDateString(s.locale, { weekday: 'short', day: 'numeric', month: 'short' });
const tc = (c, s) => s.cond[c] ?? c;

function formatForecast(f, q, s) {
  const c = f.current, d0 = f.daily[0], d1 = f.daily[1] ?? f.daily[0];
  const lines = [];
  if (q.tomorrow) {
    lines.push(`**${f.place} – ${s.tomorrow}**`);
    lines.push(`${icon(d1.condition)} ${tc(d1.condition, s)} · ${Math.round(d1.max)}° / ${Math.round(d1.min)}°C · ${s.rain} ${d1.rain_probability_pct}%${d1.rain_mm ? ` (${d1.rain_mm} mm)` : ''}`);
  } else {
    lines.push(`**${f.place} – ${s.now}**`);
    lines.push(`🌡️ **${Math.round(c.temperature)}°C** (${s.feels} ${Math.round(c.feels_like)}°C) · ${icon(c.condition)} ${tc(c.condition, s)} · ${s.hum} ${c.humidity_pct}% · ${s.wind} ${Math.round(c.wind_kmh)} km/h`);
  }
  lines.push('');
  lines.push(...adviceLines(q.tomorrow ? d1 : d0, q.tomorrow, q.farm, s).map(x => `- ${x}`));
  lines.push('');
  lines.push(`**${s.week}**`);
  f.daily.forEach((d, i) => lines.push(`- **${i === 0 ? s.today : dayName(d.date, s)}**: ${icon(d.condition)} ${Math.round(d.max)}° / ${Math.round(d.min)}° · ${s.rain} ${d.rain_probability_pct}%`));
  return lines.join('\n');
}

function formatAlerts(a, s) {
  const lines = [`**${a.place} – ${s.alertsTitle}**`];
  if (!a.alerts.length) lines.push(`✅ ${s.none}`);
  else a.alerts.forEach(x => lines.push(`- ${s.levels[x.level] ?? x.level} · **${dayName(x.date, s)}**: ${s.types[x.type] ?? x.type} (${x.value})`));
  lines.push('', `ℹ️ ${s.disc}`);
  return lines.join('\n');
}

function formatClimate(c, s) {
  const m = c.monthly, mn = MON[s === S.hi ? 'hi' : s === S.bn ? 'bn' : 'en'];
  const by = (k, max) => m.reduce((b, x, i) => (max ? x[k] > m[b][k] : x[k] < m[b][k]) ? i : b, 0);
  const hot = by('avg_temp_c', true), cold = by('avg_temp_c', false), wet = by('avg_rain_mm', true), dry = by('avg_rain_mm', false);
  const lines = [`**${c.place} – ${s.climTitle} (${c.period.split(' ')[0]})**`,
    `- 🔥 ${s.hottest}: **${mn[hot]}** (${m[hot].avg_temp_c}°C)`,
    `- 🥶 ${s.coldest}: **${mn[cold]}** (${m[cold].avg_temp_c}°C)`,
    `- 🌧️ ${s.wettest}: **${mn[wet]}** (${m[wet].avg_rain_mm} mm)`,
    `- 🏜️ ${s.driest}: **${mn[dry]}** (${m[dry].avg_rain_mm} mm)`, ''];
  for (let i = 0; i < 12; i += 4)
    lines.push(m.slice(i, i + 4).map((x, k) => `${mn[i + k]} ${x.avg_temp_c}° / ${x.avg_rain_mm} mm`).join(' · '));
  return lines.join('\n');
}

/* ---------------- entry point ---------------- */
export async function answerBasic(messages, lang = 'en') {
  const s = S[lang] || S.en;
  const users = messages.filter(m => m.role === 'user').map(m => m.content);
  const last = users[users.length - 1] || '';
  const q = parseIntent(last);

  let place = extractPlace(last);
  for (let i = users.length - 2; !place && i >= 0; i--) place = extractPlace(users[i]); // remember earlier place
  if (!place) return { reply: s.ask, tools_used: [] };

  const tools_used = [];
  try {
    let text;
    if (q.intent === 'alerts') { tools_used.push({ name: 'get_alerts', input: { place } }); text = formatAlerts(await getAlerts({ place }), s); }
    else if (q.intent === 'climate') { tools_used.push({ name: 'get_climate', input: { place } }); text = formatClimate(await getClimate({ place }), s); }
    else { tools_used.push({ name: 'get_forecast', input: { place } }); text = formatForecast(await getForecast({ place }), q, s); }
    return { reply: text, tools_used };
  } catch (e) {
    if (/Could not find a place/.test(e.message)) return { reply: s.notFound(place), tools_used };
    console.error(e);
    return { reply: s.err, tools_used };
  }
}
