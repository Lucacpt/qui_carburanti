import { beforeEach, describe, expect, it } from "vitest";
import { FUEL_BIT } from "../../domain/mimit.ts";
import { Flag, State } from "../../domain/types.ts";
import { nodeSql } from "../../test/node-sql.ts";
import { ProvinceStore, type StoreReport } from "./province-store.ts";

const T0 = Date.UTC(2026, 9, 22, 12, 0, 0);
const MIN = 60_000;
const STATION = 1001;

let sql: ReturnType<typeof nodeSql>;
let store: ProvinceStore;
let seq = 0;

/** Segnalazione da una persona e una rete nuove, salvo override. */
function rep(over: Partial<StoreReport> = {}): StoreReport {
  seq++;
  return {
    id: STATION,
    fuel: "B",
    has: true,
    near: true,
    queue: undefined,
    limit: undefined,
    rkey: `r${seq}`,
    pkey: `p${seq}`,
    powSig: `sig${seq}`,
    powExpiresMs: T0 + 5 * MIN,
    ...over,
  };
}

const rows = <T>(q: string) => sql.db.prepare(q).all() as T[];

beforeEach(() => {
  sql = nodeSql();
  store = new ProvinceStore(sql);
  store.migrate();
  store.setStations(new Map([[STATION, FUEL_BIT.B | FUEL_BIT.G]]));
});

describe("ProvinceStore — segnalazioni", () => {
  it("3 conferme da persone e reti diverse → verde", () => {
    for (let i = 0; i < 3; i++) expect(store.report(rep(), T0 + i * MIN)).toBe("accepted");
    expect(store.stateOf(STATION, "B", T0 + 3 * MIN).state).toBe(State.GREEN);
  });

  it("rifiuta impianti sconosciuti e carburanti non venduti", () => {
    expect(store.report(rep({ id: 9999 }), T0)).toBe("invalid_station");
    expect(store.report(rep({ fuel: "M" }), T0)).toBe("invalid_station");
  });

  it("anti-replay: la stessa soluzione PoW conta una volta sola", () => {
    expect(store.report(rep({ powSig: "dup" }), T0)).toBe("accepted");
    expect(store.report(rep({ powSig: "dup" }), T0 + 1000)).toBe("dropped");
  });

  it("timeout progressivo: dalla 4ª segnalazione sullo stesso impianto in 45' si scarta, anche dopo", () => {
    const same = { rkey: "insistente", pkey: "rete" };
    for (let i = 0; i < 3; i++) expect(store.report(rep(same), T0 + i * MIN)).toBe("accepted");
    expect(store.report(rep(same), T0 + 3 * MIN)).toBe("dropped");
    // durante il timeout (2 minuti al primo livello) anche altri impianti sono bloccati
    store.setStations(
      new Map([
        [STATION, 3],
        [2002, 3],
      ]),
    );
    expect(store.report(rep({ ...same, id: 2002 }), T0 + 4 * MIN)).toBe("dropped");
    expect(store.report(rep({ ...same, id: 2002 }), T0 + 6 * MIN)).toBe("accepted");
  });

  it("sola lettura: nessuna segnalazione accettata", () => {
    store.setReadOnly(true);
    expect(store.report(rep(), T0)).toBe("read_only");
    store.setReadOnly(false);
    expect(store.report(rep(), T0)).toBe("accepted");
  });

  it("coda e limite vengono salvati solo con le conferme", () => {
    store.report(rep({ has: false, queue: 3, limit: true }), T0);
    const r = rows<{ queue: number | null; lim: number | null }>("SELECT queue, lim FROM reports");
    expect(r[0]).toEqual({ queue: null, lim: null });
  });
});

describe("ProvinceStore — registro anonimo (ADR-0011 D)", () => {
  it("registra i cambi di stato SENZA identificativi dei segnalatori", () => {
    const cols = rows<{ name: string }>("PRAGMA table_info(transitions)").map((c) => c.name);
    expect(cols).not.toContain("rkey");
    expect(cols).not.toContain("pkey");
    for (let i = 0; i < 3; i++) store.report(rep(), T0 + i * MIN);
    const t = rows<{ to_state: number; cause: string; confirmations: number }>(
      "SELECT to_state, cause, confirmations FROM transitions ORDER BY rowid",
    );
    expect(t.map((x) => x.to_state)).toEqual([State.AMBER, State.GREEN]);
    expect(t.at(-1)).toMatchObject({ cause: "report", confirmations: 3 });
  });

  it("l'ultima disponibilità è anonima: impianto, carburante e minuto, nessun codice", () => {
    const cols = rows<{ name: string }>("PRAGMA table_info(last_green)").map((c) => c.name);
    expect(cols).toEqual(["station", "fuel", "ts"]);
  });

  it("rosso in verifica: avvisa i maintainer, poi il tempo lo conferma con causa 'hold'", () => {
    for (let i = 0; i < 3; i++) store.report(rep({ has: false }), T0 + i * MIN);
    expect(store.stateOf(STATION, "B", T0 + 3 * MIN).flags).toBe(Flag.RED_PENDING);
    expect(store.pendingAlerts().map((a) => a.kind)).toContain("red_pending");

    store.maintenance(T0 + 11 * MIN);
    const last = rows<{ to_state: number; cause: string }>(
      "SELECT to_state, cause FROM transitions ORDER BY rowid DESC LIMIT 1",
    )[0];
    expect(last).toEqual({ to_state: State.RED, cause: "hold" });
  });
});

