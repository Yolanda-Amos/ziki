import { describe, expect, it, vi } from "vitest";
import {
  buildExtractionPrompt,
  flagTooThin,
  isTooThinToStructure,
  listDrafts,
  parseExtraction,
  run,
  structureDraft,
  type DraftIssue,
} from "./structure-drafts";

const BASE = "https://ziki.test";

type Call = { method: string; path: string; search: string; body: unknown };

/** Replies per "METHOD /path". The last reply for a route repeats, same convention as scripts/ziki-agent.test.ts. */
function fakeApi(routes: Record<string, unknown[]>) {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    calls.push({
      method,
      path: url.pathname,
      search: url.search,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    const key = `${method} ${url.pathname}`;
    const queue = routes[key];
    if (!queue?.length) throw new Error(`unexpected request: ${key}`);
    const reply = queue.length > 1 ? queue.shift() : queue[0];
    return new Response(JSON.stringify(reply), { status: 200 });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

function draft(overrides: Partial<DraftIssue> = {}): DraftIssue {
  return {
    id: "bug-1",
    number: 101,
    title: "Add dark mode toggle",
    description: "Can we add a dark mode toggle to the top right of the navigation?",
    status: "open",
    createdByAgentId: null,
    ...overrides,
  };
}

function baseDeps(fetchImpl: typeof fetch) {
  return {
    zikiBaseUrl: BASE,
    zikiAgentKey: "test-key",
    anthropicApiKey: "test-anthropic-key",
    anthropicModel: "claude-sonnet-4-5",
    fetchImpl,
  };
}

describe("isTooThinToStructure", () => {
  it("flags an unfilled template as too thin", () => {
    const template = "Steps to reproduce\n\n1.\n2.\n3.\n\nExpected\nActual\nEnvironment\nBrowser / app version:\nDevice and OS:";
    expect(isTooThinToStructure(template)).toBe(true);
  });

  it("flags a bare one-liner as too thin", () => {
    expect(isTooThinToStructure("I am too good")).toBe(true);
  });

  it("does not flag a real draft with actual content", () => {
    expect(isTooThinToStructure("Can we add a dark mode toggle to the top right of the navigation?")).toBe(false);
  });
});

describe("parseExtraction", () => {
  it("parses a well-formed model response", () => {
    const text = '{"summary": "Dark mode toggle", "problem": "No dark mode.", "proposedSolution": "Add a toggle.", "acceptanceCriteria": ["Toggle exists", "Persists across sessions"]}';
    expect(parseExtraction(text)).toEqual({
      summary: "Dark mode toggle",
      problem: "No dark mode.",
      proposedSolution: "Add a toggle.",
      acceptanceCriteria: ["Toggle exists", "Persists across sessions"],
    });
  });

  it("extracts JSON even when the model wraps it in prose or fences", () => {
    const text = 'Sure, here you go:\n```json\n{"summary": "S", "problem": "P", "proposedSolution": "Sol", "acceptanceCriteria": ["A"]}\n```';
    expect(parseExtraction(text).summary).toBe("S");
  });

  it("throws when the model output has no JSON", () => {
    expect(() => parseExtraction("I cannot help with that.")).toThrow(/Could not find JSON/);
  });

  it("throws when a required field is missing or the wrong type", () => {
    const text = '{"summary": "S", "problem": "P", "proposedSolution": "Sol"}';
    expect(() => parseExtraction(text)).toThrow(/missing required fields/);
  });
});

describe("buildExtractionPrompt", () => {
  it("includes the issue title and description verbatim", () => {
    const prompt = buildExtractionPrompt({ title: "My Title", description: "My description text." });
    expect(prompt).toContain("My Title");
    expect(prompt).toContain("My description text.");
  });
});

describe("listDrafts", () => {
  it("keeps only human-authored, unstructured, open drafts and follows cursors", async () => {
    const page1 = {
      items: [
        draft({ id: "a", number: 1, description: "Raw human idea with no headings yet." }),
        draft({ id: "b", number: 2, createdByAgentId: "agent-1" }), // agent-authored — excluded
        draft({
          id: "c",
          number: 3,
          description: "## Summary\nAlready structured.\n\n## Problem Statement\nX\n\n## Proposed Solution\nY\n\n## Acceptance Criteria\n- [ ] Z",
        }), // already structured — excluded
      ],
      nextCursor: "cursor-2",
    };
    const page2 = {
      items: [draft({ id: "d", number: 4, description: "Second page raw idea." })],
      nextCursor: null,
    };
    const { fetchImpl, calls } = fakeApi({ "GET /api/v1/issues": [page1, page2] });

    const result = await listDrafts(baseDeps(fetchImpl));

    expect(result.map((d) => d.id)).toEqual(["a", "d"]);
    expect(calls).toHaveLength(2);
    expect(calls[1].search).toContain("cursor=cursor-2");
  });
});

describe("structureDraft", () => {
  it("posts the extracted fields to /structure, then a transparency comment", async () => {
    const { fetchImpl, calls } = fakeApi({
      "POST /api/v1/ideas/bug-1/structure": [{ ok: true, issue: { id: "bug-1" } }],
      "POST /api/v1/issues/bug-1/comments": [{ comment: { id: "c1" } }],
    });

    await structureDraft(baseDeps(fetchImpl), draft(), {
      summary: "S",
      problem: "P",
      proposedSolution: "Sol",
      acceptanceCriteria: ["A", "B"],
    });

    expect(calls[0].path).toBe("/api/v1/ideas/bug-1/structure");
    expect(calls[0].body).toMatchObject({ summary: "S" });
    expect(calls[1].path).toBe("/api/v1/issues/bug-1/comments");
    expect(calls[1].body).toMatchObject({ type: "comment" });
  });
});

describe("flagTooThin", () => {
  it("posts a comment asking the reporter for more detail", async () => {
    const { fetchImpl, calls } = fakeApi({ "POST /api/v1/issues/bug-1/comments": [{ comment: { id: "c1" } }] });

    await flagTooThin(baseDeps(fetchImpl), draft());

    expect(calls).toHaveLength(1);
    expect(calls[0].body).toMatchObject({ type: "comment" });
    expect((calls[0].body as { body: string }).body).toMatch(/more detail|add what you'd expect/i);
  });
});

describe("run", () => {
  it("structures real drafts and flags thin ones, tolerating per-issue failures", async () => {
    const real = draft({ id: "real-1", number: 10, description: "A real, substantive draft idea with enough detail." });
    const thin = draft({ id: "thin-1", number: 11, description: "too short" });
    const broken = draft({ id: "broken-1", number: 12, description: "Another substantive draft that will fail to structure." });

    const { fetchImpl } = fakeApi({
      "GET /api/v1/issues": [{ items: [real, thin, broken], nextCursor: null }],
      "POST /api/v1/issues/thin-1/comments": [{ comment: { id: "c1" } }],
      "POST /api/v1/ideas/real-1/structure": [{ ok: true }],
      "POST /api/v1/issues/real-1/comments": [{ comment: { id: "c2" } }],
      "POST /api/v1/ideas/broken-1/structure": [{ error: "nope" }], // will 200 but extractFields fails first
    });

    // Anthropic calls go through the same fetchImpl; stub them separately.
    const anthropicResponses = [
      // real-1
      { content: [{ text: '{"summary":"S","problem":"P","proposedSolution":"Sol","acceptanceCriteria":["A"]}' }] },
      // broken-1: malformed, no JSON at all -> extractFields throws
      { content: [{ text: "no json here" }] },
    ];
    const wrappedFetch = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("api.anthropic.com")) {
        const reply = anthropicResponses.shift();
        return new Response(JSON.stringify(reply), { status: 200 });
      }
      return fetchImpl(input as never, init);
    }) as unknown as typeof fetch;

    const result = await run(baseDeps(wrappedFetch), { dryRun: false });

    expect(result).toEqual({ total: 3, structured: 1, flagged: 1, failed: 1 });
  });

  it("dry run never calls structure or comment endpoints", async () => {
    const real = draft({ id: "real-1", number: 10, description: "A real, substantive draft idea with enough detail." });
    const { fetchImpl, calls } = fakeApi({ "GET /api/v1/issues": [{ items: [real], nextCursor: null }] });
    const wrappedFetch = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("api.anthropic.com")) {
        return new Response(
          JSON.stringify({ content: [{ text: '{"summary":"S","problem":"P","proposedSolution":"Sol","acceptanceCriteria":["A"]}' }] }),
          { status: 200 },
        );
      }
      return fetchImpl(input as never, init);
    }) as unknown as typeof fetch;

    const result = await run(baseDeps(wrappedFetch), { dryRun: true });

    expect(result).toEqual({ total: 1, structured: 1, flagged: 0, failed: 0 });
    expect(calls.every((c) => c.path === "/api/v1/issues")).toBe(true);
  });
});
