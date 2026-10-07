// The Edge Function uses this pinned CDN module; tests resolve the same version
// from the application's pinned dependency without downloading code at runtime.
declare module 'https://esm.sh/decimal.js-light@2.5.1' {
  import Decimal from 'decimal.js-light';
  export default Decimal;
}
