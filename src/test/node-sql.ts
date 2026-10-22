// Adattatore di test: espone node:sqlite con la stessa forma minima di `ctx.storage.sql` dei Durable Objects.

import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { SqlLike, SqlValue } from "../worker/store/province-store.ts";

export function nodeSql(): SqlLike & { db: DatabaseSync } {
  const db = new DatabaseSync(":memory:");
  return {
    db,
    exec<T extends Record<string, SqlValue>>(query: string, ...bindings: SqlValue[]) {
      const stmt = db.prepare(query);
      const params = bindings as SQLInputValue[];
      const returnsRows = /^\s*(select|with|pragma)\b/i.test(query) || /\breturning\b/i.test(query);
      if (!returnsRows) {
        stmt.run(...params);
        return { toArray: () => [] as T[] };
      }
      const rows = stmt.all(...params) as T[];
      return { toArray: () => rows };
    },
  };
}
