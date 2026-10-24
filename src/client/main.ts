// Interfaccia di QUI: lista, ricerca, dettaglio, segnalazione, contestazione (RAD §3.2).

import { describeState, OPERATOR_LINK_TEXT, shortAge } from "../domain/labels.ts";
import type { Reliability } from "../domain/reliability.ts";
import { rowToResult } from "../domain/snapshot.ts";
import { FUELS, type Fuel, type Queue, State, type StateResult } from "../domain/types.ts";
import { preparePow, sendContest, sendReport } from "./api.ts";
import {
  FUEL_NAMES,
  loadSnapshot,
  loadStations,
  loadTowns,
  rowKey,
  type SnapshotData,
  type Station,
} from "./data.ts";
import { centroid, closest, distanceKm, formatDistance, NEAR_KM, type Point } from "./geo.ts";
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
import {
  POSITION_HELP,
  POSITION_SLOW_MS,
  POSITION_WAIT_MS,
  positionHelp,
  REPORT_REMOTE_HELP,
  withTimeout,
} from "./position.ts";
import { PULL_RESULT_MS } from "./pull.ts";
import { findTown, matches, normalize, searchSuggestions, type Town, townArea } from "./search.ts";
import { secureUrl } from "./secure.ts";
import { announce, h, onPullDown, openSheet, reliabilityBadge, STATE_UI } from "./view.ts";

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
  /** Comuni della provincia (1,5 KB): per la ricerca e l'autocompletamento. */
  towns: null as Town[] | null,
  townsLoading: false,
  /** "Mostra i più vicini con segnalazioni": il comune cercato e i suoi dintorni sono tutti grigi. */
  expand: false,
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

async function loadTownsOnce(): Promise<void> {
  if (ui.towns || ui.townsLoading) return;
  ui.townsLoading = true;
  try {
    ui.towns = await loadTowns(PROV);
  } catch {
    // Offline: resta la lista vuota di prima; al prossimo tasto si riprova.
  } finally {
    ui.townsLoading = false;
    fillSuggestions();
    updateResults();
  }
}

/**
 * Il comune indicato dalla ricerca ("grotta" → Grottaminarda), che abbia distributori o no: la lista
 * mostra i suoi e quelli dei comuni vicini, con il loro stato, come se chi cerca fosse lì.
 * Una ricerca che non è un comune (marchio, via) resta una ricerca nel testo.
 */
function searchedTown(): Town | null {
  if (!normalize(ui.query)) return null;
  if (!ui.towns) {
    void loadTownsOnce();
    return null;
  }
  return findTown(ui.towns, ui.query);
}

/** Attorno al comune cercato: i comuni vicini, non un'area di servizio a 40 km. */
const TOWN_RADIUS_KM = 7;
const TOWN_MIN_RESULTS = 5;
/** Quanti distributori con segnalazioni aggiungere quando i dintorni sono tutti grigi. */
const EXPAND_RESULTS = 10;

/** Indicato come chiuso da QUI: in fondo alla lista, con la nota nella scheda. */
function isClosed(id: number): boolean {
  return ui.snap?.closed.has(id) ?? false;
}

/** C'è almeno uno stato (verde, ambra o rosso) per i carburanti scelti, e l'impianto è aperto. */
function hasInfo(st: Station): boolean {
  const best = bestFuel(st);
  return !isClosed(st.id) && !!best && best.status.result.state !== State.GREY;
}

