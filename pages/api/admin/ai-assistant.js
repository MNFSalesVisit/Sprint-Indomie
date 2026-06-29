import { getAggregatedContext } from './ai-context';
import { createClient } from '@supabase/supabase-js';

const adminSupabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

async function verifyAdmin(token) {
  const { data: { user }, error } = await adminSupabase.auth.getUser(token);
  if (error || !user) return null;
  const { data: appUser } = await adminSupabase
    .from('app_users')
    .select('id, roles(name), user_regions(region_id)')
    .eq('email', user.email)
    .single();
  if (!appUser) return null;
  const role = appUser.roles?.name;
  if (!['Admin', 'Super Admin', 'Manager'].includes(role)) return null;
  const allowedRegionIds = (appUser.user_regions || []).map(r => r.region_id);
  return { id: appUser.id, role, allowedRegionIds };
}

// Helper to call Hugging Face Inference API with a 5s timeout
async function callHF(prompt) {
  const model = process.env.HF_MODEL || 'google/flan-t5-large';
  const url = `https://api-inference.huggingface.co/models/${model}`;
  const key = process.env.HF_API_KEY;
  if (!key) throw new Error('Missing HF_API_KEY');

  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputs: prompt }),
      signal: controller.signal,
    });
    clearTimeout(id);
    if (!res.ok) throw new Error(`HF inference error: ${res.status}`);
    const data = await res.json();
    // HF may return array or object depending on model - normalize
    if (Array.isArray(data) && data[0]?.generated_text) return data[0].generated_text;
    if (data?.generated_text) return data.generated_text;
    if (typeof data === 'string') return data;
    // fallback: stringify
    return JSON.stringify(data);
  } catch (e) {
    clearTimeout(id);
    throw e;
  }
}

// Generate a safe deterministic mock answer using only aggregated data
function generateMockAnswer(aggregated, question) {
  try {
    const parts = [];
    parts.push(`Question: ${question}`);
    parts.push(`Summary (${aggregated.window_days || 0}d): ${aggregated.total_shops || 0} shops monitored, ${aggregated.problem_shops || 0} flagged as problem shops.`);
    if (Array.isArray(aggregated.top_regions) && aggregated.top_regions.length > 0) {
      const top = aggregated.top_regions.slice(0,3).map(r => `${r.name} (${r.metric})`).join(', ');
      parts.push(`Top regions: ${top}.`);
    }
    if (Array.isArray(aggregated.low_performing_regions) && aggregated.low_performing_regions.length > 0) {
      const low = aggregated.low_performing_regions.slice(0,3).map(r => `${r.name} (${r.metric}%)`).join(', ');
      parts.push(`Low-performing regions: ${low}.`);
    }
    if (Array.isArray(aggregated.common_reasons) && aggregated.common_reasons.length > 0) {
      const reasons = aggregated.common_reasons.slice(0,4).map(r => `${r.reason} (${r.count})`).join(', ');
      parts.push(`Common reasons reported: ${reasons}.`);
    }
    parts.push('Recommendation: investigate low-performing regions and review top common reasons; consider targeted coaching and product availability checks.');
    return parts.join('\n\n');
  } catch (e) {
    return 'Unable to generate mock answer.';
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorised' });

  const admin = await verifyAdmin(token);
  if (!admin) return res.status(403).json({ error: 'Forbidden' });

  const { question } = req.body || {};
  if (!question || typeof question !== 'string') return res.status(400).json({ error: 'Missing question' });

  try {
    const aggregated = await getAggregatedContext(admin.allowedRegionIds || []);

    // Build a strict prompt that instructs the model to use only provided data
    const prompt = `You are a sales assistant. Use ONLY the provided aggregated data (JSON) to answer the user's question. Do NOT request raw shop-level or personal data. If the data is insufficient, say you cannot answer precisely.\n\nUser question:\n"${question}"\n\nData:\n${JSON.stringify(aggregated, null, 2)}\n\nRespond in 2-4 short paragraphs with insights, trends, and recommendations. Do NOT invent facts.`;

    let answer;
    if (process.env.HF_API_KEY) {
      answer = await callHF(prompt);
    } else {
      // Fallback: return a deterministic mock answer so UI can be exercised without external key
      answer = generateMockAnswer(aggregated, question);
    }
    return res.status(200).json({ answer });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'AI call failed' });
  }
}
