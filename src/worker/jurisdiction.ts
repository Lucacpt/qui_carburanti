// Residenza dei dati nell'UE (informativa privacy §5, ADR-0012). I Durable Objects sono l'unico posto
// in cui QUI salva dati, e la giurisdizione è l'unico vincolo di Cloudflare che GARANTISCE dove un
// oggetto esegue e salva. wrangler non ha un campo per dichiararla: la si applica qui, in due punti.
// Nessun tipo Cloudflare in questo file: si testa in Node.

export type Jurisdiction = "eu";

export interface JurisdictionEnv {
  /** "eu" in ogni ambiente di deploy; "none" solo in locale (.dev.vars), dove workerd non la supporta. */
  readonly DO_JURISDICTION?: string;
}

/**
 * Namespace vincolato all'UE. Fail-closed: se la variabile manca (per esempio in un nuovo `env` di
 * wrangler, dove le `vars` non si ereditano) si ferma invece di creare oggetti fuori dall'UE.
 */
export function located<N extends { jurisdiction(j: Jurisdiction): N }>(
  env: JurisdictionEnv,
  ns: N,
): N {
  const j = env.DO_JURISDICTION;
  if (j === "none") return ns;
  if (j !== "eu") throw new Error(`DO_JURISDICTION non valida: ${j ?? "assente"}`);
  return ns.jurisdiction(j);
}

/**
 * Difesa in profondità: ogni Durable Object controlla la propria giurisdizione appena creato.
 * Un `get` che salta `located` produce un oggetto che si rifiuta di funzionare, invece di salvare
 * dati fuori dall'UE.
 */
export function assertJurisdiction(
  id: { readonly jurisdiction?: string },
  env: JurisdictionEnv,
): void {
  if (env.DO_JURISDICTION === "none") return;
  if (id.jurisdiction !== "eu") {
    throw new Error(
      `Durable Object fuori dalla giurisdizione UE (${id.jurisdiction ?? "nessuna"})`,
    );
  }
}
