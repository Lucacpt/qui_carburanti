import { describe, expect, it } from "vitest";
import { assertJurisdiction, located } from "./jurisdiction.ts";

/** Namespace finto: ricorda la giurisdizione richiesta, come fa quello di Cloudflare. */
class FakeNamespace {
  readonly scope: string;
  constructor(scope = "globale") {
    this.scope = scope;
  }
  jurisdiction(j: "eu"): FakeNamespace {
    return new FakeNamespace(j);
  }
}

describe("located", () => {
  it('con "eu" usa il sotto-namespace UE', () => {
    expect(located({ DO_JURISDICTION: "eu" }, new FakeNamespace()).scope).toBe("eu");
  });

  it('con "none" (solo sviluppo locale) lascia il namespace com\'è', () => {
    expect(located({ DO_JURISDICTION: "none" }, new FakeNamespace()).scope).toBe("globale");
  });

  it("si ferma se la variabile manca: un env di wrangler senza vars non crea oggetti fuori dall'UE", () => {
    expect(() => located({}, new FakeNamespace())).toThrow(/assente/);
    expect(() => located({ DO_JURISDICTION: "" }, new FakeNamespace())).toThrow();
    expect(() => located({ DO_JURISDICTION: "us" }, new FakeNamespace())).toThrow(/us/);
  });
});

describe("assertJurisdiction", () => {
  it("accetta un oggetto creato nell'UE", () => {
    expect(() =>
      assertJurisdiction({ jurisdiction: "eu" }, { DO_JURISDICTION: "eu" }),
    ).not.toThrow();
  });

  it("rifiuta un oggetto senza giurisdizione o in un'altra (un get che ha saltato located)", () => {
    expect(() => assertJurisdiction({}, { DO_JURISDICTION: "eu" })).toThrow(/nessuna/);
    expect(() => assertJurisdiction({ jurisdiction: "us" }, { DO_JURISDICTION: "eu" })).toThrow();
    expect(() => assertJurisdiction({}, {})).toThrow();
  });

  it('in locale ("none") non controlla: workerd non supporta le giurisdizioni', () => {
    expect(() => assertJurisdiction({}, { DO_JURISDICTION: "none" })).not.toThrow();
  });
});
