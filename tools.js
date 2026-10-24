// Weather tools that Claude can call.
// Main source: Open-Meteo (free, no key). Backup when Open-Meteo refuses (e.g. 429 on shared cloud servers):
// MET Norway (free, no key) for forecasts and OpenStreetMap Nominatim for finding places.

const GEO = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST = 'https://api.open-meteo.com/v1/forecast';
const ARCHIVE = 'https://archive-api.open-meteo.com/v1/archive';
export const VERSION = '2026-10-24-c';
const UA = `WeatherGPT/${VERSION} (+${process.env.RENDER_EXTERNAL_URL || 'https://github.com/weathergpt-sih'}; student hackathon project)`;
const MET = 'https://api.met.no/weatherapi/locationforecast/2.0/compact';
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';

const WMO = {
  0: 'Clear sky', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Rime fog',
  51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle', 61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
  71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 80: 'Rain showers', 81: 'Rain showers', 82: 'Violent rain showers',
  95: 'Thunderstorm', 96: 'Thunderstorm with hail', 99: 'Severe thunderstorm with hail'
};

async function getJSON(url) {
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': UA } });
      if (r.ok) return r.json();
      const body = (await r.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 120);
      const err = new Error(`Upstream error ${r.status}${body ? ': ' + body : ''}`); err.status = r.status; lastErr = err;
      if (r.status !== 429 && r.status < 500) throw err; // no point retrying a 4xx like 400/404
    } catch (e) { lastErr = e; if (e.status && e.status !== 429 && e.status < 500) throw e; }
    if (attempt === 0) await new Promise(res => setTimeout(res, 1200)); // wait a moment, then retry once
  }
  throw lastErr;
}

async function geocodeNominatim(place) {
  const g = await getJSON(`${NOMINATIM}?q=${encodeURIComponent(place)}&format=json&limit=1&accept-language=en`);
  if (!Array.isArray(g) || !g.length) throw new Error(`Could not find a place called "${place}"`);
  const parts = String(g[0].display_name).split(',').map(s => s.trim());
  const name = parts.length > 3 ? [parts[0], parts[parts.length - 3] || parts[1], parts[parts.length - 1]].join(', ') : parts.join(', ');
  return { lat: +g[0].lat, lon: +g[0].lon, name };
}

async function geocode(place) {
  try {
    const g = await getJSON(`${GEO}?name=${encodeURIComponent(place)}&count=1&language=en`);
    if (g.results?.length) {
      const p = g.results[0];
      return { lat: p.latitude, lon: p.longitude, name: [p.name, p.admin1, p.country].filter(Boolean).join(', ') };
    }
  } catch (e) { console.error(`Open-Meteo place search failed (${e.message}); trying OpenStreetMap.`); }
  return geocodeNominatim(place); // also used when Open-Meteo simply does not know the place
}

