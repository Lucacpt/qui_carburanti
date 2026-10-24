// Area admin (ADR-0013): avvisi, contestazioni, ultime segnalazioni e annullamento, indicazioni di
// QUI, congelamenti, sola lettura, storico, registro.
// La pagina è dietro Cloudflare Access; le API verificano di nuovo il login a ogni richiesta.
// Delle segnalazioni si vede solo cosa, dove e quando, più un codice di rete di 4 caratteri che
// cambia ogni giorno: chi ha segnalato non è nel database.

import { FUEL_NAMES, loadStations, type Station } from "../client/data.ts";
import { matches } from "../client/search.ts";
import { announce, h, openSheet } from "../client/view.ts";
import { type Fuel, State } from "../domain/types.ts";

const PROV = "AV";
const REFRESH_MS = 60_000;
const MAX_STATE_HOURS = 8;
const app = document.getElementById("app") as HTMLElement;

interface Override {
  station: number;
  fuel: string;
  state: number;
  note: string;
  ts: number;
  until: number;
}

interface Overview {
  readOnly: boolean;
  lastHour: number;
  alerts: Array<{
    id: number;
    ts: number;
    kind: string;
    station: number | null;
    fuel: string | null;
    detail: string | null;
  }>;
  contests: Array<{
    id: number;
    ts: number;
    station: number;
    fuel: string | null;
    reason: string;
    contact: string | null;
    status: string;
  }>;
  frozen: Array<{ station: number; until: number; note: string }>;
  overrides: Override[];
  stats: Array<{ hour: number; fuel: string; pos: number; neg: number; dropped: number }>;
  log: Array<{ ts: number; action: string; station: number | null; detail: string | null }>;
}

interface Report {
  id: number;
  ts: number;
  station: number;
  fuel: string;
  has: number;
  near: number;
  queue: number | null;
  lim: number | null;
  net: string;
}

interface History {
  transitions: Array<{
    ts: number;
    fuel: string;
    from_state: number | null;
    to_state: number;
    confirmations: number;
    absences: number;
    cause: string;
  }>;
  contests: Overview["contests"];
  frozen: { until: number; note: string } | null;
  overrides: Override[];
}

const KIND: Record<string, string> = {
  red_pending: "Rosso in verifica",
  contest: "Contestazione",
  override_superseded: "Indicazione di QUI superata dagli utenti",
};
const REASON: Record<string, string> = {
  has_fuel: "dice che c'è carburante",
  no_fuel: "dice che non c'è carburante",
  closed: "impianto chiuso",
  wrong_data: "dati dell'impianto sbagliati",
  other: "altro",
};
const STATUS: Array<[string, string]> = [
  ["new", "Nuova"],
  ["in_progress", "In corso"],
  ["closed", "Chiusa"],
];
const STATE_NAME: Record<number, string> = {
  [State.GREY]: "grigio",
  [State.RED]: "rosso",
  [State.AMBER]: "ambra",
  [State.GREEN]: "verde",
};
const CAUSE: Record<string, string> = {
  report: "segnalazione",
  hold: "fine verifica",
  ttl: "rosso scaduto",
  window: "8 ore senza segnalazioni",
  fresh: "conferme invecchiate",
  time: "tempo",
  freeze: "congelato",
  unfreeze: "sbloccato",
  annul: "segnalazioni annullate",
  official: "indicazione di QUI",
  clear: "indicazione tolta",
  users: "indicazione superata dagli utenti",
};
const ACTION: Record<string, string> = {
  ack: "Avvisi visti",
  contest: "Contestazione",
  freeze: "Congelamento",
  unfreeze: "Sblocco",
  read_only: "Sola lettura",
  annul: "Annullamento",
  set_state: "Indicazione di QUI",
  clear_state: "Indicazione tolta",
};

const fmt = new Intl.DateTimeFormat("it-IT", {
  timeZone: "Europe/Rome",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});
