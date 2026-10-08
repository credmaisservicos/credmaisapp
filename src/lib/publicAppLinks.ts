/** Shared links must remain reachable outside an installed WebView. */
export function publicAppOrigin(origin=typeof window==='undefined'?'':window.location.origin):string {
 try {
  const url=new URL(origin);
  if(['http:','https:'].includes(url.protocol)&&!['localhost','127.0.0.1','[::1]'].includes(url.hostname))return url.origin;
 }catch{ /* Native/local origin: use the public application. */ }
 return 'https://credmaisapp.com.br';
}
export function clientPortalUrl(ownerId:string|null|undefined,origin?:string):string {
 return ownerId ? publicAppOrigin(origin)+'/portal-cliente?o='+encodeURIComponent(ownerId) : '';
}
export function clientPortalLogoutPath(search:string):string {
 const owner=new URLSearchParams(search).get('o');
 const valid=owner && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(owner);
 return '/portal-cliente?'+(valid?'o='+encodeURIComponent(owner)+'&':'')+'logout=1';
}