function sortedResults() {
  const town = searchedTown();
  const area = town
    ? townArea(ui.stations, town, TOWN_RADIUS_KM, TOWN_MIN_RESULTS)
    : ui.stations.filter((s) => matches(s.text, ui.query));
  // Dintorni tutti grigi e richiesta di allargare: solo i più vicini di cui si sa qualcosa, ovunque siano.
  const results = town && ui.expand ? closest(ui.stations, town, EXPAND_RESULTS, hasInfo) : area;
  const ref = town ?? referencePoint(results);
  const list = results
    .map((st) => ({ st, best: bestFuel(st), dist: ref ? distanceKm(ref, st) : null }))
    .filter(
      (x): x is { st: Station; best: NonNullable<typeof x.best>; dist: number | null } => !!x.best,
    )
    .sort(
      (a, b) =>
        Number(isClosed(a.st.id)) - Number(isClosed(b.st.id)) ||
        STATE_UI[a.best.status.result.state].rank - STATE_UI[b.best.status.result.state].rank ||
        (a.dist ?? 0) - (b.dist ?? 0) ||
        b.best.status.reliability - a.best.status.reliability ||
        a.st.name.localeCompare(b.st.name),
    );
  return { town, list };
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

/**
 * Le pillole dei carburanti nella lista: forma, colore ed età a colpo d'occhio. La frase intera
 * ("Disponibile secondo gli utenti · 3 conferme…") resta per i lettori di schermo e nella scheda.
 */
function fuelPills(st: Station): HTMLElement {
  const fuels = ui.fuel === "all" ? st.fuels : st.fuels.filter((f) => f === ui.fuel);
  return h(
    "div",
    { class: "pills" },
    ...fuels.map((f) => {
      const s = statusOf(st.id, f);
      const r = s.result;
      const look = STATE_UI[r.state];
      const label = describeState(r, now(), s.lastGreenMs);
      const age = shortAge(r.absences > 0 ? r.lastAbsenceMs : r.lastConfirmMs, now());
      return h(
        "span",
        { class: `pill ${look.cls}` },
        h(
          "span",
          { "aria-hidden": "true" },
          `${look.shape} ${FUEL_NAMES[f]}${age ? ` · ${age}` : ""}`,
        ),
        h("span", { class: "sr-only" }, `${FUEL_NAMES[f]}: ${label.title}, ${label.detail}.`),
      );
    }),
  );
}

function card(st: Station, best: { fuel: Fuel; status: FuelStatus }, dist: number | null) {
  const closed = isClosed(st.id);
  const edge = closed ? "red" : STATE_UI[best.status.result.state].cls.slice(2);
  const more = closed ? "" : extras(best.status);
  return h(
    "li",
    {},
    h(
      "a",
      {
        class: `card edge-${edge}`,
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
      closed
        ? h("div", { class: "pills" }, h("span", { class: "pill s-red" }, "✕ Chiuso secondo QUI"))
        : fuelPills(st),
      more ? h("div", { class: "extras" }, more) : null,
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

function getPosition(highAccuracy: boolean, maxAgeMs = highAccuracy ? 0 : 60_000): Promise<Point> {
  const ask = new Promise<Point>((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(new Error("geolocalizzazione non disponibile"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
      reject,
      { enableHighAccuracy: highAccuracy, timeout: 12_000, maximumAge: maxAgeMs },
    );
  });
  return withTimeout(ask, POSITION_WAIT_MS);
}

// ------------------------------------------------------------------ vista lista

const results = h("ol", { class: "results" });
const summary = h("p", { class: "muted summary", "aria-live": "polite" });
/** Quando nessuno ha confermato carburante (tipicamente di notte o al mattino presto). */
const invite = h(
  "p",
  { class: "note-box", hidden: true },
  "Poche segnalazioni adesso. Sei a un distributore? Aprilo e tocca «C'è» o «Non c'è».",
);
/** Una riga sola per leggere le pillole: le forme non dipendono dal colore (daltonismo). */
const legend = h(
  "p",
  { class: "legend small muted" },
  "Segnalazioni: ",
  h("span", { class: "s-green" }, "●"),
  " c'è · ",
  h("span", { class: "s-amber" }, "▲"),
  " da verificare · ",
  h("span", { class: "s-red" }, "✕"),
  " esaurito · ",
  h("span", { class: "s-grey" }, "○"),
  " nessuna",
);
/** Il comune cercato e i dintorni non hanno informazioni: allarga ai più vicini che ne hanno. */
const expandButton = h(
  "button",
  {
    type: "button",
    class: "btn primary",
    hidden: true,
    onClick: () => {
      ui.expand = true;
      updateResults();
    },
  },
  "🔎 Mostra i più vicini con segnalazioni",
);
/** Comuni e vie dei distributori, suggeriti dal telefono mentre si scrive (nessuna richiesta di rete). */
const suggestions = h("datalist", { id: "q-suggest" });
let suggested = false;

function fillSuggestions(): void {
  if (suggested || !ui.towns || ui.stations.length === 0) return;
  suggested = true;
  suggestions.replaceChildren(
    ...searchSuggestions(ui.towns, ui.stations).map((value) => h("option", { value })),
  );
}

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
  "📍 Vicino a me",
);
/** Cosa fare quando la posizione non arriva (es. dentro Instagram): visibile, non solo letto. */
const posHelp = h("p", { class: "note-box", hidden: true });
/** Indicatore del "tira giù per aggiornare" (src/client/pull.ts). */
const pullIndicator = h("div", { class: "ptr", "aria-hidden": "true" });
/** Lo stesso aggiornamento con un tocco: per chi non usa il gesto (tastiera, lettori di schermo). */
const refreshButton = h(
  "button",
  {
    type: "button",
    class: "icon-btn",
    "aria-label": "Aggiorna la lista",
    title: "Aggiorna la lista",
    onClick: () => void refreshFromButton(),
  },
  "↻",
);

const listView = h(
  "div",
  { class: "list" },
  // Una sola <h1> per vista (docs/08-seo.md, fase 1 punto 4): qui la leggono i lettori di schermo.
  h("h1", { class: "sr-only" }, "Distributori con carburante in provincia di Avellino"),
  pullIndicator,
  h(
    "div",
    { class: "controls" },
    h("label", { for: "q", class: "sr-only" }, "Cerca comune, via o marchio"),
    h(
      "div",
      { class: "search-row" },
      h("input", {
        id: "q",
        type: "search",
        placeholder: "Cerca comune, via o marchio",
        autocomplete: "off",
        enterkeyhint: "search",
        list: "q-suggest",
        onFocus: () => {
          void loadTownsOnce();
          fillSuggestions();
        },
        onInput: (e) => {
          ui.query = (e.target as HTMLInputElement).value;
          ui.limit = PAGE;
          ui.expand = false;
          updateResults();
        },
      }),
      posButton,
    ),
    suggestions,
    posHelp,
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
  h("div", { class: "summary-row" }, summary, refreshButton),
  expandButton,
  legend,
  invite,
  results,
  more,
);

/** Il pulsante ↻ mostra l'esito: verde se la lista è stata riletta, rosso se no. */
async function refreshFromButton(): Promise<void> {
  refreshButton.classList.remove("done", "fail");
  const ok = await refreshList();
  refreshButton.classList.add(ok ? "done" : "fail");
  refreshButton.textContent = ok ? "✓" : "↻";
  window.setTimeout(() => {
    refreshButton.classList.remove("done", "fail");
    refreshButton.textContent = "↻";
  }, PULL_RESULT_MS);
}

/** Stato dei distributori e, se attiva, posizione appena letta: per chi si sposta con la lista aperta. */
async function refreshList(): Promise<boolean> {
  refreshButton.disabled = true;
  const moved = ui.origin
    ? getPosition(false, 5_000).then(
        (p) => {
          ui.origin = p;
        },
        () => {
          // Posizione non riletta: resta l'ultima, la lista si aggiorna comunque.
        },
      )
    : Promise.resolve();
  const [ok] = await Promise.all([refresh(), moved]);
  updateResults();
  refreshButton.disabled = false;
  announce(ok ? "Lista aggiornata" : "Aggiornamento non riuscito");
  return ok;
}

async function usePosition(): Promise<void> {
  posButton.textContent = "📍 Cerco…";
  posHelp.hidden = true;
  const slow = setTimeout(() => {
    posHelp.textContent = POSITION_HELP.slow;
    posHelp.hidden = false;
  }, POSITION_SLOW_MS);
  try {
    ui.origin = await getPosition(false);
    posHelp.hidden = true;
    posButton.textContent = "📍 Vicino a te ✓";
    announce("Distributori ordinati per distanza");
  } catch (err) {
    posHelp.textContent = positionHelp(err);
    posHelp.hidden = false;
    posButton.textContent = "📍 Vicino a me";
    announce(posHelp.textContent);
  } finally {
    clearTimeout(slow);
  }
  updateResults();
}

function updateResults(): void {
  const { town, list: all } = sortedResults();
  const green = all.filter((x) => x.best.status.result.state === State.GREEN).length;
  const lastHour = ui.snap?.lastHour;
  const greenText = green > 0 ? ` · ${green} con carburante` : "";
  const withInfo = all.filter((x) => x.best.status.result.state !== State.GREY).length;
  if (town && ui.expand) {
    summary.textContent =
      withInfo > 0
        ? `Nessuna informazione attorno a ${town.name} · ${
            withInfo === 1 ? "il più vicino" : `i ${withInfo} più vicini`
          } con segnalazioni` + greenText
        : "Nessuna segnalazione in provincia per i carburanti scelti.";
  } else if (town) {
    const own = all.filter((x) => normalize(x.st.town) === town.key).length;
    const around = all.length - own;
    const far = all.some((x) => (x.dist ?? 0) > TOWN_RADIUS_KM);
    const where = far ? "più vicini" : `entro ${TOWN_RADIUS_KM} km`;
    const fuelText = ui.fuel === "all" ? "" : ` con ${FUEL_NAMES[ui.fuel]}`;
    summary.textContent =
      (own > 0
        ? `${own} a ${town.name}` + (around > 0 ? ` · ${around} ${where}` : "")
        : `Nessun distributore${fuelText} a ${town.name} · ${all.length} ${where}`) + greenText;
  } else if (all.length === 0 && normalize(ui.query)) {
    summary.textContent = ui.townsLoading
      ? "Cerco i distributori più vicini…"
      : "Nessun risultato in provincia di Avellino. Prova con il nome del comune.";
  } else {
    summary.textContent =
      `${all.length} distributori` +
      greenText +
      (lastHour === undefined
        ? ""
        : ` · ${lastHour === 1 ? "1 segnalazione" : `${lastHour} segnalazioni`} nell'ultima ora`);
  }
  invite.hidden = !ui.snap || green > 0 || all.length === 0;
  legend.hidden = all.length === 0;
  expandButton.hidden =
    !town || ui.expand || all.length === 0 || withInfo > 0 || !ui.stations.some(hasInfo);
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

/** Indicazione di QUI: la nota con la fonte, ben distinta dalle segnalazioni degli utenti. */
function officialNote(id: number, fuel: Fuel): HTMLElement | null {
  const note = ui.snap?.official.get(rowKey(id, fuel));
  return note ? h("p", { class: "note-box" }, `ℹ Indicazione di QUI: ${note}`) : null;
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
  const closedNote = ui.snap?.closed.get(st.id);
  const operator = statuses.some((s) => describeState(s.status.result, now()).operatorLink);
  const readOnly = ui.snap?.readOnly ?? false;

  return h(
    "div",
    { class: "detail" },
    back,
    h("h1", {}, `${st.brand} — ${st.name}`),
    h("p", {}, `${st.address}, ${st.town}`),
    ui.origin
      ? h("p", { class: "muted" }, `A ${formatDistance(distanceKm(ui.origin, st))} da te`)
      : null,
    // Per chi guida l'azione principale è arrivarci: in alto, prima degli stati.
    navLinks(st),
    note ? h("p", { class: "note-box" }, `ℹ ${note}`) : null,
    closedNote ? h("p", { class: "note-box" }, `⚠ Chiuso secondo QUI: ${closedNote}`) : null,
    ...statuses.map(({ fuel, status }) =>
      h(
        "section",
        { class: "fuel" },
        statusLine(fuel, status),
        officialNote(st.id, fuel),
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
  let sent = false;
  // Chiuso il pannello dopo l'invio, la lista si rilegge subito: chi segnala vede l'effetto.
  const sheet = openSheet(`${has ? "C'è" : "Non c'è"} ${FUEL_NAMES[fuel]}`, () => {
    if (sent) void refresh();
  });
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
    sent = true;
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
        h("p", {}, REPORT_REMOTE_HELP),
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
    h("h1", {}, "I tuoi dati su questo telefono"),
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
    document.documentElement.classList.remove("ptr-on");
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
  // Nella lista il "tira giù" aggiorna senza ricaricare: il ricaricamento del browser va spento.
  document.documentElement.classList.toggle("ptr-on", listView.parentElement === app);
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
      : ui.snap?.notice
        ? `ℹ Avviso di QUI: ${ui.snap.notice}`
        : "";
  banner.textContent = text;
  banner.hidden = !text;
}

/** true se lo stato è stato riletto dal server. */
async function refresh(): Promise<boolean> {
  try {
    ui.snap = await loadSnapshot(PROV);
    ui.snapAt = Date.now();
    ui.snapError = false;
  } catch {
    ui.snapError = true;
  }
  // Non ridisegnare il dettaglio mentre l'utente sta segnalando.
  if (!document.querySelector(".overlay")) render();
  return !ui.snapError;
}

async function init(): Promise<void> {
  // /?q=Grottaminarda: le pagine dei comuni aprono la lista già cercata, con i dintorni.
  const q = new URLSearchParams(location.search).get("q")?.trim().slice(0, 80) ?? "";
  if (q) {
    ui.query = q;
    (listView.querySelector("#q") as HTMLInputElement).value = q;
  }
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
  void loadTownsOnce();
  onPullDown({
    indicator: pullIndicator,
    enabled: () => listView.parentElement === app && !document.querySelector(".overlay"),
    refresh: refreshList,
  });
  window.addEventListener("popstate", render);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void refresh();
  });
  window.setInterval(() => {
    if (document.visibilityState === "visible") void refresh();
  }, REFRESH_MS);
}

// Aperta in http:// (es. link senza "https://" da Instagram): posizione e PoW non funzionerebbero.
const secure = secureUrl(location);
if (secure) location.replace(secure);
else void init();