const hm = new Intl.DateTimeFormat("it-IT", {
  timeZone: "Europe/Rome",
  hour: "2-digit",
  minute: "2-digit",
});
const when = (ms: number) => fmt.format(ms);
const fuelName = (f: string | null) => (f ? (FUEL_NAMES[f as Fuel] ?? f) : "tutti i carburanti");

let stations = new Map<number, Station>();
const place = (id: number | null) => {
  if (id === null) return "—";
  const s = stations.get(id);
  return s ? `${s.brand} · ${s.address}, ${s.town} (${id})` : `impianto ${id}`;
};

/** Stato della pagina che sopravvive ai ridisegni: ricerca, filtro e selezione. */
const view = {
  query: "",
  /** Impianto scelto: le ultime segnalazioni mostrano solo le sue. */
  station: null as number | null,
  selected: new Set<number>(),
};

async function api<T>(path: string, body?: object): Promise<T> {
  const res = await fetch(
    path,
    body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ p: PROV, ...body }),
        }
      : { cache: "no-store" },
  );
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(data.error ?? `errore ${res.status}`);
  return data as T;
}

async function act(body: object, done: string): Promise<void> {
  try {
    await api("/api/admin/action", body);
    announce(done);
    await load();
  } catch (err) {
    alert(err instanceof Error ? err.message : "errore");
  }
}

// ------------------------------------------------------------------ sezioni

function section(title: string, ...children: Array<Node | null | false>): HTMLElement {
  return h("section", { class: "admin-section" }, h("h2", {}, title), ...children);
}

function button(text: string, onClick: () => void, cls = "btn"): HTMLButtonElement {
  return h("button", { type: "button", class: cls, onClick }, text);
}

/** Le azioni su un impianto, uguali ovunque compaia. */
function stationActions(station: number): HTMLElement {
  return h(
    "div",
    { class: "admin-actions" },
    button("Segnalazioni", () => {
      view.station = station;
      view.selected.clear();
      void load();
    }),
    button("Imposta stato", () => setStateForm(station)),
    button("Storico", () => void showHistory(station)),
    button("Congela", () => freezeForm(station)),
  );
}

function readOnlySection(o: Overview): HTMLElement {
  return section(
    "Sola lettura",
    h(
      "p",
      {},
      o.readOnly
        ? "ATTIVA: le segnalazioni sono sospese e tutti vedono un avviso."
        : "Disattivata: le segnalazioni funzionano normalmente.",
    ),
    button(
      o.readOnly ? "Riattiva le segnalazioni" : "Attiva la sola lettura",
      () => {
        const msg = o.readOnly
          ? "Riattivare le segnalazioni?"
          : "Sospendere tutte le segnalazioni della provincia? Usalo solo in caso di attacco o anomalie.";
        if (confirm(msg)) {
          void act(
            { kind: "readOnly", on: !o.readOnly },
            o.readOnly ? "Segnalazioni riattivate" : "Sola lettura attiva",
          );
        }
      },
      o.readOnly ? "btn" : "btn no",
    ),
  );
}

function alertsSection(o: Overview): HTMLElement {
  if (o.alerts.length === 0)
    return section("Avvisi", h("p", { class: "muted" }, "Nessun avviso da vedere."));
  return section(
    `Avvisi da vedere (${o.alerts.length})`,
    button(
      "Segna tutti come visti",
      () => void act({ kind: "ack", ids: o.alerts.map((a) => a.id) }, "Avvisi segnati come visti"),
    ),
    h(
      "ul",
      { class: "admin-list" },
      ...o.alerts.map((a) =>
        h(
          "li",
          { class: "card" },
          h("strong", {}, `${KIND[a.kind] ?? a.kind} · ${when(a.ts)}`),
          h("p", {}, `${place(a.station)} · ${fuelName(a.fuel)}`),
          a.detail ? h("p", { class: "muted small" }, REASON[a.detail] ?? a.detail) : null,
          h(
            "div",
            { class: "admin-actions" },
            button("Visto", () => void act({ kind: "ack", ids: [a.id] }, "Avviso visto")),
          ),
          a.station !== null && stationActions(a.station),
        ),
      ),
    ),
  );
}

