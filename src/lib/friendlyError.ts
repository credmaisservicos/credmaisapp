// Turn cryptic Postgres / Supabase errors into short, human messages.
// Keeps the technical detail available in the console for debugging.

const FRIENDLY: Array<{ match: RegExp; title: string; description: string }> = [
  { match: /duplicate key|already exists|unique constraint/i, title: "Registro duplicado", description: "Já existe um item com esses dados." },
  { match: /violates foreign key/i, title: "Vínculo obrigatório", description: "Este item depende de outro que não foi encontrado." },
  { match: /violates not-null|null value in column/i, title: "Faltam informações", description: "Preencha todos os campos obrigatórios." },
  { match: /permission denied|row-level security|rls/i, title: "Sem permissão", description: "Você não tem acesso para fazer isso." },
  { match: /jwt|invalid.*token|not authenticated|auth/i, title: "Sessão expirada", description: "Faça login novamente para continuar." },
  { match: /network|failed to fetch|timeout|timed out/i, title: "Sem conexão", description: "Verifique sua internet e tente de novo." },
  { match: /rate limit|too many/i, title: "Muitas tentativas", description: "Aguarde alguns segundos e tente novamente." },
  { match: /check constraint|invalid input|invalid.*format/i, title: "Dado inválido", description: "Confira os campos preenchidos." },
  { match: /could not find the function|function .* does not exist|relation .* does not exist/i, title: "Recurso indisponivel", description: "Este recurso ainda nao esta habilitado neste ambiente. Procure o administrador do sistema." },
];

export function friendlyError(error: unknown, fallback = "Não foi possível concluir. Tente novamente."): { title: string; description: string } {
  const raw = (error as any)?.message ?? (typeof error === "string" ? error : "") ?? "";
  if (raw && typeof console !== "undefined") console.warn("[supabase error]", error);
  for (const rule of FRIENDLY) {
    if (rule.match.test(raw)) return { title: rule.title, description: rule.description };
  }
  return { title: "Ops, algo deu errado", description: fallback };
}
