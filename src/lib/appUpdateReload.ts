/** Atualizações aguardam o fechamento de formulários e operações em andamento. */
export function canReloadForAppUpdate(page: Document, changedForms: WeakSet<HTMLFormElement>): boolean {
  if (page.visibilityState === "hidden") return false;
  if (page.activeElement?.matches('input, textarea, select, [contenteditable="true"]')) return false;
  if (page.querySelector('[role="dialog"], [aria-busy="true"], form button[type="submit"]:disabled')) return false;
  return !Array.from(page.forms).some(form => changedForms.has(form));
}
