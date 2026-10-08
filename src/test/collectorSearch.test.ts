import { describe, expect, it } from 'vitest';
import { matchesCollectorClientSearch } from '@/lib/collectorSearch';

describe('busca no portal do cobrador', () => {
  const client = { name: 'Cliente Fictício QA', phone: '(00) 00000-0001', cpf_cnpj: '000.000.000-02' };

  it('não mostra cliente sem correspondência ao buscar texto sem dígitos', () => {
    expect(matchesCollectorClientSearch(client, 'CLIENTE INEXISTENTE')).toBe(false);
  });

  it('não usa telefone/CPF vazios para aprovar nome inexistente', () => {
    expect(matchesCollectorClientSearch({ name: 'Cliente QA' }, 'outro nome')).toBe(false);
    expect(matchesCollectorClientSearch(null, 'outro nome')).toBe(false);
  });

  it('busca nome sem diferenciar maiúsculas e espaços externos', () => {
    expect(matchesCollectorClientSearch(client, '  FICTÍCIO qa  ')).toBe(true);
  });

  it('preserva busca por telefone, CPF e WhatsApp formatados', () => {
    expect(matchesCollectorClientSearch(client, '(00) 00000-0001')).toBe(true);
    expect(matchesCollectorClientSearch(client, '000.000.000-02')).toBe(true);
    expect(matchesCollectorClientSearch({ whatsapp: '(00) 00000-0003' }, '00000000003')).toBe(true);
    expect(matchesCollectorClientSearch(client, '99999999999')).toBe(false);
  });

  it('consulta vazia preserva a lista atribuída', () => {
    expect(matchesCollectorClientSearch(client, '  ')).toBe(true);
  });
});
