/**
 * In-memory cache for tool results, shared across requests.
 *
 * Follow-up questions replay only answer text (not tool results), so they often
 * re-fetch the same financials or documents; this makes those repeat lookups instant.
 * Equivalent calls share an entry ("GLBX" and "Globex Inc", or the same search terms
 * in a different order). Only successes are cached, and identical calls that are in
 * flight at the same time share one execution.
 */

import { resolveCompany } from "./tools.ts";

type Execute = (name: string, input: Record<string, unknown>) => Promise<unknown>;

export interface ToolCacheOptions {
  execute: Execute;
  /** How long a result stays fresh. The data behind these tools changes rarely. */
  ttlMs?: number;
  maxEntries?: number;
  now?: () => number;
}

/**
 * A key that's the same for equivalent calls, or undefined if the input can't be
 * normalized (e.g. an ambiguous company), in which case the call isn't cached.
 */
export function cacheKey(name: string, input: Record<string, unknown>): string | undefined {
  try {
    const company = input.company ? resolveCompany(String(input.company)).name : undefined;
    switch (name) {
      case "searchCompanies":
        return JSON.stringify([name, String(input.query ?? "").trim().toLowerCase()]);
      case "getCompanyProfile":
        return JSON.stringify([name, company]);
      case "getFinancials":
        return JSON.stringify([name, company, input.includeQuarterly === true]);
      case "searchDocuments": {
        // Scoring ignores term order and case, so neither should the key.
        const terms = String(input.query ?? "").toLowerCase().split(/\s+/).filter(Boolean).sort();
        return JSON.stringify([name, terms, company ?? null]);
      }
      default:
        return undefined;
    }
  } catch {
    return undefined;
  }
}

export function createToolCache({
  execute,
  ttlMs = 10 * 60_000,
  maxEntries = 500,
  now = Date.now,
}: ToolCacheOptions) {
  const entries = new Map<string, { result: Promise<unknown>; expiresAt: number }>();

  return async function cachedExecute(
    name: string,
    input: Record<string, unknown>,
  ): Promise<{ output: unknown; cached: boolean }> {
    const key = cacheKey(name, input);
    if (key === undefined) return { output: await execute(name, input), cached: false };

    const hit = entries.get(key);
    if (hit && hit.expiresAt > now()) {
      // Refresh recency so the least recently used entry is evicted first.
      entries.delete(key);
      entries.set(key, hit);
      return { output: await hit.result, cached: true };
    }

    const result = execute(name, input);
    entries.set(key, { result, expiresAt: now() + ttlMs });
    if (entries.size > maxEntries) entries.delete(entries.keys().next().value!);
    try {
      return { output: await result, cached: false };
    } catch (err) {
      // Don't cache failures; the next call should retry.
      if (entries.get(key)?.result === result) entries.delete(key);
      throw err;
    }
  };
}
