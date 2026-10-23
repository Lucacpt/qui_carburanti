// Interfaccia di QUI: lista, ricerca, dettaglio, segnalazione, contestazione (RAD §3.2).

import { describeState, OPERATOR_LINK_TEXT } from "../domain/labels.ts";
import type { Reliability } from "../domain/reliability.ts";
import { rowToResult } from "../domain/snapshot.ts";
import { FUELS, type Fuel, type Queue, State, type StateResult } from "../domain/types.ts";
import { preparePow, sendContest, sendReport } from "./api.ts";
import {
  FUEL_NAMES,
  loadSnapshot,
  loadStations,
  rowKey,
  type SnapshotData,
  type Station,
} from "./data.ts";
import { centroid, distanceKm, formatDistance, NEAR_KM, type Point } from "./geo.ts";
import {
  clearStoredData,
  currentToken,
  incrementHelped,
  mapsApp,
  markNoticeSeen,
  newToken,
  noticeSeen,
  STORAGE_KEYS,
  savedFuel,
  saveFuel,
  setMapsApp,
  storedData,
} from "./local.ts";
import { directionsUrl, MAPS_APPS, type MapsApp, parseStationPath, stationPath } from "./nav.ts";
import { matches, normalize } from "./search.ts";
import { announce, h, openSheet, reliabilityBadge, STATE_UI } from "./view.ts";

const PROV = "AV";
const REFRESH_MS = 90_000;
const PAGE = 40;
const PROCEDURE_URL =
  "https://github.com/Lucacpt/qui_carburanti/blob/main/docs/procedure/contestazioni.md";
const DATA_PATH = "/dati";

type FuelFilter = Fuel | "all";

interface FuelStatus {
  readonly result: StateResult;
  readonly reliability: Reliability;
  readonly queue: number;
  readonly limit: number;
  /** Solo sul grigio: ultima disponibilità confermata nelle 24 ore. */
  readonly lastGreenMs: number | null;
}

const GREY: StateResult = {
  state: State.GREY,
  confirmations: 0,
  lastConfirmMs: null,
  absences: 0,
  lastAbsenceMs: null,
  flags: 0,
  evidence: [],
};

const initialFuel = savedFuel();
const ui = {
  stations: [] as Station[],
  byId: new Map<number, Station>(),
  snap: null as SnapshotData | null,
  snapAt: 0,
  snapError: false,
  query: "",
  fuel: (FUELS.includes(initialFuel as Fuel) ? initialFuel : "all") as FuelFilter,
  /** Posizione dell'utente: solo in memoria, mai salvata né inviata. */
  origin: null as Point | null,
  limit: PAGE,
};

const app = document.getElementById("app") as HTMLElement;
const banner = document.getElementById("banner") as HTMLElement;

// ------------------------------------------------------------------ stato e ordinamento

/** Ora del server, stimata dall'ultimo snapshot: le etichette non dipendono dall'orologio del telefono. */
const now = () => (ui.snap ? ui.snap.t * 1000 + (Date.now() - ui.snapAt) : Date.now());

function statusOf(id: number, fuel: Fuel): FuelStatus {
  const key = rowKey(id, fuel);
  const row = ui.snap?.rows.get(key);
  if (!row || !ui.snap) {
    const lastGreenMs = ui.snap?.lastGreen.get(key) ?? null;
    return { result: GREY, reliability: 0, queue: 0, limit: 0, lastGreenMs };
  }
  return {
    result: rowToResult(row, ui.snap.t),
    reliability: row[7],
    queue: row[8],
    limit: row[9],
    lastGreenMs: null,
  };
}

function bestFuel(st: Station): { fuel: Fuel; status: FuelStatus } | null {
  const fuels = ui.fuel === "all" ? st.fuels : st.fuels.filter((f) => f === ui.fuel);
  let best: { fuel: Fuel; status: FuelStatus } | null = null;
  for (const fuel of fuels) {
    const status = statusOf(st.id, fuel);
    const rank = STATE_UI[status.result.state].rank;
    const bestRank = best ? STATE_UI[best.status.result.state].rank : 99;
    if (
      rank < bestRank ||
      (rank === bestRank && best && status.reliability > best.status.reliability)
    ) {
      best = { fuel, status };
    }
  }
  return best;
}

