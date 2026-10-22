import { describe, expect, it } from "vitest";
import {
  buildProvinceRegistry,
  classifyFuel,
  FUEL_BIT,
  parseMimitCsv,
  validateRegistry,
} from "./mimit.ts";

const ANAG = `Estrazione del 2026-10-21
idImpianto|Gestore|Bandiera|Tipo Impianto|Nome Impianto|Indirizzo|Comune|Provincia|Latitudine|Longitudine
3|X SRL|Q8|Stradale|Q8 ATRIPALDA|VIA ROMA  12 |ATRIPALDA|AV|40.9201|14.8312
1|Y SRL|Agip Eni|Stradale|ENI AVELLINO|VIA NAZIONALE   1|AVELLINO|AV|40.9140|14.7906
2|Z SRL|IP|Stradale|IP SENZA COORDINATE|VIA X|AVELLINO|AV|0|0
9|W SRL|Tamoil|Stradale|TAMOIL NAPOLI|VIA Y|NAPOLI|NA|40.85|14.26
4|V SRL||Stradale|POMPA BIANCA|VIA Z|ARIANO IRPINO|AV|41.15|15.09
`;

const PREZZI = `Estrazione del 2026-10-21
idImpianto|descCarburante|prezzo|isSelf|dtComu
1|Benzina|1.9|1|21/10/2026 08:00:00
1|Gasolio|1.8|1|21/10/2026 08:00:00
1|HVOlution|2.0|1|21/10/2026 08:00:00
3|GPL|0.8|0|21/10/2026 08:00:00
3|Hi-Q Diesel|1.9|1|21/10/2026 08:00:00
`;

describe("parseMimitCsv", () => {
  it("salta la riga 'Estrazione del' e legge l'intestazione", () => {
    const f = parseMimitCsv(ANAG);
    expect(f.extractedOn).toBe("2026-10-21");
    expect(f.header[0]).toBe("idImpianto");
    expect(f.rows).toHaveLength(5);
  });

  it("supporta il vecchio separatore ';'", () => {
    const f = parseMimitCsv("Estrazione del 2025-01-01\nidImpianto;descCarburante\n1;Benzina\n");
    expect(f.rows[0]).toEqual(["1", "Benzina"]);
  });

  it("rifiuta un file senza la riga di estrazione", () => {
    expect(() => parseMimitCsv("idImpianto|x\n1|y")).toThrow(/Estrazione/);
  });
});

describe("classifyFuel", () => {
  it.each([
    ["Benzina", "B"],
    ["Blue Super", "B"],
    ["HiQ Perform+", "B"],
    ["Gasolio", "G"],
    ["Supreme Diesel", "G"],
    ["Gasolio HVO", "H"],
    ["HVOlution", "H"],
    ["GPL", "L"],
    ["Metano", "M"],
    ["L-GNC", "M"],
    ["GNL", null],
    ["AdBlue", null],
  ] as const)("%s → %s", (desc, fuel) => {
    expect(classifyFuel(desc)).toBe(fuel);
  });
});

describe("buildProvinceRegistry", () => {
  const reg = buildProvinceRegistry(parseMimitCsv(ANAG), parseMimitCsv(PREZZI), "AV");

  it("tiene solo la provincia richiesta, scarta le coordinate non valide e ordina per id", () => {
    expect(reg.st.map((s) => s[0])).toEqual([1, 3, 4]);
  });

  it("normalizza spazi, coordinate ×1e5 e bandiera vuota → Pompe Bianche", () => {
    const eni = reg.st[0];
    expect(eni?.[5]).toBe("VIA NAZIONALE 1");
    expect(eni?.[1]).toBe(4091400);
    expect(reg.brands[reg.st[2]?.[3] ?? -1]).toBe("Pompe Bianche");
  });

  it("calcola i carburanti venduti dal file prezzi, con default Benzina+Gasolio", () => {
    const mask = (id: number) => reg.st.find((s) => s[0] === id)?.[7];
    expect(mask(1)).toBe(FUEL_BIT.B | FUEL_BIT.G | FUEL_BIT.H);
    expect(mask(3)).toBe(FUEL_BIT.L | FUEL_BIT.G);
    expect(mask(4)).toBe(FUEL_BIT.B | FUEL_BIT.G);
  });
});

describe("validateRegistry", () => {
  const reg = buildProvinceRegistry(parseMimitCsv(ANAG), parseMimitCsv(PREZZI), "AV");
  it("accetta variazioni piccole e rifiuta quelle oltre il 10%", () => {
    expect(validateRegistry(reg, 3)).toEqual([]);
    expect(validateRegistry(reg, 10)).toHaveLength(1);
  });
});
