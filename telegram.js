// Free Telegram bot. Runs only if TELEGRAM_BOT_TOKEN is set in .env.
// It uses "long polling" (the bot asks Telegram for new messages), so it needs no public URL.
// It works while this app is running (e.g. on your computer during a demo).

import { reply } from './brain.js';

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
export let botUsername = null;
const API = `https://api.telegram.org/bot${TOKEN}`;

const chats = new Map(); // chatId -> { lang, history }
const WELCOME = {
  en: "Hi! I'm WeatherGPT 🌦️\nAsk me for a forecast, weather alerts or climate info for any place, e.g. \"weather in Kolkata\" or \"alerts for Puri\".\nLanguage: /english  /hindi  /bengali",
  hi: "नमस्ते! मैं WeatherGPT हूँ 🌦️\nकिसी भी स्थान का मौसम, चेतावनी या जलवायु पूछें, जैसे \"कोलकाता का मौसम\"।\nभाषा: /english  /hindi  /bengali",
  bn: "নমস্কার! আমি WeatherGPT 🌦️\nযেকোনো জায়গার আবহাওয়া, সতর্কতা বা জলবায়ু জিজ্ঞাসা করুন, যেমন \"কলকাতার আবহাওয়া\"।\nভাষা: /english  /hindi  /bengali"
};
const LANGS = { '/english': 'en', '/hindi': 'hi', '/bengali': 'bn' };

async function tg(method, body) {
  const r = await fetch(`${API}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(45000) });
  return r.json();
}
const plain = s => s.replace(/\*\*/g, '').slice(0, 4000);

async function handle(msg) {
  const id = msg.chat.id, text = (msg.text || '').trim();
  if (!text) return;
  const st = chats.get(id) || { lang: 'en', history: [] };
  chats.set(id, st);

  const cmd = text.split(/\s|@/)[0].toLowerCase();
  if (cmd === '/start' || cmd === '/help') return tg('sendMessage', { chat_id: id, text: WELCOME[st.lang] });
  if (LANGS[cmd]) { st.lang = LANGS[cmd]; st.history = []; return tg('sendMessage', { chat_id: id, text: WELCOME[st.lang] }); }

  tg('sendChatAction', { chat_id: id, action: 'typing' }).catch(() => {});
  st.history.push({ role: 'user', content: text });
  try {
    const out = await reply(st.history, st.lang);
    st.history.push({ role: 'assistant', content: out.reply });
    st.history = st.history.slice(-20);
    await tg('sendMessage', { chat_id: id, text: plain(out.reply) });
  } catch (e) {
    st.history.pop();
    console.error('telegram handler error:', e.message);
    await tg('sendMessage', { chat_id: id, text: 'Sorry, something went wrong. Please try again.' });
  }
}

export async function startTelegram() {
  if (!TOKEN) { console.log('Telegram bot: not started (no TELEGRAM_BOT_TOKEN found).'); return; }
  const me = await tg('getMe', {}).catch(() => null);
  if (!me?.ok) { console.error('Telegram: token looks wrong (getMe failed). Bot not started.'); return; }
  await tg('deleteWebhook', {}).catch(() => {});
  botUsername = me.result.username;
  console.log(`Telegram bot running: https://t.me/${me.result.username}`);

  let offset = 0;
  (async function loop() {
    for (;;) {
      try {
        const res = await tg('getUpdates', { offset, timeout: 30, allowed_updates: ['message'] });
        for (const u of res.result || []) { offset = u.update_id + 1; if (u.message) handle(u.message); }
      } catch (e) {
        console.error('Telegram polling error:', e.message);
        await new Promise(r => setTimeout(r, 5000));
      }
    }
  })();
}