/** Punto di riferimento: la posizione dell'utente, oppure il centro del comune cercato. */
function referencePoint(results: readonly Station[]): Point | null {
  if (ui.origin) return ui.origin;
  const q = normalize(ui.query);
  if (!q) return null;
  const town = results.filter((s) => normalize(s.town) === q);
  return centroid(town.length > 0 ? town : []);
}

function sortedResults() {
  const results = ui.stations.filter((s) => matches(s.text, ui.query));
  const ref = referencePoint(results);
  return results
    .map((st) => ({ st, best: bestFuel(st), dist: ref ? distanceKm(ref, st) : null }))
    .filter(
      (x): x is { st: Station; best: NonNullable<typeof x.best>; dist: number | null } => !!x.best,
    )
    .sort(
      (a, b) =>
        STATE_UI[a.best.status.result.state].rank - STATE_UI[b.best.status.result.state].rank ||
        (a.dist ?? 0) - (b.dist ?? 0) ||
        b.best.status.reliability - a.best.status.reliability ||
        a.st.name.localeCompare(b.st.name),
    );
}

// ------------------------------------------------------------------ componenti

const QUEUE_TEXT = ["", "nessuna coda", "coda breve", "coda lunga"];

function extras(s: FuelStatus): string {
  const parts = [QUEUE_TEXT[s.queue] ?? "", s.limit ? "⚠ limite di erogazione" : ""];
  return parts.filter(Boolean).join(" · ");
}

function statusLine(fuel: Fuel, s: FuelStatus): HTMLElement {
  const label = describeState(s.result, now(), s.lastGreenMs);
  const ui_ = STATE_UI[s.result.state];
  const more = extras(s);
  return h(
    "div",
    { class: `status ${ui_.cls}` },
    h("span", { class: "shape", "aria-hidden": "true" }, ui_.shape),
    h("strong", {}, `${FUEL_NAMES[fuel]}: ${label.title}`),
    h("span", { class: "muted" }, ` · ${label.detail}`),
    " ",
    reliabilityBadge(s.reliability),
    more ? h("span", { class: "extras" }, ` · ${more}`) : null,
  );
}

function fuelBadges(st: Station): HTMLElement {
  return h(
    "div",
    { class: "badges" },
    ...st.fuels.map((f) => {
      const s = STATE_UI[statusOf(st.id, f).result.state];
      return h("span", { class: `badge ${s.cls}` }, `${s.shape} ${FUEL_NAMES[f]}`);
    }),
  );
}

function card(st: Station, best: { fuel: Fuel; status: FuelStatus }, dist: number | null) {
  return h(
    "li",
    {},
    h(
      "a",
      {
        class: "card",
        href: stationPath(st.id),
        onClick: (e) => {
          e.preventDefault();
          go(stationPath(st.id));
        },
      },
      h(
        "div",
        { class: "card-top" },
        h(
          "span",
          { class: "title" },
          h("strong", {}, st.brand),
          h("span", { class: "muted" }, ` ${st.name}`),
        ),
        dist !== null ? h("span", { class: "dist" }, formatDistance(dist)) : null,
      ),
      h("div", { class: "addr" }, `${st.address}, ${st.town}`),
      statusLine(best.fuel, best.status),
      ui.fuel === "all" && st.fuels.length > 1 ? fuelBadges(st) : null,
    ),
  );
}

function chips<T>(
  options: ReadonlyArray<[T, string]>,
  onPick: (v: T | undefined) => void,
  initial?: T,
) {
  const group = h("div", { class: "chips", role: "group" });
  for (const [value, label] of options) {
    const b = h(
      "button",
      {
        type: "button",
        class: "chip",
        "aria-pressed": value === initial ? "true" : "false",
        onClick: () => {
          const on = b.getAttribute("aria-pressed") !== "true";
          for (const c of group.children) c.setAttribute("aria-pressed", "false");
          b.setAttribute("aria-pressed", on ? "true" : "false");
          onPick(on ? value : undefined);
        },
      },
      label,
    );
    group.append(b);
  }
  return group;
}

