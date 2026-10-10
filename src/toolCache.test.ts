import { describe, expect, it, vi } from "vitest";
import { cacheKey, createToolCache } from "./toolCache.ts";

function setup(ttlMs = 1_000) {
  let clock = 0;
  const execute = vi.fn(async (name: string, input: Record<string, unknown>) => ({ name, input }));
  const cached = createToolCache({ execute, ttlMs, maxEntries: 2, now: () => clock });
  return { execute, cached, advance: (ms: number) => (clock += ms) };
}

describe("cacheKey", () => {
  it("treats a ticker and the full name as the same company", () => {
    expect(cacheKey("getFinancials", { company: "GLBX" })).toBe(cacheKey("getFinancials", { company: "globex inc" }));
  });

  it("ignores search term order and case", () => {
    expect(cacheKey("searchDocuments", { query: "Risk growth", company: "UMBR" })).toBe(
      cacheKey("searchDocuments", { query: "growth risk", company: "Umbrella Health" }),
    );
  });

  it("keeps quarterly and annual-only financials apart", () => {
    expect(cacheKey("getFinancials", { company: "ACME" })).not.toBe(
      cacheKey("getFinancials", { company: "ACME", includeQuarterly: true }),
    );
  });

  it("doesn't cache inputs it can't normalize, like an ambiguous company", () => {
    expect(cacheKey("getFinancials", { company: "Acme" })).toBeUndefined();
  });
});

describe("createToolCache", () => {
  it("serves an equivalent repeat call from the cache", async () => {
    const { execute, cached } = setup();
    expect((await cached("getFinancials", { company: "ITCH" })).cached).toBe(false);
    expect((await cached("getFinancials", { company: "Initech" })).cached).toBe(true);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("re-fetches after the TTL expires", async () => {
    const { execute, cached, advance } = setup(1_000);
    await cached("getFinancials", { company: "ITCH" });
    advance(1_001);
    expect((await cached("getFinancials", { company: "ITCH" })).cached).toBe(false);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("shares one execution between identical calls in flight", async () => {
    const { execute, cached } = setup();
    await Promise.all([cached("getFinancials", { company: "ITCH" }), cached("getFinancials", { company: "ITCH" })]);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("doesn't cache failures", async () => {
    const execute = vi.fn().mockRejectedValueOnce(new Error("upstream down")).mockResolvedValueOnce("ok");
    const cached = createToolCache({ execute });
    await expect(cached("getFinancials", { company: "ITCH" })).rejects.toThrow("upstream down");
    expect(await cached("getFinancials", { company: "ITCH" })).toEqual({ output: "ok", cached: false });
  });

  it("evicts the least recently used entry when full", async () => {
    const { execute, cached } = setup();
    await cached("getFinancials", { company: "ITCH" });
    await cached("getFinancials", { company: "GLBX" });
    await cached("getFinancials", { company: "ITCH" }); // ITCH is now most recent
    await cached("getFinancials", { company: "ACME" }); // evicts GLBX
    expect((await cached("getFinancials", { company: "ITCH" })).cached).toBe(true);
    expect((await cached("getFinancials", { company: "GLBX" })).cached).toBe(false);
    expect(execute).toHaveBeenCalledTimes(4);
  });
});
