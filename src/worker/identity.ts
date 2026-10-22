// L'UNICO punto in cui si legge l'indirizzo IP (la guardia privacy lo verifica).
// L'IP viene ridotto a prefisso e trasformato subito in HMAC con la chiave del giorno: non esce da qui.

import { ipPrefix } from "../domain/ip.ts";
import { hmacHex } from "./crypto.ts";

export interface AnonymousKeys {
  /** Segnalatore: prefisso di rete + token del dispositivo. */
  readonly rkey: string;
  /** Rete: solo prefisso. */
  readonly pkey: string;
}

export async function anonymousKeys(
  request: Request,
  dayKey: string,
  token: string,
): Promise<AnonymousKeys> {
  const prefix = ipPrefix(request.headers.get("CF-Connecting-IP") ?? "") ?? "sconosciuto";
  const [r, p] = await Promise.all([
    hmacHex(dayKey, `r|${prefix}|${token}`),
    hmacHex(dayKey, `p|${prefix}`),
  ]);
  return { rkey: r.slice(0, 32), pkey: p.slice(0, 32) };
}
