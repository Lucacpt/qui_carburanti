// I comuni pubblicati in public/r/ sono validi e coerenti con l'anagrafica MIMIT: ogni comune che ha
// distributori deve esistere anche nell'elenco dei comuni (stesso nome, una volta normalizzato).

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { normalize } from "../src/client/search.ts";
import type { ProvinceRegistry } from "../src/domain/mimit.ts";
import { type TownsFile, validateTowns } from "../src/domain/towns.ts";

const read = <T>(path: string) =>
  JSON.parse(readFileSync(new URL(`../public/r/${path}`, import.meta.url), "utf8")) as T;
const manifest = read<{ files: Record<string, string>; comuni?: Record<string, string> }>(
  "manifest.json",
);

describe("public/r: comuni", () => {
  for (const [prov, file] of Object.entries(manifest.files)) {
    it(`${prov}: elenco dei comuni presente e valido`, () => {
      const towns = manifest.comuni?.[prov];
      expect(towns, `manca manifest.comuni.${prov}: npm run import:comuni`).toBeDefined();
      const data = read<TownsFile>(towns ?? "");
      expect(data.prov).toBe(prov);
      expect(validateTowns(data.co, prov)).toEqual([]);
    });

    it(`${prov}: ogni comune dell'anagrafica MIMIT è nell'elenco dei comuni`, () => {
      const names = new Set(
        read<TownsFile>(manifest.comuni?.[prov] ?? "").co.map((c) => normalize(c[0])),
      );
      const reg = read<ProvinceRegistry>(file);
      const missing = [...new Set(reg.st.map((s) => s[6]))].filter((t) => !names.has(normalize(t)));
      expect(missing).toEqual([]);
    });
  }
});
