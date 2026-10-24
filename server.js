import './env.js';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { reply, MODE } from './brain.js';
import { diagnose, VERSION } from './tools.js';
import { startTelegram, telegramRoutes, botUsername } from './telegram.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const app = express();
app.set('trust proxy', 1); // correct client IP behind hosts like Render
app.use(express.json({ limit: '50kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// very small in-memory rate limiter: 30 requests / minute / IP
const hits = new Map();
app.use(['/api/chat', '/api/diag'], (req, res, next) => {
  const now = Date.now(), ip = req.ip;
  const list = (hits.get(ip) || []).filter(t => now - t < 60000);
  if (list.length >= 30) return res.status(429).json({ error: 'Too many requests. Please wait a minute.' });
  list.push(now); hits.set(ip, list); next();
});

app.get('/api/diag', async (_req, res) => res.json({ ...(await diagnose()), mode: MODE }));

app.get('/api/health', (_req, res) => res.json({ ok: true, version: VERSION, mode: MODE, telegram: Boolean(process.env.TELEGRAM_BOT_TOKEN), telegram_url: botUsername ? `https://t.me/${botUsername}` : null }));

app.post('/api/chat', async (req, res) => {
  const { messages, lang = 'en' } = req.body || {};
  if (!Array.isArray(messages) || !messages.length) return res.status(400).json({ error: 'messages required' });
  try {
    const out = await reply(messages, lang);
    res.json({ reply: out.reply, tools_used: out.tools_used, engine: out.engine });
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: 'Please send a message.' });
  }
});

telegramRoutes(app);

const server = app.listen(PORT, () => {
  console.log(`WeatherGPT running at http://localhost:${PORT}  (mode: ${MODE})`);
  startTelegram().catch(e => console.error('Telegram start failed:', e.message));
});
server.on('error', e => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\nSTOP: port ${PORT} is already in use.\n` +
      `An OLD copy of WeatherGPT is probably still running in another black window.\n` +
      `Close every black window (or restart the computer), then double-click start again.\n` +
      `The web page you see at localhost:${PORT} may be the OLD copy, which is why your changes do not show.\n`);
  } else console.error('Server error:', e.message);
  process.exit(1);
});
