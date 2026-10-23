import { describe, expect, it } from "vitest";
import type { ProvinceRegistry } from "../domain/mimit.ts";
import { FUEL_BIT } from "../domain/mimit.ts";
import { fuelsFromMask, stationsFromRegistry } from "./data.ts";
import { centroid, distanceKm, formatDistance } from "./geo.ts";
import { directionsUrl, parseStationPath, stationPath } from "./nav.ts";
import { matches, normalize } from "./search.ts";

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