// ------------------------------------------------------------------ posizione

function getPosition(highAccuracy: boolean): Promise<Point> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(new Error("geolocalizzazione non disponibile"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
      reject,
      { enableHighAccuracy: highAccuracy, timeout: 12_000, maximumAge: highAccuracy ? 0 : 60_000 },
    );
  });
}

// ------------------------------------------------------------------ vista lista

const results = h("ol", { class: "results" });
const summary = h("p", { class: "muted summary", "aria-live": "polite" });
/** Quando nessuno ha confermato carburante (tipicamente di notte o al mattino presto). */
const invite = h(
  "p",
  { class: "note-box", hidden: true },
  "In questo momento arrivano poche segnalazioni: lo stato si aggiorna appena qualcuno passa. Sei a un distributore? Aprilo e tocca «C'è» o «Non c'è»: aiuti chi cerca.",
);
const more = h(
  "button",
  {
    type: "button",
    class: "btn",
    onClick: () => {
      ui.limit += PAGE;
      updateResults();
    },
  },
  "Mostra altri",
);

const posButton = h(
  "button",
  { type: "button", class: "btn", onClick: () => void usePosition() },
  "📍 Usa la mia posizione",
);

const listView = h(
  "div",
  { class: "list" },
  h(
    "div",
    { class: "controls" },
    h("label", { for: "q", class: "sr-only" }, "Cerca comune, via o marchio"),
    h("input", {
      id: "q",
      type: "search",
      placeholder: "Cerca comune, via o marchio",
      autocomplete: "off",
      enterkeyhint: "search",
      onInput: (e) => {
        ui.query = (e.target as HTMLInputElement).value;
        ui.limit = PAGE;
        updateResults();
      },
    }),
    posButton,
    chips<FuelFilter>(
      [["all", "Tutti"], ...FUELS.map((f): [FuelFilter, string] => [f, FUEL_NAMES[f]])],
      (v) => {
        ui.fuel = v ?? "all";
        saveFuel(ui.fuel);
        updateResults();
      },
      ui.fuel,
    ),
  ),
  summary,
  invite,
  results,
  more,
);

async function usePosition(): Promise<void> {
  posButton.textContent = "Cerco la posizione…";
  try {
    ui.origin = await getPosition(false);
    posButton.textContent = "📍 Ordinati per distanza da te";
    announce("Distributori ordinati per distanza");
  } catch {
    posButton.textContent = "📍 Usa la mia posizione";
    announce("Posizione non disponibile: cerca il tuo comune");
  }
  updateResults();
}

function updateResults(): void {
  const all = sortedResults();
  const green = all.filter((x) => x.best.status.result.state === State.GREEN).length;
  const lastHour = ui.snap?.lastHour;
  summary.textContent =
    `${all.length} distributori` +
    (green > 0 ? ` · ${green} con carburante segnalato` : "") +
    (lastHour === undefined
      ? ""
      : ` · ${lastHour === 1 ? "1 segnalazione" : `${lastHour} segnalazioni`} nell'ultima ora in provincia`) +
    (ui.origin || ui.query ? "" : " · cerca il tuo comune o usa la posizione");
  invite.hidden = !ui.snap || green > 0 || all.length === 0;
  results.replaceChildren(
    ...all.slice(0, ui.limit).map(({ st, best, dist }) => card(st, best, dist)),
  );
  more.hidden = all.length <= ui.limit;
}

// ------------------------------------------------------------------ vista dettaglio