function contestsSection(o: Overview): HTMLElement {
  if (o.contests.length === 0)
    return section("Contestazioni", h("p", { class: "muted" }, "Nessuna contestazione."));
  return section(
    "Contestazioni",
    h(
      "p",
      { class: "muted small" },
      "Il contatto si cancella da solo dopo 30 giorni, la contestazione dopo 180.",
    ),
    h(
      "ul",
      { class: "admin-list" },
      ...o.contests.map((c) => {
        const status = h(
          "select",
          {
            "aria-label": "Stato della contestazione",
            onChange: (e) =>
              void act(
                { kind: "contest", id: c.id, status: (e.target as HTMLSelectElement).value },
                "Stato aggiornato",
              ),
          },
          ...STATUS.map(([value, text]) =>
            h("option", { value, selected: value === c.status }, text),
          ),
        );
        return h(
          "li",
          { class: "card" },
          h("strong", {}, `${when(c.ts)} · ${place(c.station)}`),
          h("p", {}, `${fuelName(c.fuel)}: ${REASON[c.reason] ?? c.reason}`),
          c.contact
            ? h("p", {}, `Contatto: ${c.contact}`)
            : h("p", { class: "muted small" }, "Nessun contatto lasciato"),
          h("div", { class: "admin-actions" }, status),
          stationActions(c.station),
        );
      }),
    ),
  );
}

/** Cerca un impianto per nome, marchio, via o comune: niente più codici da ricordare. */
function searchSection(): HTMLElement {
  const results = h("ul", { class: "admin-list" });
  const show = () => {
    const q = view.query.trim();
    const found = q ? [...stations.values()].filter((s) => matches(s.text, q)).slice(0, 8) : [];
    results.replaceChildren(
      ...found.map((s) =>
        h(
          "li",
          { class: "card" },
          h("strong", {}, `${s.brand} ${s.name}`),
          h("p", { class: "muted small" }, `${s.address}, ${s.town} (${s.id})`),
          stationActions(s.id),
        ),
      ),
    );
    if (q && found.length === 0) results.replaceChildren(h("li", { class: "muted" }, "Nessuno."));
  };
  const input = h("input", {
    type: "search",
    placeholder: "Nome, marchio, via o comune",
    "aria-label": "Cerca un distributore",
    value: view.query,
    onInput: (e) => {
      view.query = (e.target as HTMLInputElement).value;
      show();
    },
  });
  show();
  return section("Cerca un distributore", input, results);
}

