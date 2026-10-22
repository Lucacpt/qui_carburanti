// Web Worker: risolve il proof-of-work senza bloccare l'interfaccia.

import { type Challenge, solveChallenge } from "../worker/pow.ts";

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<Challenge>) => void) | null;
  postMessage(message: unknown): void;
};

scope.onmessage = (e) => {
  solveChallenge(e.data).then(
    (payload) => scope.postMessage({ ok: true, payload }),
    () => scope.postMessage({ ok: false }),
  );
};