function navLinks(st: Station): HTMLElement {
  const preferred = mapsApp();
  const link = (app: MapsApp, label: string, cls: string) =>
    h(
      "a",
      {
        class: cls,
        href: directionsUrl(app, st.lat, st.lon, `${st.brand} ${st.name}`),
        target: "_blank",
        rel: "noopener noreferrer",
        onClick: () => setMapsApp(app),
      },
      label,
    );
  return h(
    "div",
    { class: "nav" },
    link(preferred, "🧭 Portami qui", "btn primary"),
    h(
      "p",
      { class: "muted small" },
      "Apri con: ",
      ...MAPS_APPS.flatMap(({ id, label }, i) => [i > 0 ? " · " : "", link(id, label, "")]),
    ),
  );
}

async function share(st: Station): Promise<void> {
  const url = `${location.origin}${stationPath(st.id)}`;
  const text = `${st.brand} ${st.name}, ${st.address} (${st.town}): stato del carburante su QUI`;
  try {
    if (navigator.share) await navigator.share({ title: "QUI", text, url });
    else {
      await navigator.clipboard.writeText(`${text} ${url}`);
      announce("Link copiato");
    }
  } catch {
    // condivisione annullata dall'utente
  }
}

function renderDetail(id: number): HTMLElement {
  const st = ui.byId.get(id);
  const back = h(
    "button",
    { type: "button", class: "btn back", onClick: () => go("/") },
    "← Tutti i distributori",
  );
  if (!st) return h("div", {}, back, h("p", {}, "Distributore non trovato."));

  document.title = `${st.brand} ${st.name} — QUI`;
  preparePow(PROV);
  const statuses = st.fuels.map((fuel) => ({ fuel, status: statusOf(st.id, fuel) }));
  const note = ui.snap?.frozen.get(st.id);
  const operator = statuses.some((s) => describeState(s.status.result, now()).operatorLink);
  const readOnly = ui.snap?.readOnly ?? false;

  return h(
    "div",
    { class: "detail" },
    back,
    h("h2", {}, `${st.brand} — ${st.name}`),
    h("p", {}, `${st.address}, ${st.town}`),
    ui.origin
      ? h("p", { class: "muted" }, `A ${formatDistance(distanceKm(ui.origin, st))} da te`)
      : null,
    note ? h("p", { class: "note-box" }, `ℹ ${note}`) : null,
    ...statuses.map(({ fuel, status }) =>
      h(
        "section",
        { class: "fuel" },
        statusLine(fuel, status),
        readOnly
          ? h("p", { class: "muted" }, "Segnalazioni sospese temporaneamente.")
          : h(
              "div",
              { class: "report" },
              h(
                "button",
                { type: "button", class: "btn yes", onClick: () => openReport(st, fuel, true) },
                `✓ C'è ${FUEL_NAMES[fuel]}`,
              ),
              h(
                "button",
                { type: "button", class: "btn no", onClick: () => openReport(st, fuel, false) },
                `✕ Non c'è`,
              ),
            ),
      ),
    ),
    h(
      "p",
      { class: "muted small" },
      "🚗 Non usare il telefono mentre guidi: fai segnalare a chi è con te.",
    ),
    navLinks(st),
    h("button", { type: "button", class: "btn", onClick: () => void share(st) }, "Condividi"),
    // Sempre visibile, anche in sola lettura (ADR-0011, rev. 2026-10-23): il gestore può dover
    // correggere un "Disponibile" sbagliato, un impianto chiuso o i dati dell'anagrafica.
    // In evidenza quando ci sono segnalazioni di assenza.
    h(
      "p",
      { class: operator ? "note-box" : undefined },
      h(
        "button",
        { type: "button", class: "link", onClick: () => openContest(st) },
        OPERATOR_LINK_TEXT,
      ),
    ),
    h(
      "p",
      { class: "muted small" },
      "Informazioni degli utenti, non verificate. Non è una fonte ufficiale.",
    ),
  );
}

// ------------------------------------------------------------------ segnalazione

