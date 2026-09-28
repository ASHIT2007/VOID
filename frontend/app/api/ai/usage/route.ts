import { requireDeploymentAccess } from '@/lib/deployment-access';
import { authenticatedUser, serviceDb } from '@/lib/ai/server';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const denied = requireDeploymentAccess(request);
  if (denied) return denied;
  const userId = await authenticatedUser(request);
  if (!userId) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  const monthStart = new Date();
  monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);
  const [{ data, error }, { data: modelUsage, error: usageError }] = await Promise.all([
    serviceDb().from('routing_events').select('provider_id,model_id,fallback_count,latency_ms')
      .eq('user_id', userId).gte('created_at', monthStart.toISOString()).limit(10000),
    serviceDb().from('model_usage').select('input_tokens,output_tokens,token_count_estimated,estimated_cost_usd')
      .eq('user_id', userId).gte('created_at', monthStart.toISOString()).limit(10000),
  ]);
  if (error || usageError) return Response.json({ error: 'Usage is unavailable.' }, { status: 503 });
  const rows = data || [];
  const providers: Record<string, number> = {};
  for (const row of rows) if (row.provider_id) providers[row.provider_id] = (providers[row.provider_id] || 0) + 1;
  return Response.json({ storage: 'legacy-cloud', notice: 'Historical cloud records only. New usage is stored on this device in Workspace → Usage.', requests: rows.length, fallbacks: rows.reduce((sum, row) => sum + (row.fallback_count || 0), 0),
    averageLatencyMs: rows.length ? Math.round(rows.reduce((sum, row) => sum + (row.latency_ms || 0), 0) / rows.length) : 0,
    providers, estimatedCost: null,
    inputTokens: (modelUsage || []).reduce((sum, row) => sum + (row.input_tokens || 0), 0),
    outputTokens: (modelUsage || []).reduce((sum, row) => sum + (row.output_tokens || 0), 0),
    tokenCountsEstimated: (modelUsage || []).some(row => row.token_count_estimated),
    sampled: rows.length >= 10000 || (modelUsage || []).length >= 10000 }, { headers: { 'Cache-Control': 'no-store' } });
}