async function openMeteoForecast(loc, days) {
  const url = `${FORECAST}?latitude=${loc.lat}&longitude=${loc.lon}` +
    `&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,precipitation` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,wind_speed_10m_max,uv_index_max` +
    `&timezone=auto&forecast_days=${days}`;
  return getJSON(url);
}

// ---- MET Norway backup, converted to the same shape Open-Meteo returns ----
const tzOffsetHours = (lat, lon) => (lat > 6 && lat < 36 && lon > 68 && lon < 98) ? 5.5 : Math.round(lon / 15); // India = UTC+5:30
function symbolToWmo(sym = '') {
  const s = sym.replace(/_(day|night|polartwilight)$/, '');
  if (/thunder/.test(s)) return 95;
  if (/snow|sleet/.test(s)) return /heavy/.test(s) ? 75 : /light/.test(s) ? 71 : 73;
  if (/showers/.test(s)) return /heavy/.test(s) ? 82 : /light/.test(s) ? 80 : 81;
  if (/rain/.test(s)) return /heavy/.test(s) ? 65 : /light/.test(s) ? 61 : 63;
  if (/fog/.test(s)) return 45;
  if (s === 'clearsky') return 0;
  if (s === 'fair') return 1;
  if (s === 'partlycloudy') return 2;
  return 3;
}
const estimateRainChance = mm => mm >= 10 ? 90 : mm >= 2 ? 70 : mm >= 0.5 ? 50 : mm > 0.1 ? 25 : 5; // MET compact has no probability

async function metForecast(loc, days) {
  const j = await getJSON(`${MET}?lat=${loc.lat.toFixed(4)}&lon=${loc.lon.toFixed(4)}`);
  const ts = j.properties.timeseries, off = tzOffsetHours(loc.lat, loc.lon);
  const localDate = iso => new Date(new Date(iso).getTime() + off * 3600e3);
  const byDay = new Map();
  for (const e of ts) {
    const L = localDate(e.time), key = L.toISOString().slice(0, 10);
    if (!byDay.has(key)) byDay.set(key, { tmax: -99, tmin: 99, rain: 0, wind: 0, sym: null, dist: 99 });
    const d = byDay.get(key), i = e.data.instant.details;
    if (i.air_temperature != null) { d.tmax = Math.max(d.tmax, i.air_temperature); d.tmin = Math.min(d.tmin, i.air_temperature); }
    d.wind = Math.max(d.wind, (i.wind_speed || 0) * 3.6);
    const step = e.data.next_1_hours || e.data.next_6_hours;
    if (step) d.rain += step.details?.precipitation_amount || 0;
    const s = (e.data.next_6_hours || e.data.next_1_hours)?.summary?.symbol_code, dist = Math.abs(L.getUTCHours() - 12);
    if (s && dist < d.dist) { d.sym = s; d.dist = dist; }
  }
  const keys = [...byDay.keys()].sort().slice(0, days);
  const first = ts[0], c = first.data.instant.details;
  const T = c.air_temperature, RH = c.relative_humidity ?? 50, ws = c.wind_speed ?? 0;
  const e = RH / 100 * 6.105 * Math.exp(17.27 * T / (237.7 + T));
  const feels = Math.round((T + 0.33 * e - 0.70 * ws - 4.0) * 10) / 10;
  const sym0 = (first.data.next_1_hours || first.data.next_6_hours)?.summary?.symbol_code;
  const r1 = x => Math.round(x * 10) / 10;
  return {
    _source: 'MET Norway (backup)',
    current: { temperature_2m: T, relative_humidity_2m: RH, apparent_temperature: feels, weather_code: symbolToWmo(sym0), wind_speed_10m: r1(ws * 3.6), precipitation: first.data.next_1_hours?.details?.precipitation_amount ?? 0 },
    daily: {
      time: keys,
      weather_code: keys.map(k => symbolToWmo(byDay.get(k).sym)),
      temperature_2m_max: keys.map((k, n) => r1(n === 0 ? Math.max(byDay.get(k).tmax, T) : byDay.get(k).tmax)),
      temperature_2m_min: keys.map((k, n) => r1(n === 0 ? Math.min(byDay.get(k).tmin, T) : byDay.get(k).tmin)),
      precipitation_probability_max: keys.map(k => estimateRainChance(byDay.get(k).rain)),
      precipitation_sum: keys.map(k => r1(byDay.get(k).rain)),
      wind_speed_10m_max: keys.map(k => r1(byDay.get(k).wind)),
      uv_index_max: keys.map(() => null)
    }
  };
}

async function rawForecast(loc, days = 7) {
  try { return await openMeteoForecast(loc, days); }
  catch (e) {
    console.error(`Open-Meteo forecast failed (${e.message}). Using MET Norway backup.`);
    return metForecast(loc, days);
  }
}

export async function getForecast({ place, days = 7 }) {
  const loc = await geocode(place);
  const w = await rawForecast(loc, Math.min(Math.max(days, 1), 7));
  const d = w.daily;
  return {
    place: loc.name,
    source: w._source || 'Open-Meteo',
    units: 'Celsius, km/h, mm',
    current: {
      temperature: w.current.temperature_2m,
      feels_like: w.current.apparent_temperature,
      humidity_pct: w.current.relative_humidity_2m,
      wind_kmh: w.current.wind_speed_10m,
      condition: WMO[w.current.weather_code] ?? 'Unknown'
    },
    daily: d.time.map((date, i) => ({
      date,
      condition: WMO[d.weather_code[i]] ?? 'Unknown',
      max: d.temperature_2m_max[i],
      min: d.temperature_2m_min[i],
      rain_probability_pct: d.precipitation_probability_max[i],
      rain_mm: d.precipitation_sum[i],
      max_wind_kmh: d.wind_speed_10m_max[i],
      uv_index: d.uv_index_max[i]
    }))
  };
}

// Alerts are derived from forecast values using IMD-style thresholds.
// They are NOT official warnings; the assistant must say so.
export async function getAlerts({ place }) {
  const loc = await geocode(place);
  const w = await rawForecast(loc, 7);
  const d = w.daily, alerts = [];
  d.time.forEach((date, i) => {
    const mm = d.precipitation_sum[i], tmax = d.temperature_2m_max[i], wind = d.wind_speed_10m_max[i], code = d.weather_code[i];
    if (mm >= 204.5) alerts.push({ date, level: 'RED', type: 'Extremely heavy rainfall (flood risk)', value: `${mm} mm` });
    else if (mm >= 115.6) alerts.push({ date, level: 'RED', type: 'Very heavy rainfall', value: `${mm} mm` });
    else if (mm >= 64.5) alerts.push({ date, level: 'ORANGE', type: 'Heavy rainfall', value: `${mm} mm` });
    if (tmax >= 45) alerts.push({ date, level: 'RED', type: 'Severe heatwave', value: `${tmax} C` });
    else if (tmax >= 40) alerts.push({ date, level: 'ORANGE', type: 'Heatwave conditions', value: `${tmax} C` });
    if (code >= 95) alerts.push({ date, level: 'ORANGE', type: 'Thunderstorm', value: WMO[code] });
    if (wind >= 75) alerts.push({ date, level: 'RED', type: 'Very strong winds', value: `${wind} km/h` });
    else if (wind >= 50) alerts.push({ date, level: 'ORANGE', type: 'Strong winds', value: `${wind} km/h` });
  });
  return {
    place: loc.name,
    generated_from: 'Open-Meteo forecast with IMD-style rainfall/heat thresholds (not official warnings)',
    alerts,
    note: alerts.length ? undefined : 'No threshold breaches in the next 7 days.'
  };
}

export async function getClimate({ place }) {
  const loc = await geocode(place);
  const end = new Date().getFullYear() - 1, start = end - 4;
  const a = await getJSON(`${ARCHIVE}?latitude=${loc.lat}&longitude=${loc.lon}&start_date=${start}-01-01&end_date=${end}-12-31&daily=temperature_2m_mean,precipitation_sum&timezone=auto`);
  const tSum = Array(12).fill(0), tN = Array(12).fill(0), rSum = Array(12).fill(0);
  a.daily.time.forEach((d, i) => {
    const m = +d.slice(5, 7) - 1;
    if (a.daily.temperature_2m_mean[i] != null) { tSum[m] += a.daily.temperature_2m_mean[i]; tN[m]++; }
    rSum[m] += a.daily.precipitation_sum[i] || 0;
  });
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return {
    place: loc.name,
    period: `${start}-${end} (ERA5 reanalysis)`,
    monthly: names.map((month, m) => ({
      month,
      avg_temp_c: +(tSum[m] / (tN[m] || 1)).toFixed(1),
      avg_rain_mm: +(rSum[m] / 5).toFixed(0)
    }))
  };
}

const placeProp = { type: 'string', description: 'City, town or district name, e.g. "Kolkata" or "Puri, Odisha"' };

export const TOOLS = [
  {
    name: 'get_forecast',
    description: 'Get current weather and a daily forecast (up to 7 days) for a place: temperature, rain chance and amount, wind, UV, conditions.',
    input_schema: { type: 'object', properties: { place: placeProp, days: { type: 'integer', description: 'Number of days, 1-7 (default 7)' } }, required: ['place'] }
  },
  {
    name: 'get_alerts',
    description: 'Check the next 7 days for hazardous weather (heavy rain, heatwave, thunderstorm, strong wind) for a place. Derived from forecast thresholds, not official IMD warnings.',
    input_schema: { type: 'object', properties: { place: placeProp }, required: ['place'] }
  },
  {
    name: 'get_climate',
    description: 'Get climate information for a place: average monthly temperature and rainfall over the last 5 years.',
    input_schema: { type: 'object', properties: { place: placeProp }, required: ['place'] }
  }
];

const IMPL = { get_forecast: getForecast, get_alerts: getAlerts, get_climate: getClimate };

export async function runTool(name, input) {
  const fn = IMPL[name];
  if (!fn) throw new Error(`Unknown tool ${name}`);
  return fn(input || {});
}

// ---- Diagnostics: tests each outside service from THIS server and reports what worked ----
export async function diagnose() {
  const check = async (name, url, opts = {}) => {
    const t0 = Date.now();
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(9000), headers: { 'User-Agent': UA }, ...opts });
      return { name, ok: r.ok, status: r.status, ms: Date.now() - t0 };
    } catch (e) { return { name, ok: false, status: 'no connection', ms: Date.now() - t0, why: e.cause?.code || e.message }; }
  };
  const results = await Promise.all([
    check('Open-Meteo places', `${GEO}?name=Kolkata&count=1`),
    check('Open-Meteo forecast', `${FORECAST}?latitude=22.57&longitude=88.36&current=temperature_2m`),
    check('Open-Meteo climate archive', `${ARCHIVE}?latitude=22.57&longitude=88.36&start_date=2024-01-01&end_date=2024-01-02&daily=temperature_2m_mean`),
    check('MET Norway forecast (backup)', `${MET}?lat=22.57&lon=88.36`),
    check('OpenStreetMap places (backup)', `${NOMINATIM}?q=Kolkata&format=json&limit=1`),
    check('Telegram', 'https://api.telegram.org/'),
  ]);
  return { version: VERSION, server_time: new Date().toISOString(), results };
}
