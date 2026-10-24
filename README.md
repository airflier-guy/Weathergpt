# WeatherGPT

Conversational AI for weather forecasting, alerts and climate information (Smart India Hackathon).

Users chat in English, Hindi or Bengali (typed or by voice). Claude decides which weather tool to call, reads the live data and answers with practical advice for travel, health and farming.

## How it works

```
Browser (public/index.html)
   │  POST /api/chat  {messages, lang}
   ▼
Express server (server.js)
   │  Claude tool-use loop
   ├─ get_forecast  → Open-Meteo forecast API (current + 7 days)
   ├─ get_alerts    → forecast + IMD-style rainfall/heat/wind thresholds
   └─ get_climate   → Open-Meteo ERA5 archive (5-year monthly averages)
```

## Run it (beginner steps)

**Easiest on Windows:** install Node.js, extract the zip, then double-click `start.bat`. It installs and starts everything and opens your browser.

Manual steps:

1. Install **Node.js** (the "LTS" version) from https://nodejs.org and restart your computer if asked.
2. Unzip this folder. Open a terminal **inside** the `weathergpt` folder
   (Windows: open the folder, click the address bar, type `cmd`, press Enter. Mac: right-click the folder > "New Terminal at Folder").
3. Type `npm install` and press Enter. Wait until it finishes (needs internet, about a minute).
4. Type `npm start` and press Enter. You should see: `WeatherGPT running at http://localhost:3000`.
5. Open http://localhost:3000 in your browser. Keep the terminal window open while you use the app. Press Ctrl+C in it to stop.

**No API key is needed.** Without a key the app runs in *basic mode* (rule-based, live data).

**Free AI mode:** put a free Google Gemini key in `.env` (`GEMINI_API_KEY=...`) and restart. If the AI is unavailable or out of free quota, the app automatically falls back to basic mode.

**Free Telegram bot:** put your bot token in `.env` (`TELEGRAM_BOT_TOKEN=...`) and restart.

See `GUIDE` (the step-by-step guide) for details. `/api/health` shows the active mode.

## Files

| File | Purpose |
|------|---------|
| `server.js` | Express server, system prompt, Claude tool-use loop, rate limiting |
| `brain.js` | Chooses Gemini / Claude / basic mode, with automatic fallback |
| `telegram.js` | Free Telegram bot (optional) |
| `fallback.js` | Basic (no API key) mode: rule-based question understanding + answers in EN/HI/BN |
| `tools.js` | Tool definitions and Open-Meteo implementations |
| `public/index.html` | Chat UI (language switch, voice in/out, quick-start chips) |

## Important limits

- **Alerts are not official warnings.** They are derived from forecast values using IMD-style thresholds. The assistant always tells users to follow IMD (mausam.imd.gov.in) and local authorities. Integrating an official feed (IMD or NDMA SACHET CAP alerts) is the key upgrade for production.
- Open-Meteo's free tier is for non-commercial use. Switch to a paid plan or another provider before commercial deployment.
- The rate limiter is in-memory and per-process; use a proper store (e.g. Redis) when running several instances.
- Hindi and Bengali UI text should be reviewed by native speakers.

## Ideas for next steps

- Official IMD / NDMA alert integration
- Location from the device GPS and village-level lookup
- SMS / WhatsApp channel for low-connectivity farmers
- Crop-specific advisories (sowing, spraying, irrigation windows)
- Save user places and push alerts
