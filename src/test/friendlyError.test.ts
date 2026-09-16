import { describe, expect, it } from "vitest";
import { friendlyError } from "@/lib/friendlyError";

describe("friendlyError", () => {
  it("identifies missing RPCs and database relations", () => {
    expect(friendlyError({ message: "Could not find the function public.renegotiate_contract_atomically" })).toEqual({
      title: "Recurso indisponivel",
      description: "Este recurso ainda nao esta habilitado neste ambiente. Procure o administrador do sistema.",
    });
    expect(friendlyError({ message: "relation payment_promises does not exist" }).title).toBe("Recurso indisponivel");
  });
});
