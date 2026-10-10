/**
 * The agent's tools. These stand in for the real research APIs — same shapes,
 * local data, plus a little latency so the app behaves like the real thing.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { companies, documents, financials, type Company } from "./data.ts";
import type { Source } from "./protocol.ts";

/** Thrown when a tool cannot service a request. */
export class ToolError extends Error {}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const toolSchemas: Anthropic.Tool[] = [
  {
    name: "searchCompanies",
    description:
      "Search the coverage universe for companies matching a name or ticker. Returns the company name, ticker and sector for each match. An empty query lists every covered company.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "A company name, part of one, or a ticker." },
      },
      required: ["query"],
    },
  },
  {
    name: "getCompanyProfile",
    description:
      "Get a company's profile: description, sector, headquarters, headcount, business segments and the filings we hold.",
    input_schema: {
      type: "object",
      properties: {
        company: { type: "string", description: "The company's full name or ticker." },
      },
      required: ["company"],
    },
  },
  {
    name: "getFinancials",
    description:
      "Get a company's annual financials: revenue, gross margin, operating income, net income and free cash flow. Quarterly figures are included only on request.",
    input_schema: {
      type: "object",
      properties: {
        company: { type: "string", description: "The company's full name or ticker." },
        includeQuarterly: {
          type: "boolean",
          description:
            "Also return quarterly revenue, gross margin and operating income. Only needed for quarter-level or seasonality questions.",
        },
      },
      required: ["company"],
    },
  },
  {
    name: "searchDocuments",
    description:
      "Keyword search over earnings call transcripts, filing excerpts and press releases. Returns up to 5 documents ranked by how many keywords they contain. Use a few distinctive keywords, not a sentence.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "1–6 space-separated keywords, e.g. \"risk competition customers\". More than 6 is rejected.",
        },
        company: {
          type: "string",
          description: "Optional. Restrict the search to one company (full name or ticker).",
        },
      },
      required: ["query"],
    },
  },
];

/**
 * Resolve a company by exact name (case-insensitive) or ticker (exact, so that
 * "Acme" isn't silently read as ACME), falling back to a unique partial name match. Ambiguous names fail with the candidates listed so the
 * model can pick or ask the analyst.
 */
export function resolveCompany(query: string): Company {
  const raw = String(query ?? "").trim();
  const needle = raw.toLowerCase();
  if (!needle) throw new ToolError("a company name or ticker is required");

  const exact = companies.find((c) => c.name.toLowerCase() === needle || c.ticker === raw);
  if (exact) return exact;

  const partial = companies.filter((c) => c.name.toLowerCase().includes(needle));
  if (partial.length === 1) return partial[0];
  if (partial.length > 1) {
    throw new ToolError(
      `"${query}" is ambiguous — it matches ${partial.map((c) => `${c.name} (${c.ticker})`).join(", ")}. Use the full name or ticker.`,
    );
  }
  throw new ToolError(
    `"${query}" is not in the coverage universe. Covered companies: ${companies.map((c) => `${c.name} (${c.ticker})`).join(", ")}.`,
  );
}

async function searchCompanies(query: string) {
  await sleep(250);
  const raw = String(query ?? "").trim();
  const matches = companies.filter(
    (c) => c.name.toLowerCase().includes(raw.toLowerCase()) || c.ticker === raw.toUpperCase(),
  );
  return matches.map((c) => ({
    name: c.name,
    ticker: c.ticker,
    sector: c.sector,
  }));
}

async function getCompanyProfile(company: string) {
  await sleep(450);
  const match = resolveCompany(company);
  return { sourceId: `PROFILE-${match.ticker}`, ...match };
}

async function getFinancials(company: string, includeQuarterly = false) {
  await sleep(800);
  const match = resolveCompany(company);
  const record = financials.find((f) => f.company === match.name);
  if (!record) {
    throw new ToolError(`no financials found for "${company}"`);
  }
  // Pipeline internals (checksums, ETL versions) are noise to the model; keep what
  // affects interpretation of the numbers.
  // Quarterly rows are ~2/3 of the payload and rarely needed, and every tool result
  // is resent on each later model call, so they're opt-in.
  const { provenance, quarterly, ...rest } = record;
  return {
    sourceId: `FIN-${record.ticker}`,
    ...rest,
    ...(includeQuarterly ? { quarterly } : {}),
    asOf: provenance.ingestedAt.slice(0, 10),
    restatements: provenance.restatements,
  };
}

async function searchDocuments(query: string, company?: string) {
  await sleep(700);

  const terms = String(query).trim().split(/\s+/).filter(Boolean);
  // The upstream document index rejects long queries.
  if (terms.length > 6) {
    throw new ToolError(
      `document search accepts at most 6 terms (received ${terms.length})`,
    );
  }

  const pool = company
    ? documents.filter((d) => d.company === resolveCompany(company).name)
    : documents;

  const scored = pool.map((doc) => {
    const haystack = `${doc.title} ${doc.body}`.toLowerCase();
    let score = 0;
    for (const term of terms) {
      if (haystack.includes(term.toLowerCase())) score += 1;
    }
    return { doc, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((s) => ({ sourceId: s.doc.id, ...s.doc }));
}

/** The citable sources contained in a tool's output. */
export function sourcesFrom(name: string, output: unknown): Source[] {
  switch (name) {
    case "getCompanyProfile": {
      const p = output as Awaited<ReturnType<typeof getCompanyProfile>>;
      return [
        {
          id: p.sourceId,
          kind: "profile",
          company: p.name,
          title: `${p.name} — company profile`,
          excerpt: p.description,
        },
      ];
    }
    case "getFinancials": {
      const f = output as Awaited<ReturnType<typeof getFinancials>>;
      return [
        {
          id: f.sourceId,
          kind: "financials",
          company: f.company,
          title: `${f.company} — annual & quarterly financials (${f.currency} ${f.unit})`,
          date: f.asOf,
          excerpt: f.warnings?.join(" "),
        },
      ];
    }
    case "searchDocuments": {
      const docs = output as Awaited<ReturnType<typeof searchDocuments>>;
      return docs.map((d) => ({
        id: d.sourceId,
        kind: "document",
        company: d.company,
        title: d.title,
        date: d.date,
        excerpt: d.body,
      }));
    }
    default:
      return [];
  }
}

export async function executeTool(
  name: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  switch (name) {
    case "searchCompanies":
      return searchCompanies(input.query as string);
    case "getCompanyProfile":
      return getCompanyProfile(input.company as string);
    case "getFinancials":
      return getFinancials(input.company as string, input.includeQuarterly === true);
    case "searchDocuments":
      return searchDocuments(input.query as string, input.company as string | undefined);
    default:
      throw new ToolError(`unknown tool "${name}"`);
  }
}
