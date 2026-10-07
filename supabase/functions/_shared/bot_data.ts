/** No partial success: a failed page must never be interpreted as no debt. */
export async function botRows(build: () => any, pageSize = 500): Promise<any[]> {
  const rows: any[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await build().range(offset, offset + pageSize - 1);
    if (error || !Array.isArray(data)) throw new Error('bot_data_unavailable');
    rows.push(...data);
    if (data.length < pageSize) return rows;
    if (offset >= 100_000) throw new Error('bot_data_limit');
  }
}
export function publicBotOrigin(siteUrl: string) {
  const url = new URL(siteUrl);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('portal_origin_invalid');
  return url.origin;
}
export async function botPortalLink(supabase: any, ownerId: string, clientId: string, siteUrl: string) {
  const origin = publicBotOrigin(siteUrl);
  const { data: client, error: clientError } = await supabase.from('clients')
    .select('id').eq('id', clientId).eq('user_id', ownerId).maybeSingle();
  if (clientError || !client) throw new Error('client_not_authorized');
  const { data, error } = await supabase.from('portal_sessions')
    .insert({ client_id: clientId, expires_at: new Date(Date.now() + 30 * 60_000).toISOString() })
    .select('token').single();
  if (error || !data?.token) throw new Error('portal_session_unavailable');
  return `${origin}/portal?t=${encodeURIComponent(data.token)}`;
}
export async function checkedBotQuery<T extends {data:unknown;error?:unknown}>(query:PromiseLike<T>):Promise<T>{
  const result=await query;
  if(result.error)throw Error('bot_data_unavailable');
  return result;
}
