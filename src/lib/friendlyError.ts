// Turn cryptic Postgres / Supabase errors into short, human messages.
// Keeps the technical detail available in the console for debugging.
import { isTemporaryAuthFailure } from './authFailure';

const FRIENDLY: Array<{ match: RegExp; title: string; description: string }> = [
  { match: /fee_discount_exceeds_unpaid_fees/, title: "Confira o desconto", description: "O desconto não pode incluir encargos que já foram recebidos. Revise o valor antes de confirmar." },
  { match: /payment_source_conflict|profit_owner_mismatch/, title: "Pagamento não registrado", description: "Há um conflito no registro financeiro. Confira o comprovante e procure o suporte antes de tentar novamente." },
  { match: /contract_closed|installment_closed/, title: "Recebimento indisponível", description: "Este contrato ou parcela foi cancelado. Confira o cadastro antes de registrar um pagamento." },
  { match: /duplicate key|already exists|unique constraint/i, title: "Registro duplicado", description: "Já existe um item com esses dados." },
  { match: /violates foreign key/i, title: "Vínculo obrigatório", description: "Este item depende de outro que não foi encontrado." },
  { match: /violates not-null|null value in column/i, title: "Faltam informações", description: "Preencha todos os campos obrigatórios." },
  { match: /permission denied|row-level security|rls/i, title: "Sem permissão", description: "Você não tem acesso para fazer isso." },
  { match: /jwt|invalid.*token|not authenticated|auth/i, title: "Sessão expirada", description: "Faça login novamente para continuar." },
  { match: /rate limit|too many/i, title: "Muitas tentativas", description: "Aguarde alguns segundos e tente novamente." },
  { match: /check constraint|invalid input|invalid.*format/i, title: "Dado inválido", description: "Confira os campos preenchidos." },
  { match: /could not find the function|function .* does not exist|relation .* does not exist/i, title: "Recurso indisponivel", description: "Este recurso ainda nao esta habilitado neste ambiente. Procure o administrador do sistema." },
];

export function friendlyError(error: unknown, fallback = "Não foi possível concluir. Tente novamente."): { title: string; description: string } {
  const raw = (error as any)?.message ?? (typeof error === "string" ? error : "") ?? "";
  if (raw && typeof console !== "undefined") console.warn("[supabase error]", error);
  const status = Number((error as { status?: unknown } | null)?.status);
  if (status === 401) return { title: 'Sessão expirada', description: 'Faça login novamente para continuar.' };
  if (status === 403) return { title: 'Sem permissão', description: 'Você não tem acesso para fazer isso.' };
  if (status === 429) return { title: 'Muitas tentativas', description: 'Aguarde alguns segundos e tente novamente.' };
  if (status >= 500) return { title: 'Servidor temporariamente indisponível', description: 'Tente novamente em instantes.' };
  if (isTemporaryAuthFailure(typeof error === 'string' ? { message: error } : error)) {
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    return offline
      ? { title: 'Sem conexão', description: 'Verifique sua internet e tente de novo.' }
      : { title: 'Conexão com o servidor indisponível', description: 'Não foi possível conectar ao servidor. Tente novamente em instantes.' };
  }
  for (const rule of FRIENDLY) {
    if (rule.match.test(raw)) return { title: rule.title, description: rule.description };
  }
  return { title: "Ops, algo deu errado", description: fallback };
}