function openReport(st: Station, fuel: Fuel, has: boolean): void {
  const sheet = openSheet(`${has ? "C'è" : "Non c'è"} ${FUEL_NAMES[fuel]}`);
  const step = (...nodes: Array<Node | string>) => sheet.body.replaceChildren(...nodes);
  let near = false;

  const send = async (extra: { q?: Queue; lim?: 0 | 1 }) => {
    step(h("p", {}, "Invio in corso…"));
    const tk = currentToken() ?? newToken();
    const res = await sendReport(PROV, {
      id: st.id,
      f: fuel,
      h: has ? 1 : 0,
      n: near ? 1 : 0,
      tk,
      ...extra,
    });
    if (!res.ok) {
      step(
        h("p", { class: "err" }, res.message),
        h("button", { class: "btn", onClick: sheet.close }, "Chiudi"),
      );
      return;
    }
    const n = incrementHelped();
    announce("Segnalazione inviata, grazie");
    step(
      h("p", { class: "ok" }, "Grazie!"),
      h(
        "p",
        {},
        `Hai aiutato ${n} ${n === 1 ? "volta" : "volte"}. Lo stato si aggiorna entro un minuto.`,
      ),
      h("button", { class: "btn primary", onClick: sheet.close }, "Chiudi"),
    );
    window.setTimeout(() => void refresh(), 35_000);
  };

  const askExtras = () => {
    const extra: { q?: Queue; lim?: 0 | 1 } = {};
    step(
      h("p", {}, near ? "✓ Sei al distributore." : "Segnalazione da remoto."),
      h("p", {}, "C'è coda? (facoltativo)"),
      chips<Queue>(
        [
          [1, "Nessuna"],
          [2, "Breve (< 15')"],
          [3, "Lunga (> 15')"],
        ],
        (v) => {
          if (v === undefined) delete extra.q;
          else extra.q = v;
        },
      ),
      h("p", {}, "C'è un limite di erogazione? (facoltativo)"),
      chips<0 | 1>(
        [
          [0, "No"],
          [1, "Sì"],
        ],
        (v) => {
          if (v === undefined) delete extra.lim;
          else extra.lim = v;
        },
      ),
      h("button", { class: "btn primary", onClick: () => void send(extra) }, "Invia"),
    );
  };

  const proceed = (isNear: boolean) => {
    near = isNear;
    if (has) askExtras();
    else void send({});
  };

  const checkNear = async () => {
    step(h("p", {}, "Verifico la posizione…"));
    try {
      const p = await getPosition(true);
      ui.origin = p;
      const isNear = distanceKm(p, st) <= NEAR_KM;
      if (isNear) proceed(true);
      else {
        step(
          h(
            "p",
            {},
            `Risulti a ${formatDistance(distanceKm(p, st))}: la segnalazione varrà come da remoto.`,
          ),
          h("button", { class: "btn primary", onClick: () => proceed(false) }, "Continua"),
        );
      }
    } catch {
      step(
        h("p", {}, "Posizione non disponibile: la segnalazione varrà come da remoto."),
        h("button", { class: "btn primary", onClick: () => proceed(false) }, "Continua"),
      );
    }
  };

  const askWhere = () =>
    step(
      h("p", {}, "Sei al distributore adesso?"),
      h(
        "button",
        { class: "btn primary", onClick: () => void checkNear() },
        "📍 Sì, sono qui (verifica)",
      ),
      h(
        "p",
        { class: "muted small" },
        "Una sola lettura della posizione, che resta sul tuo telefono. Sul posto la segnalazione vale 4 volte di più.",
      ),
      h("button", { class: "btn", onClick: () => proceed(false) }, "No, segnalo da remoto"),
    );

  if (noticeSeen()) askWhere();
  else
    step(
      h(
        "p",
        {},
        "Per evitare lo spam, QUI salva sul tuo telefono un codice casuale che cambia ogni giorno. Nessun cookie, nessun tracciamento.",
      ),
      h(
        "p",
        {},
        "Segnala solo ciò che hai visto e mai mentre guidi. Inviando accetti i ",
        h("a", { href: "/termini" }, "Termini d'uso"),
        ".",
      ),
      h(
        "p",
        {},
        h("a", { href: "/come-funziona" }, "Come funziona"),
        " · ",
        h("a", { href: "/privacy" }, "Privacy"),
      ),
      h(
        "button",
        {
          class: "btn primary",
          onClick: () => {
            markNoticeSeen();
            askWhere();
          },
        },
        "Ho capito",
      ),
    );
}

