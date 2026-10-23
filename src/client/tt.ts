// Trusted Types (la CSP richiede `require-trusted-types-for 'script'`):
// gli unici script caricabili da codice sono quelli elencati qui.

const ALLOWED_SCRIPTS = new Set(["/pow.js"]);

interface TrustedTypesLike {
  createPolicy(
    name: string,
    rules: { createScriptURL(url: string): string },
  ): { createScriptURL(url: string): unknown };
}

const tt = (globalThis as { trustedTypes?: TrustedTypesLike }).trustedTypes;
const policy = tt?.createPolicy("qui", {
  createScriptURL(url) {
    if (!ALLOWED_SCRIPTS.has(url)) throw new TypeError(`script non ammesso: ${url}`);
    return url;
  },
});

/** URL di script accettato dalla CSP (TrustedScriptURL dove supportato, stringa altrove). */
export function scriptUrl(url: string): string {
  return (policy ? policy.createScriptURL(url) : url) as string;
}
