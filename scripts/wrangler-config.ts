// Lettura di wrangler.jsonc per i test di politica (region-policy, deploy-policy).

import { readFileSync } from "node:fs";

export interface Route {
  readonly pattern: string;
  readonly custom_domain?: boolean;
}

export interface WranglerConfig {
  readonly vars?: Record<string, string>;
  readonly env?: Record<string, WranglerConfig>;
  readonly routes?: readonly Route[];
  readonly workers_dev?: boolean;
  readonly preview_urls?: boolean;
  readonly durable_objects?: { readonly bindings: ReadonlyArray<{ readonly name: string }> };
  readonly ratelimits?: ReadonlyArray<{ readonly name: string; readonly namespace_id: string }>;
  readonly observability?: { readonly enabled?: boolean };
  readonly logpush?: boolean;
  readonly tail_consumers?: readonly unknown[];
  readonly r2_buckets?: ReadonlyArray<{ readonly jurisdiction?: string }>;
  readonly [key: string]: unknown;
}

/** JSONC → JSON. Le stringhe si copiano intere: "/api/*" contiene "/*" ma non è un commento. */
export function stripJsonc(src: string): string {
  let out = "";
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== '"') j += src[j] === "\\" ? 2 : 1;
      out += src.slice(i, j + 1);
      i = j;
    } else if (c === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      out += "\n";
    } else if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end < 0 ? src.length : end + 1;
    } else {
      out += c;
    }
  }
  return out.replace(/,(\s*[}\]])/g, "$1");
}

export const config = JSON.parse(
  stripJsonc(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8")),
) as WranglerConfig;

/** La radice è la produzione; ogni env.* è un altro deploy. vars e binding NON si ereditano. */
export const targets: Array<[string, WranglerConfig]> = [
  ["produzione", config],
  ...Object.entries(config.env ?? {}),
];
