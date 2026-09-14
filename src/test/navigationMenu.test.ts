import { describe, expect, it } from "vitest";
import {
  filterMenuSections,
  isMenuPathActive,
  operationSections,
  platformSections,
} from "@/components/navigation/menu";

const allPaths = (sections: ReturnType<typeof filterMenuSections>) =>
  sections.flatMap((s) => s.items.map((i) => i.path));

describe("menu compartilhado (sidebar + celular)", () => {
  it("esconde telas de admin para quem não é dono do app", () => {
    const paths = allPaths(filterMenuSections(operationSections, { isPlatformAdmin: false, hasAutomations: true }));
    expect(paths).not.toContain("/admin");
    expect(paths).not.toContain("/auditoria");
    expect(paths).not.toContain("/historico");
    expect(paths).toContain("/clientes");
  });

  it("mostra telas de admin para o dono do app", () => {
    const paths = allPaths(filterMenuSections(operationSections, { isPlatformAdmin: true, hasAutomations: true }));
    expect(paths).toContain("/admin");
    expect(paths).toContain("/auditoria");
  });

  it("esconde itens do plano completo sem automações", () => {
    const paths = allPaths(filterMenuSections(operationSections, { isPlatformAdmin: false, hasAutomations: false }));
    expect(paths).not.toContain("/comunicacao");
    expect(paths).not.toContain("/comunicacao/inbox");
    expect(paths).toContain("/chat");
  });

  it("respeita módulos desligados no white-label e remove seções vazias", () => {
    const sections = filterMenuSections(operationSections, {
      isPlatformAdmin: false,
      hasAutomations: true,
      modules: { simulador: false, metas: false, tarefas: false, anotacoes: false, planilha: false, puxada_dados: false },
    });
    expect(sections.find((s) => s.title === "Ferramentas")).toBeUndefined();
    expect(allPaths(sections)).toContain("/clientes");
  });

  it("painel da plataforma tem o perfil e as seções de diagnóstico", () => {
    const paths = allPaths(platformSections);
    expect(paths).toContain("/perfil");
    expect(paths).toContain("/admin?secao=logs");
  });
});

describe("isMenuPathActive", () => {
  it("ativa por prefixo de rota", () => {
    expect(isMenuPathActive("/clientes", "/clientes/abc", "")).toBe(true);
    expect(isMenuPathActive("/clientes", "/clientesx", "")).toBe(false);
  });

  it("diferencia seções do painel pela query", () => {
    expect(isMenuPathActive("/admin", "/admin", "")).toBe(true);
    expect(isMenuPathActive("/admin", "/admin", "?secao=logs")).toBe(false);
    expect(isMenuPathActive("/admin?secao=logs", "/admin", "?secao=logs")).toBe(true);
    expect(isMenuPathActive("/admin?secao=logs", "/admin", "?secao=support")).toBe(false);
  });
});
