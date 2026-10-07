/** Limits waiting for a request, including Supabase's PromiseLike builders. */
export async function withTimeout<T>(
  request: PromiseLike<T>,
  timeoutMs = 10_000,
  message = "A solicitação demorou demais. Verifique sua conexão e tente novamente.",
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(request),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Cancels a request's network work too; does not repeat the operation. */
export async function withAbortTimeout<T>(
  request:(signal:AbortSignal)=>PromiseLike<T>,timeoutMs=10_000,
  message="O servidor demorou para responder. Tente novamente em instantes.",
):Promise<T>{
  const controller=new AbortController();
  try{return await withTimeout(request(controller.signal),timeoutMs,message);}
  finally{controller.abort();}
}
