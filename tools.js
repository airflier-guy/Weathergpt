// Weather tools that Claude can call. Data source: Open-Meteo (free, no API key, non-commercial use).

const GEO = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST = 'https://api.open-meteo.com/v1/forecast';
const ARCHIVE = 'https://archive-api.open-meteo.com/v1/archive';

const WMO = {
  0: 'Clear sky', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Rime fog',
  51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle', 61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
  71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 80: 'Rain showers', 81: 'Rain showers', 82: 'Violent rain showers',
  95: 'Thunderstorm', 96: 'Thunderstorm with hail', 99: 'Severe thunderstorm with hail'
};

async function getJSON(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`Upstream error ${r.status}`);
  return r.json();
}

async function geocode(place) {
  const g = await getJSON(`${GEO}?name=${encodeURIComponent(place)}&count=1&language=en`);
  if (!g.results?.length) throw new Error(`Could not find a place called "${place}"`);
  const p = g.results[0];
  return { lat: p.latitude, lon: p.longitude, name: [p.name, p.admin1, p.country].filter(Boolean).join(', ') };
}

async function rawForecast(loc, days = 7) {
  const url = `${FORECAST}?latitude=${loc.lat}&longitude=${loc.lon}` +
    `&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,precipitation` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,wind_speed_10m_max,uv_index_max` +
    `&timezone=auto&forecast_days=${days}`;
  return getJSON(url);
}

export async function getForecast({ place, days = 7 }) {
  const loc = await geocode(place);
  const w = await rawForecast(loc, Math.min(Math.max(days, 1), 7));
  const d = w.daily;
  return {
    place: loc.name,
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
