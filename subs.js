// Telegram subscriptions: morning brief + push alerts. No LLM involved, so it costs no AI quota.
// Storage: a local file by default. Free hosts like Render wipe local files when the server sleeps or redeploys,
// so for lasting subscriptions set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN (free Upstash Redis).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAlerts, geocode } from './tools.js';
import { formatAlerts, buildBrief, strings } from './fallback.js';
import { detectRole } from './advice.js';

const FILE = path.join(process.env.DATA_DIR || path.dirname(fileURLToPath(import.meta.url)), 'data', 'subs.json');
const UP_URL = (process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/$/, ''), UP_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';
export const storageKind = UP_URL && UP_TOKEN ? 'Upstash Redis (lasting)' : 'local file (resets when a free host sleeps)';
const MAX_PER_CHAT = 3, MAX_TOTAL = 500;

async function upstash(cmd) {
  const r = await fetch(UP_URL, { method: 'POST', headers: { Authorization: `Bearer ${UP_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(cmd), signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`Upstash ${r.status}`);
  return (await r.json()).result;
}
async function load() {
  try {
    if (UP_URL && UP_TOKEN) { const v = await upstash(['GET', 'weathergpt:subs']); return v ? JSON.parse(v) : []; }
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch (e) { if (e.code !== 'ENOENT') console.error('Could not load subscriptions:', e.message); return []; }
}
async function save(subs) {
  try {
    if (UP_URL && UP_TOKEN) return await upstash(['SET', 'weathergpt:subs', JSON.stringify(subs)]);
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(subs));
  } catch (e) { console.error('Could not save subscriptions:', e.message); }
}

const T = {
  en: { need: 'Tell me the place, e.g. /subscribe Puri  or  /subscribe Ludhiana farmer\nRoles: farmer, traveller, fisherman, worker.', notFound: p => `I couldn't find "${p}". Try a nearby city.`,
        ok: (n, r) => `✅ Subscribed: ${n}${r ? ` (${r})` : ''}.\nYou will get a morning brief around 07:00 IST and an instant message when a heavy rain, heat, thunderstorm or wind alert appears.\n/mysubs to list, /unsubscribe to stop.`,
        limit: `You can follow up to ${MAX_PER_CHAT} places. Use /unsubscribe first.`, none: 'You have no subscriptions. Try /subscribe Puri', list: 'Your subscriptions:', gone: 'Unsubscribed from everything.', full: 'Subscriptions are full right now. Try later.' },
  hi: { need: 'स्थान बताइए, जैसे /subscribe Puri  या  /subscribe Ludhiana farmer\nभूमिकाएँ: farmer, traveller, fisherman, worker।', notFound: p => `"${p}" नहीं मिला। पास का शहर आज़माएँ।`,
        ok: (n, r) => `✅ सदस्यता शुरू: ${n}${r ? ` (${r})` : ''}।\nसुबह लगभग 07:00 IST पर सारांश और भारी बारिश, गर्मी, तूफ़ान या तेज़ हवा की चेतावनी पर तुरंत संदेश मिलेगा।\n/mysubs सूची, /unsubscribe बंद करने के लिए।`,
        limit: `आप अधिकतम ${MAX_PER_CHAT} स्थान फ़ॉलो कर सकते हैं। पहले /unsubscribe करें।`, none: 'कोई सदस्यता नहीं है। आज़माएँ: /subscribe Puri', list: 'आपकी सदस्यताएँ:', gone: 'सभी सदस्यताएँ बंद कर दी गईं।', full: 'अभी सदस्यताएँ भरी हैं। बाद में कोशिश करें।' },
  bn: { need: 'জায়গার নাম দিন, যেমন /subscribe Puri  বা  /subscribe Ludhiana farmer\nভূমিকা: farmer, traveller, fisherman, worker।', notFound: p => `"${p}" খুঁজে পাইনি। কাছের শহর চেষ্টা করুন।`,
        ok: (n, r) => `✅ সাবস্ক্রাইব হয়েছে: ${n}${r ? ` (${r})` : ''}।\nসকাল প্রায় ০৭:০০ IST-এ সারসংক্ষেপ এবং ভারী বৃষ্টি, গরম, ঝড় বা প্রবল বাতাসের সতর্কতায় সঙ্গে সঙ্গে বার্তা পাবেন।\n/mysubs তালিকা, /unsubscribe বন্ধ করতে।`,
        limit: `সর্বোচ্চ ${MAX_PER_CHAT}টি জায়গা ফলো করা যাবে। আগে /unsubscribe করুন।`, none: 'কোনো সাবস্ক্রিপশন নেই। চেষ্টা করুন: /subscribe Puri', list: 'আপনার সাবস্ক্রিপশন:', gone: 'সব সাবস্ক্রিপশন বন্ধ হয়েছে।', full: 'এখন সাবস্ক্রিপশন ভর্তি। পরে চেষ্টা করুন।' }
};

// Handles /subscribe, /unsubscribe, /mysubs. Returns the reply text.
export async function handleSubCommand(chatId, cmd, args, lang) {
  const t = T[lang] || T.en;
  const subs = await load();
  const mine = subs.filter(x => x.chatId === chatId);
  if (cmd === '/mysubs') return mine.length ? `${t.list}\n` + mine.map(x => `- ${x.loc.name}${x.role ? ` (${x.role})` : ''}`).join('\n') : t.none;
  if (cmd === '/unsubscribe') { await save(subs.filter(x => x.chatId !== chatId)); return mine.length ? t.gone : t.none; }
  // /subscribe <place> [role]
  const words = args.trim().split(/\s+/).filter(Boolean);
  let role = null;
  const last = words[words.length - 1] || '';
  if (/^(farmer|traveller|traveler|fisherman|worker)$/i.test(last)) { role = last.toLowerCase().replace('traveler', 'traveller'); words.pop(); }
  else role = detectRole(args);
  const place = words.join(' ');
  if (!place) return t.need;
  if (mine.length >= MAX_PER_CHAT) return t.limit;
  if (subs.length >= MAX_TOTAL) return t.full;
  let loc;
  try { loc = await geocode(place); } catch { return t.notFound(place); }
  const rest = subs.filter(x => !(x.chatId === chatId && x.loc.name === loc.name));
  rest.push({ chatId, lang, role, loc, sent: [], lastBrief: null });
  await save(rest);
  return t.ok(loc.name, role);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
let running = false;

// Called by the hourly timer and by /api/cron. Safe to call often: it remembers what it already sent.
export async function runChecks(send) {
  if (running) return { skipped: true };
  running = true;
  const stats = { subs: 0, alerts: 0, briefs: 0 };
  try {
    const subs = await load();
    stats.subs = subs.length;
    const ist = new Date(Date.now() + 5.5 * 3600e3), today = ist.toISOString().slice(0, 10), hour = ist.getUTCHours();
    for (const sub of subs) {
      const s = strings(sub.lang);
      try {
        const res = await getAlerts({ loc: sub.loc });
        const key = a => `${a.date}|${a.type}|${a.level}`;
        sub.sent = (sub.sent || []).filter(k => k.slice(0, 10) >= today);
        const fresh = res.alerts.filter(a => !sub.sent.includes(key(a)));
        if (fresh.length) {
          await send(sub.chatId, `${s.alertNew}\n\n` + formatAlerts({ ...res, alerts: fresh }, s));
          sub.sent.push(...fresh.map(key)); stats.alerts++;
        }
        if (hour >= 7 && sub.lastBrief !== today) {
          await send(sub.chatId, await buildBrief(sub));
          sub.lastBrief = today; stats.briefs++;
        }
      } catch (e) { console.error(`Subscription check failed for ${sub.loc?.name}: ${e.message}`); }
      await sleep(1200); // be gentle with the free weather services
    }
    const latest = await load(); // keep subscriptions added or removed while this run was working
    for (const x of subs) { const m = latest.find(y => y.chatId === x.chatId && y.loc.name === x.loc.name); if (m) { m.sent = x.sent; m.lastBrief = x.lastBrief; } }
    await save(latest);
  } finally { running = false; }
  return stats;
}

export function startScheduler(send) {
  setInterval(() => runChecks(send).catch(e => console.error('Scheduler error:', e.message)), 30 * 60 * 1000).unref?.();
}
