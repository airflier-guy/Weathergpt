// The "brain": picks the best available engine and always has a free fallback.
//   1. GEMINI_API_KEY    -> Google Gemini (free tier available)
//   2. ANTHROPIC_API_KEY -> Claude (paid)
//   3. no key            -> built-in basic mode (free, no AI)
// If an AI engine fails (quota, network...), it automatically falls back to basic mode.

import Anthropic from '@anthropic-ai/sdk';
import { TOOLS, runTool } from './tools.js';
import { answerBasic } from './fallback.js';

const GEMINI_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-5-5';
const claude = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;

export const MODE = GEMINI_KEY ? `AI (Gemini ${GEMINI_MODEL})` : claude ? `AI (Claude ${CLAUDE_MODEL})` : 'basic (no API key)';

const LANG_NAMES = { en: 'English', hi: 'Hindi', bn: 'Bengali' };

const systemPrompt = lang => `You are WeatherGPT, a conversational assistant for weather forecasts, weather alerts and climate information, built mainly for users in India.

Rules:
- Always use the tools to get weather, alert or climate data. Never invent numbers. If a tool fails or a place isn't found, say so and ask for a clearer place name.
- Reply in ${LANG_NAMES[lang] || 'English'} unless the user writes in another language, then match theirs. Use Celsius, km/h and mm.
- Be concise and practical. Lead with the answer, then give short advice relevant to the user's situation (travel, health, farming, events). For farmers, give concrete field-work guidance (spraying, irrigation, harvesting, drainage).
- For alerts: the alerts tool is derived from forecast thresholds, not official warnings. Always tell the user to follow IMD (mausam.imd.gov.in) or local authorities for official warnings, and in an emergency to call 112 (or local disaster helplines).
- For climate questions, summarise the pattern (hottest/coldest/wettest months) rather than listing every number, unless asked.
- If the user doesn't name a place and none was mentioned earlier, ask which place they mean.
- Stay on topic: weather, climate and weather-related advice. Politely decline unrelated requests.`;

/* ---------------- Gemini (REST, no extra package) ---------------- */
async function viaGemini(convo, lang) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
  const contents = convo.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
  const tools = [{ functionDeclarations: TOOLS.map(t => ({ name: t.name, description: t.description, parameters: t.input_schema })) }];
  const toolsUsed = [];

  for (let step = 0; step < 6; step++) {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_KEY },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: systemPrompt(lang) }] }, contents, tools }),
      signal: AbortSignal.timeout(30000)
    });
    if (!r.ok) throw new Error(`Gemini ${r.status}: ${(await r.text()).slice(0, 300)}`);
    const data = await r.json();
    const content = data.candidates?.[0]?.content;
    const parts = content?.parts || [];
    const calls = parts.filter(p => p.functionCall);
    if (!calls.length) {
      const reply = parts.map(p => p.text || '').join('').trim();
      if (!reply) throw new Error('Gemini returned an empty answer');
      return { reply, tools_used: toolsUsed };
    }
    contents.push(content); // keep the model turn exactly as returned
    const responses = [];
    for (const { functionCall: fc } of calls) {
      toolsUsed.push({ name: fc.name, input: fc.args || {} });
      try { responses.push({ functionResponse: { name: fc.name, response: { result: await runTool(fc.name, fc.args) } } }); }
      catch (e) { responses.push({ functionResponse: { name: fc.name, response: { error: e.message } } }); }
    }
    contents.push({ role: 'user', parts: responses });
  }
  throw new Error('Gemini tool loop did not finish');
}

/* ---------------- Claude ---------------- */
async function viaClaude(convoIn, lang) {
  const convo = [...convoIn], toolsUsed = [];
  for (let step = 0; step < 6; step++) {
    const resp = await claude.messages.create({ model: CLAUDE_MODEL, max_tokens: 1200, system: systemPrompt(lang), tools: TOOLS, messages: convo });
    if (resp.stop_reason !== 'tool_use') {
      return { reply: resp.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim(), tools_used: toolsUsed };
    }
    convo.push({ role: 'assistant', content: resp.content });
    const results = [];
    for (const block of resp.content.filter(b => b.type === 'tool_use')) {
      toolsUsed.push({ name: block.name, input: block.input });
      try { results.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(await runTool(block.name, block.input)) }); }
      catch (e) { results.push({ type: 'tool_result', tool_use_id: block.id, content: `Error: ${e.message}`, is_error: true }); }
    }
    convo.push({ role: 'user', content: results });
  }
  throw new Error('Claude tool loop did not finish');
}

/* ---------------- public entry point ---------------- */
// messages: [{role:'user'|'assistant', content:'text'}], last one must be from the user
export async function reply(messages, lang = 'en') {
  const convo = messages.slice(-20)
    .filter(m => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .map(m => ({ role: m.role, content: m.content.slice(0, 2000) }));
  if (!convo.length || convo[convo.length - 1].role !== 'user') throw new Error('last message must be from user');

  try {
    if (GEMINI_KEY) return { ...(await viaGemini(convo, lang)), engine: 'gemini' };
    if (claude) return { ...(await viaClaude(convo, lang)), engine: 'claude' };
  } catch (e) {
    console.error('AI engine failed, using basic mode instead:', e.message);
  }
  return { ...(await answerBasic(convo, lang)), engine: 'basic' };
}
