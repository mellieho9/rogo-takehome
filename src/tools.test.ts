import { describe, expect, it } from "vitest";
import {
  normalizeFollowups,
  partialStringField,
  recoverReply,
  splitLeakedFollowups,
  visibleAnswer,
} from "./agent.ts";
import { citedIds } from "./protocol.ts";
import { executeTool, resolveCompany, sourcesFrom, ToolError } from "./tools.ts";

describe("resolveCompany", () => {
  it("accepts full names (any case) and tickers", () => {
    expect(resolveCompany("globex inc").ticker).toBe("GLBX");
    expect(resolveCompany("ITCH").name).toBe("Initech");
    expect(resolveCompany("ACME").name).toBe("Acme Corp");
  });

  it("accepts a unique partial name", () => {
    expect(resolveCompany("Globex").name).toBe("Globex Inc");
  });

  it("rejects ambiguous names, listing the candidates", () => {
    expect(() => resolveCompany("Acme")).toThrow(/ambiguous.*Acme Corp.*Acme Robotics/);
  });

  it("rejects companies outside the universe, listing what is covered", () => {
    expect(() => resolveCompany("Hooli")).toThrow(ToolError);
    expect(() => resolveCompany("Hooli")).toThrow(/Umbrella Health/);
  });
});

describe("tool sources", () => {
  it("gives financials a citable source and drops pipeline internals", async () => {
    const output = (await executeTool("getFinancials", { company: "ITCH" })) as Record<string, unknown>;
    expect(output.sourceId).toBe("FIN-ITCH");
    expect(output).not.toHaveProperty("provenance");
    expect(output).not.toHaveProperty("quarterly");
    expect(output.warnings).toBeDefined();

    const [source] = sourcesFrom("getFinancials", output);
    expect(source).toMatchObject({ id: "FIN-ITCH", kind: "financials", company: "Initech" });
  });

  it("returns one source per matching document", async () => {
    const output = await executeTool("searchDocuments", { query: "risk", company: "ACME" });
    const sources = sourcesFrom("searchDocuments", output);
    expect(sources.map((s) => s.id)).toContain("DOC-ACME-002");
    expect(sources.every((s) => s.company === "Acme Corp")).toBe(true);
  });
});

it("returns quarterly financials only on request", async () => {
  const output = (await executeTool("getFinancials", { company: "ACME", includeQuarterly: true })) as {
    quarterly?: unknown[];
  };
  expect(output.quarterly?.length).toBeGreaterThan(0);
});

describe("citedIds", () => {
  it("finds single and grouped citations in order, without duplicates", () => {
    const text =
      "Revenue grew 5.5% [FIN-ACME]. Guidance is 4–6% [DOC-ACME-001, FIN-ACME]; risks [DOC-ACME-002].";
    expect(citedIds(text)).toEqual(["FIN-ACME", "DOC-ACME-001", "DOC-ACME-002"]);
  });

  it("ignores ordinary markdown links and brackets", () => {
    expect(citedIds("See [the filing](https://example.com) and [note 3].")).toEqual([]);
  });
});

describe("normalizeFollowups", () => {
  it("accepts arrays, JSON strings and tag-wrapped items", () => {
    expect(normalizeFollowups(["A?", "B?"])).toEqual(["A?", "B?"]);
    expect(normalizeFollowups('["A?", "B?"]')).toEqual(["A?", "B?"]);
    expect(normalizeFollowups(["<item>A?</item>", "<answer>B?</answer>"])).toEqual(["A?", "B?"]);
    expect(normalizeFollowups("<item>A?</item>\n<item>B?</item>")).toEqual(["A?", "B?"]);
    expect(
      normalizeFollowups(['<parameter name="followups">["A?", "B?"]</parameter>']),
    ).toEqual(["A?", "B?"]);
    expect(normalizeFollowups(undefined)).toEqual([]);
  });
});

describe("partialStringField", () => {
  it("decodes an unfinished string value, including escapes", () => {
    expect(partialStringField('{"kind":"answer","answer":"Revenue gr', "answer")).toBe("Revenue gr");
    expect(partialStringField('{"kind":"answer","answer":"a\\nb \\"q\\" \\u00e9', "answer")).toBe('a\nb "q" é');
  });

  it("stops before an incomplete escape and at the closing quote", () => {
    expect(partialStringField('{"answer":"line\\', "answer")).toBe("line");
    expect(partialStringField('{"answer":"x \\u00', "answer")).toBe("x ");
    expect(partialStringField('{"answer":"done","followups":["A?"]}', "answer")).toBe("done");
  });

  it("does not mistake the kind value for the key", () => {
    expect(partialStringField('{"kind":"answer",', "answer")).toBeUndefined();
  });
});

describe("recoverReply", () => {
  it("recovers the answer and XML-style follow-ups from invalid respond JSON", () => {
    // Shape observed from the model with eager input streaming on.
    const raw =
      '{"kind": "answer", "answer": "GLBX is bigger [FIN-GLBX].", "followups": \n<followups>\n' +
      "<item>When is the delayed 10-K expected?</item>\n<item>Which Globex segment has the best margins?</item>\n</followups>\n}";
    expect(recoverReply(raw)).toEqual({
      kind: "answer",
      answer: "GLBX is bigger [FIN-GLBX].",
      followups: ["When is the delayed 10-K expected?", "Which Globex segment has the best margins?"],
    });
  });
});

describe("splitLeakedFollowups", () => {
  it("cuts follow-up markup the model wrote into the answer and recovers the questions", () => {
    // Exact tail of an answer seen in the UI.
    const answer =
      'I did not find documents on payer competition or pricing pressure in the available materials.</answer> ' +
      '<parameter name="followups"> <parameter name="followups">["How has Umbrella Health\'s organic (same-clinic) growth trended over the past few years?", ' +
      '"How much debt or cash has Umbrella Health used to fund its acquisition strategy?"]';
    expect(splitLeakedFollowups(answer)).toEqual({
      answer: "I did not find documents on payer competition or pricing pressure in the available materials.",
      leaked: [
        "How has Umbrella Health's organic (same-clinic) growth trended over the past few years?",
        "How much debt or cash has Umbrella Health used to fund its acquisition strategy?",
      ],
    });
  });

  it("leaves a normal answer alone, including a '<' comparison", () => {
    expect(splitLeakedFollowups("Margins are <5% [FIN-ACME].")).toEqual({
      answer: "Margins are <5% [FIN-ACME].",
      leaked: [],
    });
  });
});

describe("visibleAnswer", () => {
  it("holds back an unfinished tag while streaming, but not a '<' comparison", () => {
    expect(visibleAnswer("Done.</ans")).toBe("Done.");
    expect(visibleAnswer('Done.<parameter name="fol')).toBe("Done.");
    expect(visibleAnswer("Done.</answer> <parameter")).toBe("Done.");
    expect(visibleAnswer("Margins are <5%")).toBe("Margins are <5%");
  });
});