function reportsSection(reports: Report[]): HTMLElement {
  const list = view.station === null ? reports : reports.filter((r) => r.station === view.station);
  // Quante segnalazioni per rete in 8 ore: una serie dalla stessa rete salta all'occhio.
  const perNet = new Map<string, number>();
  for (const r of reports) perNet.set(r.net, (perNet.get(r.net) ?? 0) + 1);
  for (const id of view.selected) if (!reports.some((r) => r.id === id)) view.selected.delete(id);

  const count = h("span", { class: "muted small" });
  const annulButton = button("Annulla le selezionate", () =>
    annulForm([...view.selected], `${view.selected.size} segnalazioni selezionate`),
  );
  const refreshCount = () => {
    count.textContent = `${view.selected.size} selezionate`;
    annulButton.disabled = view.selected.size === 0;
  };
  const boxes = new Map<number, HTMLInputElement>();
  const toggle = (ids: number[], on: boolean) => {
    for (const id of ids) {
      if (on) view.selected.add(id);
      else view.selected.delete(id);
      const box = boxes.get(id);
      if (box) box.checked = on;
    }
    refreshCount();
  };

  const rows = list.map((r) => {
    const box = h("input", {
      type: "checkbox",
      checked: view.selected.has(r.id),
      "aria-label": "Seleziona",
      onChange: (e) => toggle([r.id], (e.target as HTMLInputElement).checked),
    });
    boxes.set(r.id, box);
    const sameNet = list.filter((x) => x.net === r.net).map((x) => x.id);
    return h(
      "li",
      { class: "card" },
      h(
        "label",
        { class: "admin-actions" },
        box,
        h(
          "strong",
          {},
          `${hm.format(r.ts)} · ${FUEL_NAMES[r.fuel as Fuel] ?? r.fuel}: ${r.has ? "✓ C'è" : "✕ Non c'è"}`,
        ),
      ),
      h("p", {}, place(r.station)),
      h(
        "p",
        { class: "muted small" },
        `${r.near ? "sul posto" : "da remoto"} · rete ${r.net} (${perNet.get(r.net)} in 8 ore)`,
      ),
      sameNet.length > 1 &&
        button(`Seleziona le ${sameNet.length} di questa rete`, () => toggle(sameNet, true)),
    );
  });
  refreshCount();

  return section(
    view.station === null
      ? `Ultime segnalazioni (${reports.length} in 8 ore)`
      : `Segnalazioni: ${place(view.station)}`,
    h(
      "p",
      { class: "muted small" },
      "Annulla solo segnalazioni palesemente false o in serie: lo stato si ricalcola subito e l'annullamento resta nel registro con la motivazione.",
    ),
    view.station !== null &&
      button("Mostra tutte", () => {
        view.station = null;
        view.selected.clear();
        void load();
      }),
    list.length === 0
      ? h("p", { class: "muted" }, "Nessuna segnalazione nelle ultime 8 ore.")
      : h(
          "div",
          {},
          h(
            "div",
            { class: "admin-actions" },
            button("Seleziona tutte", () =>
              toggle(
                list.map((r) => r.id),
                true,
              ),
            ),
            button("Deseleziona", () =>
              toggle(
                list.map((r) => r.id),
                false,
              ),
            ),
            annulButton,
            count,
          ),
          h("ul", { class: "admin-list" }, ...rows),
        ),
  );
}

function overridesSection(o: Overview): HTMLElement {
  return section(
    "Indicazioni di QUI",
    o.overrides.length === 0
      ? h("p", { class: "muted" }, "Nessuna.")
      : h(
          "ul",
          { class: "admin-list" },
          ...o.overrides.map((ov) =>
            h(
              "li",
              { class: "card" },
              h("strong", {}, place(ov.station)),
              h(
                "p",
                {},
                `${fuelName(ov.fuel)}: ${STATE_NAME[ov.state]} · «${ov.note}» · fino alle ${when(ov.until)}`,
              ),
              button(
                "Togli",
                () => void act({ kind: "clearState", station: ov.station }, "Indicazione tolta"),
              ),
            ),
          ),
        ),
  );
}

function frozenSection(o: Overview): HTMLElement {
  return section(
    "Distributori congelati",
    o.frozen.length === 0
      ? h("p", { class: "muted" }, "Nessuno.")
      : h(
          "ul",
          { class: "admin-list" },
          ...o.frozen.map((f) =>
            h(
              "li",
              { class: "card" },
              h("strong", {}, place(f.station)),
              h("p", {}, `«${f.note}» · fino alle ${when(f.until)}`),
              button(
                "Sblocca",
                () => void act({ kind: "unfreeze", station: f.station }, "Distributore sbloccato"),
              ),
            ),
          ),
        ),
  );
}

function statsSection(o: Overview): HTMLElement {
  const sum = (k: "pos" | "neg" | "dropped") => o.stats.reduce((n, s) => n + s[k], 0);
  return section(
    "Ultime 24 ore",
    h(
      "p",
      {},
      `${o.lastHour} segnalazioni nell'ultima ora · ${sum("pos")} "c'è" e ${sum("neg")} "non c'è" in 24 ore · ${sum("dropped")} scartate dall'anti-abuso`,
    ),
    h(
      "p",
      { class: "muted small" },
      "Molte scartate in poco tempo indicano un tentativo di abuso: valuta la sola lettura.",
    ),
  );
}

