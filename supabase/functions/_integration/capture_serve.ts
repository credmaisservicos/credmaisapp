export type Handler = (request: Request) => Response | Promise<Response>;
export const handlers: Handler[] = [];

/** Captura o handler real sem abrir portas ou iniciar um servidor. */
export function serve(handler: Handler) {
  handlers.push(handler);
}
