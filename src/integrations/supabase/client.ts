import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";
import { rememberMeStorage } from "./remember";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);
const clientUrl = SUPABASE_URL || "https://supabase-not-configured.invalid";
const clientKey = SUPABASE_PUBLISHABLE_KEY || "missing-anon-key";

/* NÃ£o lanÃ§ar durante o import: a shell deve conseguir renderizar uma mensagem
 * de configuraÃ§Ã£o/rede em vez de deixar o #root vazio. */
export const supabase = createClient<Database>(clientUrl, clientKey, {
  auth: {
    storage: rememberMeStorage,
    persistSession: true,
    autoRefreshToken: true,
  },
});