function logSection(o: Overview): HTMLElement {
  return section(
    "Registro delle azioni",
    o.log.length === 0
      ? h("p", { class: "muted" }, "Nessuna azione.")
      : h(
          "ul",
          { class: "admin-list compact" },
          ...o.log.map((l) =>
            h(
              "li",
              {},
              `${when(l.ts)} · ${ACTION[l.action] ?? l.action}${l.station ? ` · ${place(l.station)}` : ""}${l.detail ? ` · ${l.detail}` : ""}`,
            ),
          ),
        ),
  );
}

// ------------------------------------------------------------------ pannelli

function annulForm(ids: number[], what: string): void {
  if (ids.length === 0) return;
  const sheet = openSheet("Annulla segnalazioni");
  const reason = h("textarea", {
    rows: "2",
    maxlength: "200",
    "aria-label": "Motivazione, resta nel registro",
  });
  reason.value = "Segnalazioni false in serie";
  sheet.body.replaceChildren(
    h("p", {}, `${what}: verranno cancellate e lo stato si ricalcola subito.`),
    h("p", { class: "muted small" }, "La motivazione resta nel registro delle azioni."),
    reason,
    button(
      "Annulla le segnalazioni",
      () => {
        sheet.close();
        view.selected.clear();
        void act(
          { kind: "annul", ids, reason: reason.value },
          ids.length === 1 ? "Segnalazione annullata" : `${ids.length} segnalazioni annullate`,
        );
      },
      "btn no",
    ),
  );
}

function setStateForm(station: number): void {
  const st = stations.get(station);
  const sheet = openSheet("Indicazione di QUI");
  const fuel = h(
    "select",
    { "aria-label": "Carburante" },
    h("option", { value: "" }, "Tutti i carburanti venduti"),
    ...(st?.fuels ?? []).map((f) => h("option", { value: f }, FUEL_NAMES[f])),
  );
  const state = h(
    "select",
    { "aria-label": "Stato" },
    h("option", { value: "green" }, "C'è (verde)"),
    h("option", { value: "red" }, "Esaurito (rosso)"),
  );
  const note = h("textarea", {
    rows: "3",
    maxlength: "200",
    "aria-label": "Nota con la fonte, mostrata a tutti",
  });
  note.value = "Il gestore ha comunicato per telefono alle ";
  const hours = h(
    "select",
    { "aria-label": "Durata" },
    ...Array.from({ length: MAX_STATE_HOURS }, (_, i) => i + 1).map((n) =>
      h("option", { value: String(n), selected: n === 2 }, `${n} ${n === 1 ? "ora" : "ore"}`),
    ),
  );
  sheet.body.replaceChildren(
    h("p", {}, place(station)),
    h(
      "p",
      { class: "muted small" },
      "Si vede a tutti come «Indicazione di QUI» con questa nota: scrivi da dove viene l'informazione. Vale fino alla scadenza, ma decade appena le segnalazioni degli utenti danno uno stato chiaro.",
    ),
    fuel,
    state,
    note,
    hours,
    button(
      "Pubblica l'indicazione",
      () => {
        sheet.close();
        void act(
          {
            kind: "setState",
            station,
            fuel: fuel.value || null,
            state: state.value,
            note: note.value,
            hours: Number(hours.value),
          },
          "Indicazione pubblicata",
        );
      },
      "btn primary",
    ),
  );
}

function freezeForm(station: number): void {
  const sheet = openSheet("Congela il distributore");
  const note = h("textarea", {
    rows: "3",
    maxlength: "200",
    "aria-label": "Nota mostrata a tutti",
  });
  note.value = "Il gestore segnala: ";
  const hours = h(
    "select",
    { "aria-label": "Durata" },
    ...[1, 2, 3].map((n) =>
      h("option", { value: String(n), selected: n === 3 }, `${n} ${n === 1 ? "ora" : "ore"}`),
    ),
  );
  sheet.body.replaceChildren(
    h("p", {}, place(station)),
    h(
      "p",
      { class: "muted small" },
      "Il distributore verrà mostrato in ambra con questa nota, attribuita a chi l'ha inviata. Mai come «Disponibile».",
    ),
    note,
    hours,
    button(
      "Congela",
      () => {
        sheet.close();
        void act(
          { kind: "freeze", station, note: note.value, hours: Number(hours.value) },
          "Distributore congelato",
        );
      },
      "btn primary",
    ),
  );
}

