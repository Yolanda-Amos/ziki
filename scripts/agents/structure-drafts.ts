/**
 * Draft-to-structured idea conversion agent (#1162 follow-up to #1435).
 *
 * Humans drop ideas informally via "Quick report" / "Detailed issue" on the
 * Issues Inbox. Those land as drafts (createdByAgentId: null, reported
 * stage) on the "Drafted ideas" tab. #1435 added POST
 * /api/v1/ideas/:id/structure, which formats {summary, problem,
 * proposedSolution, acceptanceCriteria} into the standard spec markdown —
 * but it does no parsing of its own. This script is the agent that reads
 * each raw draft, extracts those fields, and calls that endpoint.
 *
 * Usage:
 *   ZIKI_AGENT_KEY=<contributor+ level agent key> \
 *   ANTHROPIC_API_KEY=<key> \
 *     pnpm tsx scripts/agents/structure-drafts.ts [--dry-run]
 *
 * Env vars:
 *   ZIKI_BASE_URL     Ziki origin. Defaults to https://ziki.dev.
 *   ZIKI_AGENT_KEY    Agent API key, contributor level or above (required by
 *                     the /structure endpoint itself). Reusing an existing
 *                     agent (e.g. a solver already at contributor level) is
 *                     fine — this script only ever calls the ideas/comments
 *                     endpoints, nothing solver-specific.
 *   ANTHROPIC_API_KEY Used to extract structured fields from raw draft text.
 *
 * --dry-run prints what would be sent to /structure for each draft without
 * calling it or posting a comment. Operator-run or cron-run, same as
 * scripts/sweep-offers.ts and scripts/sweep-pairings.ts.
 */
import { isUnstructuredDraft } from "../../lib/ideas";

export type DraftIssue = {
  id: string;
  number: number;
  title: string;
  description: string;
  status: string;
  createdByAgentId: string | null;
};

export type Extraction = {
  summary: string;
  problem: string;
  proposedSolution: string;
  acceptanceCriteria: string[];
};

export type FetchFn = typeof fetch;

export type Deps = {
  zikiBaseUrl: string;
  zikiAgentKey: string;
  anthropicApiKey: string;
  anthropicModel: string;
  fetchImpl: FetchFn;
};

/**
 * A short line with no sentence punctuation is almost certainly a field
 * label from a template ("Expected", "Browser / app version:"), not content
 * — real sentences tend to run longer or end in . ? !
 */
function isLabelOnlyLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return true;
  if (/^\d+\.?$/.test(trimmed)) return true; // bare numbered list marker, e.g. "1."
  const words = trimmed.replace(/:$/, "").trim().split(/\s+/);
  const hasSentencePunctuation = /[.?!]/.test(trimmed);
  return words.length <= 6 && !hasSentencePunctuation;
}

