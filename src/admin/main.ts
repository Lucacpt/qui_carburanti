// Area admin (ADR-0013): avvisi, contestazioni, congelamenti, sola lettura, storico, registro.
// La pagina è dietro Cloudflare Access; le API verificano di nuovo il login a ogni richiesta.
// Nessun dato degli utenti: chi ha segnalato cosa non esiste nemmeno nel database.

import { FUEL_NAMES, loadStations, type Station } from "../client/data.ts";
import { announce, h, openSheet } from "../client/view.ts";
import { type Fuel, State } from "../domain/types.ts";

const PROV = "AV";
const REFRESH_MS = 60_000;
const app = document.getElementById("app") as HTMLElement;

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
  stats: Array<{ hour: number; fuel: string; pos: number; neg: number; dropped: number }>;
  log: Array<{ ts: number; action: string; station: number | null; detail: string | null }>;
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
}

const KIND: Record<string, string> = { red_pending: "Rosso in verifica", contest: "Contestazione" };
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
};
const ACTION: Record<string, string> = {
  ack: "Avvisi visti",
  contest: "Contestazione",
  freeze: "Congelamento",
  unfreeze: "Sblocco",
  read_only: "Sola lettura",
};

const fmt = new Intl.DateTimeFormat("it-IT", {
  timeZone: "Europe/Rome",
  day: "2-digit",
  month: "2-digit",
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
    h(
      "button",
      {
        type: "button",
        class: o.readOnly ? "btn" : "btn no",
        onClick: () => {
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
      },
      o.readOnly ? "Riattiva le segnalazioni" : "Attiva la sola lettura",
    ),
  );
}

function alertsSection(o: Overview): HTMLElement {
  if (o.alerts.length === 0)
    return section("Avvisi", h("p", { class: "muted" }, "Nessun avviso da vedere."));
  return section(
    `Avvisi da vedere (${o.alerts.length})`,
    h(
      "button",
      {
        type: "button",
        class: "btn",
        onClick: () =>
          void act({ kind: "ack", ids: o.alerts.map((a) => a.id) }, "Avvisi segnati come visti"),
      },
      "Segna tutti come visti",
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
            h(
              "button",
              {
                type: "button",
                class: "btn",
                onClick: () => void act({ kind: "ack", ids: [a.id] }, "Avviso visto"),
              },
              "Visto",
            ),
            a.station !== null &&
              h(
                "button",
                {
                  type: "button",
                  class: "btn",
                  onClick: () => void showHistory(a.station as number),
                },
                "Storico",
              ),
            a.station !== null &&
              h(
                "button",
                { type: "button", class: "btn", onClick: () => freezeForm(a.station as number) },
                "Congela",
              ),
          ),
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
          h(
            "div",
            { class: "admin-actions" },
            status,
            h(
              "button",
              { type: "button", class: "btn", onClick: () => void showHistory(c.station) },
              "Storico",
            ),
            h(
              "button",
              { type: "button", class: "btn", onClick: () => freezeForm(c.station) },
              "Congela",
            ),
          ),
        );
      }),
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
              h(
                "button",
                {
                  type: "button",
                  class: "btn",
                  onClick: () =>
                    void act({ kind: "unfreeze", station: f.station }, "Distributore sbloccato"),
                },
                "Sblocca",
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

function historySection(): HTMLElement {
  const input = h("input", {
    type: "text",
    inputmode: "numeric",
    placeholder: "Codice impianto (es. 3518)",
    "aria-label": "Codice impianto",
  });
  return section(
    "Storico di un distributore",
    h(
      "p",
      { class: "muted small" },
      "Registro anonimo dei cambi di stato degli ultimi 30 giorni: serve a verificare le contestazioni.",
    ),
    h(
      "div",
      { class: "admin-actions" },
      input,
      h(
        "button",
        { type: "button", class: "btn", onClick: () => void showHistory(Number(input.value)) },
        "Mostra",
      ),
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
    h(
      "button",
      {
        type: "button",
        class: "btn primary",
        onClick: () => {
          sheet.close();
          void act(
            { kind: "freeze", station, note: note.value, hours: Number(hours.value) },
            "Distributore congelato",
          );
        },
      },
      "Congela",
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
    const o = await api<Overview>(`/api/admin/overview?p=${PROV}`);
    document.title = `${o.alerts.length > 0 ? `(${o.alerts.length}) ` : ""}Amministrazione — QUI`;
    app.replaceChildren(
      h(
        "p",
        { class: "muted small" },
        `Provincia di Avellino · aggiornato alle ${when(Date.now())}`,
      ),
      alertsSection(o),
      contestsSection(o),
      frozenSection(o),
      readOnlySection(o),
      statsSection(o),
      historySection(),
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

async function init(): Promise<void> {
  try {
    stations = new Map((await loadStations(PROV)).map((s) => [s.id, s]));
  } catch {
    // senza anagrafica si mostrano i codici degli impianti
  }
  await load();
  window.setInterval(() => {
    if (document.visibilityState === "visible" && !document.querySelector(".overlay")) void load();
  }, REFRESH_MS);
}

void init();
