// Loads the .env file from THIS folder (not from wherever the terminal happens to be),
// and tells you in the black window whether it was found.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const dir = path.dirname(fileURLToPath(import.meta.url));
const candidates = ['.env', '.env.txt']; // .env.txt = Windows added ".txt" by mistake; we accept it anyway
let loaded = null;
for (const name of candidates) {
  const p = path.join(dir, name);
  if (fs.existsSync(p)) { dotenv.config({ path: p }); loaded = name; break; }
}
if (loaded === '.env') console.log('Settings file found: .env');
else if (loaded === '.env.txt') console.log('Settings file found, but it is named ".env.txt". It works, but you can rename it to ".env".');
else console.log(`No .env settings file found in ${dir}\n  (that is fine: the app runs in basic mode. Run save-keys.bat to add keys.)`);

const set = k => Boolean(process.env[k] && process.env[k].trim());
console.log(`  Gemini key: ${set('GEMINI_API_KEY') ? 'found' : 'not set'} | Telegram token: ${set('TELEGRAM_BOT_TOKEN') ? 'found' : 'not set'}`);
// treat blank values as not set
for (const k of ['GEMINI_API_KEY', 'TELEGRAM_BOT_TOKEN', 'ANTHROPIC_API_KEY']) if (process.env[k] !== undefined) process.env[k] = process.env[k].trim();
