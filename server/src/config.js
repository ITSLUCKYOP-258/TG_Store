/**
 * Optional config.json override (used by some self-hosted setups).
 * If DATA_DIR/config.json exists, its values are applied on top of .env
 * at startup. There is NO web wizard anymore — configuration is done
 * exclusively via environment variables.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = process.env.DATA_DIR
  ? path.join(process.env.DATA_DIR, 'config.json')
  : path.join(__dirname, '..', 'config.json');

const ALLOWED_KEYS = [
  'MT_API_ID',
  'MT_API_HASH',
  'BOT_TOKEN',
  'STORAGE_CHANNEL_ID',
  'BOT_USERNAME',
  'PUBLIC_BASE_URL',
];

/** Apply config.json on top of .env (called once at startup). */
export function loadFileConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    for (const k of ALLOWED_KEYS) {
      if (raw[k] != null && raw[k] !== '') process.env[k] = String(raw[k]);
    }
  } catch {
    /* no config file yet — .env only */
  }
}

