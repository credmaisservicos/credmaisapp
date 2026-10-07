import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Cached clients may still call this retired endpoint. Never read customer data
// or call a model: all negotiation is performed by the human team.
serve((req) => {
  if (req.method === 'OPTIONS') return new Response(null, {headers: corsHeaders});
  if (req.method !== 'POST') return new Response(null, {status: 405, headers: {...corsHeaders, Allow: 'POST, OPTIONS'}});
  return new Response(JSON.stringify({
    code: 'human_negotiation_required',
    error: 'A negociação automática foi encerrada. Para negociar valores ou prazos, entre em contato com a equipe responsável pelo seu contrato.',
  }), {status: 410, headers: {...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store'}});
});