// ------------------------------------------------------------------ contestazione

const REASONS: ReadonlyArray<[string, string]> = [
  ["has_fuel", "Ho carburante"],
  ["no_fuel", "Non ho carburante"],
  ["closed", "L'impianto è chiuso"],
  ["wrong_data", "I dati dell'impianto sono sbagliati"],
  ["other", "Altro"],
];

function openContest(st: Station): void {
  const sheet = openSheet("Segnala un errore");
  let reason = "";
  const contact = h("input", {
    type: "text",
    maxlength: "120",
    autocomplete: "email",
    placeholder: "Email o telefono (facoltativo)",
  });
  sheet.body.replaceChildren(
    h("p", {}, `${st.brand} — ${st.name}, ${st.address}`),
    h(
      "fieldset",
      {},
      h("legend", {}, "Motivo"),
      ...REASONS.map(([value, label]) =>
        h(
          "label",
          { class: "radio" },
          h("input", {
            type: "radio",
            name: "reason",
            value,
            onChange: () => {
              reason = value;
            },
          }),
          ` ${label}`,
        ),
      ),
    ),
    contact,
    h(
      "p",
      { class: "muted small" },
      "Il contatto serve solo per risponderti e viene cancellato dopo 30 giorni. ",
      h("a", { href: "/privacy#contestazioni" }, "Informativa privacy"),
    ),
    h(
      "button",
      {
        class: "btn primary",
        onClick: async () => {
          if (!reason) {
            announce("Scegli un motivo");
            return;
          }
          sheet.body.replaceChildren(h("p", {}, "Invio in corso…"));
          const c = contact.value.trim();
          const res = await sendContest(PROV, { id: st.id, reason, ...(c ? { contact: c } : {}) });
          sheet.body.replaceChildren(
            res.ok
              ? h(
                  "p",
                  { class: "ok" },
                  "Grazie. Durante l'emergenza cerchiamo di rispondere entro 4 ore (dalle 8 alle 22).",
                )
              : h("p", { class: "err" }, res.message),
            h(
              "p",
              {},
              h(
                "a",
                { href: PROCEDURE_URL, target: "_blank", rel: "noopener noreferrer" },
                "Come gestiamo le segnalazioni",
              ),
            ),
            h("button", { class: "btn", onClick: sheet.close }, "Chiudi"),
          );
        },
      },
      "Invia",
    ),
  );
}

// ------------------------------------------------------------------ i tuoi dati

function dataValue(key: string, value: string): string {
  if (key === STORAGE_KEYS.token) {
    const [day, token] = value.split("|");
    return `${token ?? ""} — creato il ${day ?? "?"}, non viene più usato dopo la mezzanotte`;
  }
  if (key === STORAGE_KEYS.notice) return value === "1" ? "sì" : value;
  if (key === STORAGE_KEYS.maps) return MAPS_APPS.find((a) => a.id === value)?.label ?? value;
  if (key === STORAGE_KEYS.fuel) return FUEL_NAMES[value as Fuel] ?? value;
  return value;
}

