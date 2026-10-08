type CollectorSearchClient = {
  name?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  cpf_cnpj?: string | null;
};

export function matchesCollectorClientSearch(client: CollectorSearchClient | null | undefined, search: string): boolean {
  const query = search.toLowerCase().trim();
  if (!query) return true;
  const name = (client?.name || '').toLowerCase();
  const phone = (client?.phone || client?.whatsapp || '').replace(/\D/g, '');
  const cpf = (client?.cpf_cnpj || '').replace(/\D/g, '');
  const digits = query.replace(/\D/g, '');
  return name.includes(query) || (digits.length > 0 && (phone.includes(digits) || cpf.includes(digits)));
}
