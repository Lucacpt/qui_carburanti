import { describe, expect, it } from "vitest";
import { type TownRow, townsFromWikidata, validateTowns } from "./towns.ts";

const b = (istat: string, nome: string, coord: string) => ({
  istat: { value: istat },
  nome: { value: nome },
  coord: { value: coord },
});

describe("townsFromWikidata", () => {
  it("un comune per codice ISTAT, coordinate × 1e5, ordinati per nome", () => {
    const rows = townsFromWikidata([
      b("064121", "Montoro", "Point(14.76138889 40.82416667)"),
      b("064001", "Aiello del Sabato", "Point(14.821666666 40.89)"),
      b("064001", "Aiello del Sabato", "Point(14.9 40.9)"),
      b("064099", "Senza coordinate", "non è un punto"),
    ]);
    expect(rows).toEqual([
      ["Aiello del Sabato", 4089000, 1482167],
      ["Montoro", 4082417, 1476139],
    ]);
  });
});

describe("validateTowns", () => {
  const ok: TownRow[] = Array.from({ length: 118 }, (_, i) => [`Comune ${i}`, 4100000, 1500000]);

  it("accetta 118 comuni dentro la provincia di Avellino", () => {
    expect(validateTowns(ok, "AV")).toEqual([]);
  });

  it("si ferma se il numero cambia (fusioni) o se un comune è fuori provincia", () => {
    expect(validateTowns(ok.slice(1), "AV")[0]).toContain("117 comuni invece di 118");
    const outside: TownRow[] = [...ok.slice(1), ["Napoli", 4085180, 1426810]];
    expect(validateTowns(outside, "AV")).toEqual([
      "Napoli: coordinate fuori provincia (40.8518, 14.2681)",
    ]);
  });

  it("rifiuta una provincia non configurata", () => {
    expect(validateTowns(ok, "XX")[0]).toContain("senza comuni configurati");
  });
});