async function showHistory(station: number): Promise<void> {
  if (!Number.isInteger(station) || station < 1) return;
  const sheet = openSheet("Storico");
  sheet.body.replaceChildren(h("p", {}, "Caricamento…"));
  try {
    const hst = await api<History>(`/api/admin/history?p=${PROV}&id=${station}`);
    sheet.body.replaceChildren(
      h("p", {}, h("strong", {}, place(station))),
      hst.frozen
        ? h(
            "p",
            { class: "note-box" },
            `Congelato fino alle ${when(hst.frozen.until)}: «${hst.frozen.note}»`,
          )
        : "",
      ...hst.overrides.map((ov) =>
        h(
          "p",
          { class: "note-box" },
          `Indicazione di QUI, ${fuelName(ov.fuel)} ${STATE_NAME[ov.state]} fino alle ${when(ov.until)}: «${ov.note}»`,
        ),
      ),
      hst.transitions.length === 0
        ? h("p", { class: "muted" }, "Nessun cambio di stato negli ultimi 30 giorni.")
        : h(
            "ul",
            { class: "admin-list compact" },
            ...hst.transitions.map((t) =>
              h(
                "li",
                {},
                `${when(t.ts)} · ${fuelName(t.fuel)}: ${t.from_state === null ? "—" : STATE_NAME[t.from_state]} → ${STATE_NAME[t.to_state]} (${CAUSE[t.cause] ?? t.cause}; ${t.confirmations} conferme, ${t.absences} assenze)`,
              ),
            ),
          ),
    );
  } catch (err) {
    sheet.body.replaceChildren(
      h("p", { class: "err" }, err instanceof Error ? err.message : "errore"),
    );
  }
}

// ------------------------------------------------------------------ caricamento

async function load(): Promise<void> {
  try {
    const [o, reports] = await Promise.all([
      api<Overview>(`/api/admin/overview?p=${PROV}`),
      api<Report[]>(`/api/admin/reports?p=${PROV}`),
    ]);
    document.title = `${o.alerts.length > 0 ? `(${o.alerts.length}) ` : ""}Amministrazione — QUI`;
    app.replaceChildren(
      h(
        "p",
        { class: "muted small" },
        `Provincia di Avellino · aggiornato alle ${when(Date.now())}`,
      ),
      alertsSection(o),
      contestsSection(o),
      searchSection(),
      reportsSection(reports),
      overridesSection(o),
      frozenSection(o),
      readOnlySection(o),
      statsSection(o),
      logSection(o),
    );
  } catch (err) {
    app.replaceChildren(
      h("p", { class: "err" }, err instanceof Error ? err.message : "errore"),
      h(
        "p",
        { class: "muted" },
        "Se il problema è l'accesso, controlla Cloudflare Access e i secret ACCESS_TEAM_DOMAIN, ACCESS_AUD e ADMIN_EMAILS.",
      ),
    );
  }
}

/** Il ridisegno automatico non deve rubare la ricerca o la selezione a chi sta lavorando. */
function busy(): boolean {
  const el = document.activeElement;
  return (
    !!document.querySelector(".overlay") ||
    view.selected.size > 0 ||
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement
  );
}

async function init(): Promise<void> {
  try {
    stations = new Map((await loadStations(PROV)).map((s) => [s.id, s]));
  } catch {
    // senza anagrafica si mostrano i codici degli impianti
  }
  await load();
  window.setInterval(() => {
    if (document.visibilityState === "visible" && !busy()) void load();
  }, REFRESH_MS);
}

void init();
