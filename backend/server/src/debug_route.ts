import { initDb, getDb } from './db/index.js';
import { getProvider } from './providers/index.js';

initDb('../../data/freeapi.db');
const db = getDb();

const preferredModel = 'mistralai/mistral-large-3-675b-instruct-2512';
const requireTools = true;
const estimatedTokens = 1000;
const requireVision = false;

const chain = db.prepare(`
    SELECT fc.model_db_id, fc.priority, fc.enabled,
           m.platform, m.model_id, m.display_name, m.intelligence_rank,
           m.size_label, m.monthly_token_budget,
           m.rpm_limit, m.rpd_limit, m.tpm_limit, m.tpd_limit, m.supports_vision,
           m.supports_tools, m.context_window, m.key_id
    FROM fallback_config fc
    JOIN models m ON m.id = fc.model_db_id AND m.enabled = 1
    WHERE fc.enabled = 1
`).all() as any[];

let sortedChain = [...chain];

if (preferredModel !== undefined) {
    const idx = sortedChain.findIndex(e => e.model_db_id === preferredModel || e.model_id === preferredModel || e.display_name === preferredModel);
    console.log('findIndex for preferredModel:', preferredModel, 'is', idx);
    if (idx > 0) {
      const [preferred] = sortedChain.splice(idx, 1);
      sortedChain.unshift(preferred);
    }
}

for (const entry of sortedChain) {
    console.log('Evaluating:', entry.model_id, 'Platform:', entry.platform);
    if (requireVision && !entry.supports_vision) { console.log('  Skipped: Vision required'); continue; }
    if (requireTools && !entry.supports_tools) { console.log('  Skipped: Tools required'); continue; }
    if (entry.context_window != null && estimatedTokens > entry.context_window) { console.log('  Skipped: Context window'); continue; }

    const provider = getProvider(entry.platform);
    if (!provider) { console.log('  Skipped: No provider for', entry.platform); continue; }

    const keys = db.prepare(
      "SELECT * FROM api_keys WHERE platform = ? AND enabled = 1 AND status IN ('healthy', 'unknown')"
    ).all(entry.platform);
    
    if (keys.length === 0) { console.log('  Skipped: No enabled keys for platform', entry.platform); continue; }

    console.log('  Provider and Keys exist! Using this model!');
    break;
}