/** Trasparenza pratica: mostra esattamente ciò che è salvato e lo cancella con un tocco. */
function renderMyData(): HTMLElement {
  document.title = "I tuoi dati — QUI";
  const items = storedData();
  const confirmClear = () => {
    const sheet = openSheet("Cancellare i dati?");
    sheet.body.replaceChildren(
      h("p", {}, "Cancelli tutto ciò che QUI ha salvato su questo telefono. Non si può annullare."),
      h(
        "button",
        {
          class: "btn no",
          onClick: () => {
            clearStoredData();
            sheet.close();
            announce("Dati cancellati");
            render();
          },
        },
        "Sì, cancella",
      ),
      h("button", { class: "btn", onClick: sheet.close }, "Annulla"),
    );
  };
  return h(
    "div",
    { class: "page" },
    h(
      "button",
      { type: "button", class: "btn back", onClick: () => go("/") },
      "← Torna alla lista",
    ),
    h("h2", {}, "I tuoi dati su questo telefono"),
    h(
      "p",
      {},
      "QUI non ha account e non sa chi sei. Ecco tutto ciò che ha salvato sul tuo telefono (non sul server):",
    ),
    items.length > 0
      ? h(
          "ul",
          { class: "data-list" },
          ...items.map((i) =>
            h(
              "li",
              {},
              h("strong", {}, i.label),
              h("br"),
              h("span", { class: "muted small" }, dataValue(i.key, i.value)),
            ),
          ),
        )
      : h("p", { class: "ok" }, "Niente: su questo telefono QUI non ha salvato nulla."),
    items.length > 0 && h("button", { class: "btn no", onClick: confirmClear }, "Cancella tutto"),
    h(
      "p",
      { class: "muted small" },
      "Sul server le segnalazioni restano al massimo 8 ore e non contengono né il tuo indirizzo IP né la tua posizione. Dettagli: ",
      h("a", { href: "/privacy" }, "Informativa privacy"),
      " · ",
      h("a", { href: "/cookie" }, "Cookie"),
      ".",
    ),
  );
}

// ------------------------------------------------------------------ navigazione e aggiornamento

const CANONICAL_ORIGIN = "https://quicarburanti.it";

/**
 * Canonical della pagina mostrata (docs/08-seo.md). index.html serve anche /d/<id>: un canonical
 * fisso nell'HTML direbbe ai motori di ricerca che ogni scheda è una copia della home.
 */
function setCanonical(path: string | null): void {
  let link = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (path === null) {
    link?.remove();
    return;
  }
  if (!link) {
    link = document.createElement("link");
    link.rel = "canonical";
    document.head.append(link);
  }
  link.href = `${CANONICAL_ORIGIN}${path}`;
}

function render(): void {
  if (location.pathname === DATA_PATH) {
    setCanonical(null);
    app.replaceChildren(renderMyData());
    renderBanner();
    return;
  }
  const id = parseStationPath(location.pathname);
  if (id !== null) {
    setCanonical(`/d/${id}`);
    app.replaceChildren(renderDetail(id));
  } else {
    setCanonical("/");
    document.title = "QUI — dove c'è carburante, adesso";
    // La lista resta lo stesso elemento: chi sta scrivendo nella ricerca non perde il focus.
    if (listView.parentElement !== app) app.replaceChildren(listView);
    updateResults();
  }
  renderBanner();
}

function go(path: string): void {
  history.pushState({}, "", path);
  render();
  window.scrollTo(0, 0);
}

function renderBanner(): void {
  const text = ui.snap?.readOnly
    ? "Segnalazioni sospese temporaneamente. I dati mostrati potrebbero non essere aggiornati."
    : ui.snapError
      ? "Connessione assente: i dati potrebbero non essere aggiornati."
      : "";
  banner.textContent = text;
  banner.hidden = !text;
}

async function refresh(): Promise<void> {
  try {
    ui.snap = await loadSnapshot(PROV);
    ui.snapAt = Date.now();
    ui.snapError = false;
  } catch {
    ui.snapError = true;
  }
  // Non ridisegnare il dettaglio mentre l'utente sta segnalando.
  if (!document.querySelector(".overlay")) render();
}

async function init(): Promise<void> {
  // "I tuoi dati" non dipende dalla rete: si mostra subito, anche offline.
  if (location.pathname === DATA_PATH) render();
  try {
    ui.stations = await loadStations(PROV);
    ui.byId = new Map(ui.stations.map((s) => [s.id, s]));
  } catch {
    if (location.pathname === DATA_PATH) return;
    app.replaceChildren(
      h("p", {}, "Impossibile caricare i distributori. Controlla la connessione."),
      h("button", { class: "btn primary", onClick: () => location.reload() }, "Riprova"),
    );
    return;
  }
  await refresh();
  window.addEventListener("popstate", render);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void refresh();
  });
  window.setInterval(() => {
    if (document.visibilityState === "visible") void refresh();
  }, REFRESH_MS);
}

void init();
