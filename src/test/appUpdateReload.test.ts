import { afterEach, describe, expect, it } from "vitest";
import { canReloadForAppUpdate } from "@/lib/appUpdateReload";

afterEach(() => { document.body.innerHTML = ""; });
describe("atualização web preserva operações do usuário", () => {
  it("aguarda um formulário editado até sair da tela", () => {
    document.body.innerHTML = '<form><input name="valor"></form>';
    const changed = new WeakSet<HTMLFormElement>();
    changed.add(document.querySelector("form")!);
    expect(canReloadForAppUpdate(document, changed)).toBe(false);
    document.body.innerHTML = '<main>Dashboard</main>';
    expect(canReloadForAppUpdate(document, changed)).toBe(true);
  });
  it.each(['<div role="dialog">Pagamento</div>', '<form><button type="submit" disabled>Salvando</button></form>', '<div aria-busy="true">Processando</div>'])("aguarda a operação em andamento: %s", markup => {
    document.body.innerHTML = markup;
    expect(canReloadForAppUpdate(document, new WeakSet())).toBe(false);
  });
  it("aguarda o usuário terminar de digitar", () => {
    document.body.innerHTML = '<input name="cliente">';
    document.querySelector("input")!.focus();
    expect(canReloadForAppUpdate(document, new WeakSet())).toBe(false);
    document.querySelector("input")!.blur();
    expect(canReloadForAppUpdate(document, new WeakSet())).toBe(true);
  });
});