describe("ProvinceStore — ultimo stato noto e segnalazioni dell'ultima ora", () => {
  const HOUR = 60 * MIN;
  const snap = (now: number) =>
    JSON.parse(store.snapshot("AV", now).body) as { s: unknown[][]; lg: unknown[][]; h: number };

  it("dopo 8 ore il grigio porta l'ultima disponibilità; dopo 24 ore sparisce", () => {
    for (let i = 0; i < 3; i++) store.report(rep(), T0 + i * MIN);
    const live = snap(T0 + 3 * MIN);
    expect(live.lg).toEqual([]); // c'è uno stato attuale: niente "ultima disponibilità"
    expect(live.h).toBe(3);

    store.maintenance(T0 + 8 * HOUR + 3 * MIN);
    const grey = snap(T0 + 9 * HOUR);
    expect(grey.s).toEqual([]);
    expect(grey.lg).toEqual([[STATION, "B", 9 * 60 - 5]]); // conferma alle T0+2', fascia di 5'
    expect(grey.h).toBe(0);

    store.maintenance(T0 + 2 * MIN + 24 * HOUR);
    expect(rows("SELECT * FROM last_green")).toHaveLength(0);
    expect(snap(T0 + 25 * HOUR).lg).toEqual([]);
  });

  it("un vecchio rosso non lascia traccia: si ricordano solo le disponibilità", () => {
    for (let i = 0; i < 3; i++) store.report(rep({ has: false }), T0 + i * MIN);
    store.maintenance(T0 + 20 * MIN);
    expect(rows("SELECT * FROM last_green")).toHaveLength(0);
  });

  it("la prossima scadenza guida l'alarm anche senza segnalazioni (es. contatto a 30 giorni)", () => {
    expect(store.nextExpiry()).toBeNull();
    store.contest(
      { prov: "AV", id: STATION, fuel: undefined, reason: "has_fuel", contact: "x@y.it", pow: "" },
      T0,
    );
    expect(store.nextExpiry()).toBe(T0 + 30 * 24 * HOUR);
  });
});

describe("ProvinceStore — manutenzione e conservazione dei dati", () => {
  it("dopo 8 ore le segnalazioni vengono cancellate e lo stato torna grigio", () => {
    store.report(rep(), T0);
    expect(store.maintenance(T0 + MIN)).toBe(true);
    expect(store.maintenance(T0 + 8 * 60 * MIN + 1)).toBe(false);
    expect(rows("SELECT * FROM reports")).toHaveLength(0);
    expect(rows("SELECT * FROM current")).toHaveLength(0);
  });

  it("il contatto di una contestazione viene cancellato dopo 30 giorni", () => {
    store.contest(
      { prov: "AV", id: STATION, fuel: "B", reason: "has_fuel", contact: "x@y.it", pow: "" },
      T0,
    );
    store.maintenance(T0 + 31 * 24 * 60 * MIN);
    expect(rows<{ contact: string | null }>("SELECT contact FROM contests")[0]?.contact).toBeNull();
  });

  it("contestazioni e avvisi spariscono dopo 180 giorni, come scritto nell'informativa", () => {
    store.contest(
      { prov: "AV", id: STATION, fuel: undefined, reason: "other", contact: undefined, pow: "" },
      T0,
    );
    store.maintenance(T0 + 179 * 24 * 60 * MIN);
    expect(rows("SELECT * FROM contests")).toHaveLength(1);
    expect(rows("SELECT * FROM alerts")).toHaveLength(1);
    store.maintenance(T0 + 180 * 24 * 60 * MIN);
    expect(rows("SELECT * FROM contests")).toHaveLength(0);
    expect(rows("SELECT * FROM alerts")).toHaveLength(0);
  });
});

describe("ProvinceStore — snapshot e congelamento", () => {
  it("lo snapshot contiene lo stato e ha un ETag stabile se nulla cambia", () => {
    for (let i = 0; i < 3; i++) store.report(rep({ queue: 3 }), T0 + i * MIN);
    const a = store.snapshot("AV", T0 + 3 * MIN);
    const body = JSON.parse(a.body) as { s: unknown[][] };
    expect(body.s[0]?.slice(0, 3)).toEqual([STATION, "B", State.GREEN]);
    expect(body.s[0]?.[8]).toBe(3);
    expect(store.snapshot("AV", T0 + 3 * MIN + 1000).etag).toBe(a.etag);
  });

  it("un impianto congelato non è mai verde e mostra la nota attribuita al gestore", () => {
    for (let i = 0; i < 3; i++) store.report(rep(), T0 + i * MIN);
    store.freeze(STATION, "Il gestore segnala: rifornimento alle 14:20", T0 + 3 * MIN);
    const body = JSON.parse(store.snapshot("AV", T0 + 4 * MIN).body) as {
      s: number[][];
      fz: [number, string][];
    };
    expect(body.s[0]?.[2]).toBe(State.AMBER);
    expect((body.s[0]?.[6] ?? 0) & Flag.FROZEN).toBe(Flag.FROZEN);
    expect(body.fz).toEqual([[STATION, "Il gestore segnala: rifornimento alle 14:20"]]);
  });
});