/** A draft is too thin to structure honestly (e.g. an unfilled template). */
export function isTooThinToStructure(description: string): boolean {
  const contentLines = description
    .split("\n")
    .map((line) => line.replace(/^#{1,6}\s*/, "").replace(/^[-*]\s*/, "").trim())
    .filter((line) => line.length > 0 && !isLabelOnlyLine(line));
  const combined = contentLines.join(" ").replace(/\s+/g, " ").trim();
  return combined.length < 25;
}

/** Pull the JSON object out of a model response and validate its shape. */
export function parseExtraction(modelText: string): Extraction {
  const match = modelText.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`Could not find JSON in model output: ${modelText.slice(0, 200)}`);
  const parsed = JSON.parse(match[0]);
  if (
    typeof parsed.summary !== "string" ||
    typeof parsed.problem !== "string" ||
    typeof parsed.proposedSolution !== "string" ||
    !Array.isArray(parsed.acceptanceCriteria)
  ) {
    throw new Error(`Model output missing required fields: ${match[0].slice(0, 200)}`);
  }
  return parsed as Extraction;
}

export function buildExtractionPrompt(issue: Pick<DraftIssue, "title" | "description">): string {
  return `You are structuring a raw, informally-written product idea into a standard spec. Read the title and description below and extract four fields as JSON only (no prose, no markdown fences):

{"summary": "...", "problem": "...", "proposedSolution": "...", "acceptanceCriteria": ["...", "..."]}

Rules:
- Stay faithful to what was actually written. Do not invent requirements, numbers, or scope that isn't implied by the draft.
- "summary" is one line.
- "problem" states what's wrong or missing today, in the reporter's own terms where possible.
- "proposedSolution" is the fix/feature being proposed — if the draft doesn't propose one, describe what would need deciding.
- "acceptanceCriteria" is 2-5 short, checkable conditions.

Title: ${issue.title}

Description:
${issue.description}`;
}

async function zikiFetch(deps: Deps, path: string, init: RequestInit = {}) {
  const response = await deps.fetchImpl(`${deps.zikiBaseUrl}${path}`, {
    ...init,
    headers: {
      ...init.headers,
      Authorization: `Bearer ${deps.zikiAgentKey}`,
      "Content-Type": "application/json",
    },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`${init.method || "GET"} ${path} -> ${response.status}: ${body.slice(0, 500)}`);
  }
  return response.json();
}

/** List every open, reported-stage draft idea (human-created, unstructured). */
export async function listDrafts(deps: Deps): Promise<DraftIssue[]> {
  const drafts: DraftIssue[] = [];
  let cursor: string | null = null;
  do {
    const qs = new URLSearchParams({ stage: "reported", status: "open", limit: "100" });
    if (cursor) qs.set("cursor", cursor);
    const page: { items: DraftIssue[]; nextCursor: string | null } = await zikiFetch(deps, `/api/v1/issues?${qs}`);
    for (const issue of page.items) {
      if (issue.createdByAgentId !== null) continue; // agent-authored, not a human draft
      if (!isUnstructuredDraft(issue)) continue; // already has the standard headings
      drafts.push(issue);
    }
    cursor = page.nextCursor;
  } while (cursor);
  return drafts;
}

/** Ask Claude to pull the four structured fields out of raw draft text. */
export async function extractFields(deps: Deps, issue: DraftIssue): Promise<Extraction> {
  const response = await deps.fetchImpl("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": deps.anthropicApiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: deps.anthropicModel,
      max_tokens: 1024,
      messages: [{ role: "user", content: buildExtractionPrompt(issue) }],
    }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Anthropic API -> ${response.status}: ${body.slice(0, 500)}`);
  }
  const data = await response.json();
  const text: string = data.content?.[0]?.text ?? "";
  return parseExtraction(text);
}

export async function structureDraft(deps: Deps, issue: DraftIssue, fields: Extraction) {
  await zikiFetch(deps, `/api/v1/ideas/${issue.id}/structure`, {
    method: "POST",
    body: JSON.stringify(fields),
  });
  await zikiFetch(deps, `/api/v1/issues/${issue.id}/comments`, {
    method: "POST",
    body: JSON.stringify({
      body: "Structured from a raw draft by the draft-idea conversion agent — summary, problem statement, proposed solution and acceptance criteria were extracted from the original text. Please correct anything that doesn't match your intent.",
      type: "comment",
    }),
  });
}

export async function flagTooThin(deps: Deps, issue: DraftIssue) {
  await zikiFetch(deps, `/api/v1/issues/${issue.id}/comments`, {
    method: "POST",
    body: JSON.stringify({
      body: "This draft doesn't have enough detail to structure responsibly yet (looks like an unfilled template or a one-liner). Could you add what you'd expect to happen, what actually happens, and any context — then it can be picked up for structuring?",
      type: "comment",
    }),
  });
}

export async function run(deps: Deps, options: { dryRun: boolean } = { dryRun: false }) {
  const drafts = await listDrafts(deps);
  let structured = 0;
  let flagged = 0;
  let failed = 0;

  for (const issue of drafts) {
    try {
      if (isTooThinToStructure(issue.description)) {
        console.log(`#${issue.number} "${issue.title}" — too thin, flagging for more detail.`);
        if (!options.dryRun) await flagTooThin(deps, issue);
        flagged++;
        continue;
      }

      const fields = await extractFields(deps, issue);
      if (options.dryRun) {
        console.log(`#${issue.number} "${issue.title}" — would structure with:`, fields);
      } else {
        await structureDraft(deps, issue, fields);
        console.log(`#${issue.number} "${issue.title}" — structured.`);
      }
      structured++;
    } catch (error) {
      console.error(`#${issue.number} "${issue.title}" — failed:`, error instanceof Error ? error.message : error);
      failed++;
    }
  }

  return { total: drafts.length, structured, flagged, failed };
}

async function main() {
  const zikiAgentKey = process.env.ZIKI_AGENT_KEY;
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  if (!zikiAgentKey) throw new Error("ZIKI_AGENT_KEY is required.");
  if (!anthropicApiKey) throw new Error("ANTHROPIC_API_KEY is required.");

  const dryRun = process.argv.includes("--dry-run");
  const deps: Deps = {
    zikiBaseUrl: (process.env.ZIKI_BASE_URL || "https://ziki.dev").replace(/\/+$/, ""),
    zikiAgentKey,
    anthropicApiKey,
    anthropicModel: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5",
    fetchImpl: fetch,
  };

  console.log(`Listing drafted ideas on ${deps.zikiBaseUrl}${dryRun ? " (dry run)" : ""}...`);
  const result = await run(deps, { dryRun });
  console.log(`Found ${result.total} unstructured draft(s).`);
  console.log(`Done. Structured ${result.structured}, flagged ${result.flagged}, failed ${result.failed}.`);
  if (result.failed > 0) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
