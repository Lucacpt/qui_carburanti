// Web Worker: risolve il proof-of-work senza bloccare l'interfaccia.

import { type Challenge, solveChallenge } from "../worker/pow.ts";

/** Oltre questo limite il calcolo durerebbe minuti: una sfida così non viene dal nostro server. */
const MAX_NUMBER = 10_000_000;

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<unknown>) => void) | null;
  postMessage(message: unknown): void;
  location: { origin: string };
};

function isChallenge(d: unknown): d is Challenge {
  if (typeof d !== "object" || d === null) return false;
  const c = d as Record<string, unknown>;
  return (
    c.algorithm === "SHA-256" &&
    typeof c.challenge === "string" &&
    typeof c.salt === "string" &&
    typeof c.signature === "string" &&
    Number.isInteger(c.maxnumber) &&
    (c.maxnumber as number) >= 0 &&
    (c.maxnumber as number) <= MAX_NUMBER
  );
}

scope.onmessage = (e) => {
  // Un worker dedicato riceve messaggi solo dalla pagina che l'ha creato (origin vuota o la nostra):
  // il controllo esplicito rende la regola verificabile e resta valido se il worker cambiasse tipo.
  if (e.origin !== "" && e.origin !== scope.location.origin) return;
  if (!isChallenge(e.data)) {
    scope.postMessage({ ok: false });
    return;
  }
  solveChallenge(e.data).then(
    (payload) => scope.postMessage({ ok: true, payload }),
    () => scope.postMessage({ ok: false }),
  );
};
