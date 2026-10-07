type Failure = {status?:number;code?:string;message?:string};
const fields=(error:unknown)=>{
 const value=(error||{}) as Failure;
 return {status:Number(value.status)||0,code:String(value.code||''),message:String(value.message||'')};
};
export function isTemporaryAuthFailure(error:unknown){
 const {status,code,message}=fields(error);
 if([401,403,429].includes(status)||/invalid_credentials|refresh_token|42501|PGRST30[123]/i.test(code))return false;
 // WebKit reports fetch failures as "Load failed"; PostgREST may retain the
 // "TypeError:" prefix. Match those messages rather than every TypeError.
 const safariNetworkFailure=/^(?:TypeError:\s*)?(?:Load failed|The Internet connection appears to be offline)\.?$/i.test(message.trim());
 return [408,502,503,504].includes(status)||(!status&&(safariNetworkFailure||/network|failed to fetch|fetch failed|timeout|timed out|demorou|aborted|aborterror|falha de rede/i.test(message)));
}
export function authFailureMessage(error:unknown,fallback='Não foi possível verificar seu acesso. Tente novamente.'){
 const {status,code,message}=fields(error);
 if(status===401||/refresh_token|PGRST30[123]|sessão|session.*expired/i.test(code+' '+message))return 'Sua sessão expirou. Entre novamente para continuar.';
 if(status===403||code==='42501')return 'Não foi possível confirmar a permissão da sua conta. Entre em contato com o suporte.';
 if(status>=500)return 'O servidor está temporariamente indisponível. Tente novamente em instantes.';
 if(isTemporaryAuthFailure(error))return navigator.onLine===false?'Você está sem conexão. Reconecte e tente novamente.':'Não foi possível conectar ao servidor. Tente novamente em instantes.';
 return fallback;
}
