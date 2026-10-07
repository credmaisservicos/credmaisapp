import { describe, expect, it } from "vitest";
import { friendlyError } from "@/lib/friendlyError";
import { afterEach, vi } from 'vitest';

afterEach(() => vi.restoreAllMocks());

it('não afirma falta de internet quando o navegador está conectado', () => {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  expect(friendlyError(new TypeError('Failed to fetch'))).toEqual({
    title: 'Conexão com o servidor indisponível',
    description: 'Não foi possível conectar ao servidor. Tente novamente em instantes.',
  });
});

it('orienta reconectar quando o navegador informa que está offline', () => {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  expect(friendlyError(new TypeError('Failed to fetch')).title).toBe('Sem conexão');
});

it.each([502, 503, 504])('apresenta indisponibilidade do servidor em HTTP %s', status => {
  expect(friendlyError({ status, message: 'Failed to fetch upstream' }).title).toBe('Servidor temporariamente indisponível');
});

it.each([[401, 'Sessão expirada'], [403, 'Sem permissão'], [429, 'Muitas tentativas']])('preserva a distinção de HTTP %s', (status, title) => {
  expect(friendlyError({ status, message: 'Network error' }).title).toBe(title);
});

describe("friendlyError", () => {
  it("identifies missing RPCs and database relations", () => {
    expect(friendlyError({ message: "Could not find the function public.renegotiate_contract_atomically" })).toEqual({
      title: "Recurso indisponivel",
      description: "Este recurso ainda nao esta habilitado neste ambiente. Procure o administrador do sistema.",
    });
    expect(friendlyError({ message: "relation payment_promises does not exist" }).title).toBe("Recurso indisponivel");
  });
});
