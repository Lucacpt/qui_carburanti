import { describe, expect, it } from "vitest";
import type { ProvinceRegistry } from "../domain/mimit.ts";
import { FUEL_BIT } from "../domain/mimit.ts";
import { fuelsFromMask, stationsFromRegistry } from "./data.ts";
import { centroid, distanceKm, formatDistance, nearby } from "./geo.ts";

describe("nearby: distributori attorno a un comune", () => {
  const p = { lat: 41, lon: 15 };
  // ~1,1 km per 0,01° di latitudine
  const at = (name: string, dLat: number) => ({ name, lat: 41 + dLat, lon: 15 });
  const items = [at("40km", 0.36), at("2km", 0.018), at("9km", 0.081), at("14km", 0.126)];

  it("entro il raggio, ordinati per distanza; fuori i lontani", () => {
    expect(nearby(items, p, 15, 2).map((x) => x.name)).toEqual(["2km", "9km", "14km"]);
  });

  it("se nel raggio ce ne sono troppo pochi, prende comunque i più vicini", () => {
    expect(nearby(items, p, 5, 3).map((x) => x.name)).toEqual(["2km", "9km", "14km"]);
    expect(nearby(items, p, 1, 1).map((x) => x.name)).toEqual(["2km"]);
  });
});

import { directionsUrl, parseStationPath, stationPath } from "./nav.ts";
import { findTown, matches, normalize, type Town } from "./search.ts";

describe("findTown: comuni senza distributori", () => {
  const town = (name: string): Town => ({ name, key: normalize(name), lat: 41, lon: 15 });
  const towns = [
    town("Chiusano di San Domenico"),
    town("San Mango sul Calore"),
    town("San Nicola Baronia"),
    town("Sant'Angelo dei Lombardi"),
    town("Ospedaletto d'Alpinolo"),
  ];

  it("trova il comune anche con una parte del nome, senza accenti né maiuscole", () => {
    expect(findTown(towns, "chius")?.name).toBe("Chiusano di San Domenico");
    expect(findTown(towns, "OSPEDALETTO")?.name).toBe("Ospedaletto d'Alpinolo");
    expect(findTown(towns, "sant angelo")?.name).toBe("Sant'Angelo dei Lombardi");
  });

  it("con più comuni possibili sceglie il nome più corto, il più probabile", () => {
    expect(findTown(towns, "san")?.name).toBe("San Nicola Baronia");
  });

  it("niente comune per una ricerca vuota o senza corrispondenze", () => {
    expect(findTown(towns, "  ")).toBeNull();
    expect(findTown(towns, "napoli")).toBeNull();
  });
});

describe("ricerca locale", () => {
  it("normalizza accenti, maiuscole e abbreviazioni MIMIT", () => {
    expect(normalize("V.LE Italia, ARIANO Irpino")).toBe("viale italia ariano irpino");
    expect(normalize("S.S. 7 km 300 - Località Pianodardine")).toBe(
      "statale 7 km 300 localita pianodardine",
    );
  });

  it("trova per inizio di parola, con tutte le parole della ricerca", () => {
    const text = normalize("Agip Eni ENI ARIANO Via Cardito 12 ARIANO IRPINO");
    expect(matches(text, "aria")).toBe(true);
    expect(matches(text, "eni cardito")).toBe(true);
    expect(matches(text, "q8 ariano")).toBe(false);
    expect(matches(text, "  ")).toBe(true);
  });
});

describe("geografia (solo sul dispositivo)", () => {
  const avellino = { lat: 40.914, lon: 14.7906 };
  const atripalda = { lat: 40.9201, lon: 14.8312 };

  it("distanza Avellino → Atripalda ≈ 3,5 km", () => {
    expect(distanceKm(avellino, atripalda)).toBeCloseTo(3.48, 1);
  });

  it("formatta metri e chilometri all'italiana", () => {
    expect(formatDistance(0.123)).toBe("120 m");
    expect(formatDistance(3.48)).toBe("3,5 km");
    expect(formatDistance(23.4)).toBe("23 km");
  });

  it("centro di un comune = media dei suoi distributori", () => {
    expect(centroid([avellino, atripalda])).toEqual({ lat: 40.91705, lon: 14.8109 });
    expect(centroid([])).toBeNull();
  });
});

describe("navigatore", () => {
  it("passa solo la destinazione, mai l'origine", () => {
    for (const app of ["google", "apple", "geo"] as const) {
      const url = directionsUrl(app, 40.914, 14.7906, "Eni Avellino");
      expect(url).toContain("40.914,14.7906");
      expect(url).not.toMatch(/origin|saddr/);
    }
  });

  it("percorso di un distributore: andata e ritorno", () => {
    expect(parseStationPath(stationPath(12345))).toBe(12345);
    expect(parseStationPath("/d/abc")).toBeNull();
    expect(parseStationPath("/")).toBeNull();
  });
});

