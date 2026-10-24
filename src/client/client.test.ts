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