describe("anagrafica nel client", () => {
  it("converte coordinate e carburanti dal formato compatto", () => {
    const reg: ProvinceRegistry = {
      v: 1,
      prov: "AV",
      src: "MIMIT",
      date: "2026-10-22",
      brands: ["Q8"],
      st: [
        [
          7,
          4092010,
          1483120,
          0,
          "Q8 ATRIPALDA",
          "VIA ROMA 12",
          "ATRIPALDA",
          FUEL_BIT.B | FUEL_BIT.L,
        ],
      ],
    };
    const [s] = stationsFromRegistry(reg);
    expect(s).toMatchObject({ id: 7, lat: 40.9201, lon: 14.8312, brand: "Q8", fuels: ["B", "L"] });
    expect(fuelsFromMask(FUEL_BIT.H)).toEqual(["H"]);
  });
});

import { vi } from "vitest";
import { POSITION_HELP, PositionTimeout, positionHelp, withTimeout } from "./position.ts";

describe("posizione che non arriva (es. browser interno di Instagram)", () => {
  it("withTimeout smette di aspettare una richiesta senza risposta", async () => {
    vi.useFakeTimers();
    try {
      const never = withTimeout(new Promise<never>(() => {}), 20_000);
      const check = expect(never).rejects.toBeInstanceOf(PositionTimeout);
      await vi.advanceTimersByTimeAsync(20_000);
      await check;
    } finally {
      vi.useRealTimers();
    }
  });

  it("withTimeout lascia passare risultati ed errori arrivati in tempo", async () => {
    await expect(withTimeout(Promise.resolve(7), 1_000)).resolves.toBe(7);
    await expect(withTimeout(Promise.reject({ code: 1 }), 1_000)).rejects.toEqual({ code: 1 });
  });

  it("permesso negato, API assente o nessuna risposta: suggerisce di aprire nel browser", () => {
    for (const err of [
      { code: 1 },
      new Error("geolocalizzazione non disponibile"),
      new PositionTimeout(),
    ]) {
      expect(positionHelp(err)).toBe(POSITION_HELP.blocked);
    }
    expect(POSITION_HELP.blocked).toContain("Apri nel browser");
  });

  it("posizione non trovata o scaduta: suggerisce il comune", () => {
    expect(positionHelp({ code: 2 })).toBe(POSITION_HELP.unavailable);
    expect(positionHelp({ code: 3 })).toBe(POSITION_HELP.unavailable);
  });
});

import { PULL_TRIGGER_PX, pullProgress } from "./pull.ts";
import { townArea } from "./search.ts";

describe("ricerca di un comune che ha distributori: anche i vicini", () => {
  const town: Town = { name: "Grottaminarda", key: "grottaminarda", lat: 41, lon: 15 };
  // ~1,1 km per 0,01° di latitudine
  const st = (name: string, comune: string, dLat: number) => ({
    name,
    town: comune,
    lat: 41 + dLat,
    lon: 15,
  });
  const stations = [
    st("in paese", "GROTTAMINARDA", 0.01),
    st("frazione lontana", "Grottaminarda", 0.2),
    st("comune vicino", "Mirabella Eclano", 0.05),
    st("altra valle", "Lioni", 0.4),
  ];

  it("i distributori del comune, anche lontani dal centro, più quelli entro il raggio", () => {
    expect(
      townArea(stations, town, 15, 1)
        .map((s) => s.name)
        .sort(),
    ).toEqual(["comune vicino", "frazione lontana", "in paese"]);
  });

  it("se nel raggio ce ne sono pochi, comunque i più vicini", () => {
    expect(townArea(stations, town, 1, 3).map((s) => s.name)).toContain("comune vicino");
  });
});

describe("tira giù per aggiornare", () => {
  it("l'indicatore cresce con il dito, fino a un massimo", () => {
    expect(pullProgress(-20)).toEqual({ height: 0, ready: false });
    expect(pullProgress(40)).toEqual({ height: 20, ready: false });
    expect(pullProgress(1000).height).toBe(75);
  });

  it("al rilascio aggiorna solo oltre la soglia", () => {
    expect(pullProgress(PULL_TRIGGER_PX - 1).ready).toBe(false);
    expect(pullProgress(PULL_TRIGGER_PX).ready).toBe(true);
  });
});
