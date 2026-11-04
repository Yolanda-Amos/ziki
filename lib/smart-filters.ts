import type { Prisma } from "@prisma/client";

/**
 * Smart search filters on the issue list (proposal: filter and search issues
 * by reporter, status and other attributes). Every filter lives in the URL so a
 * filtered list can be shared or saved as a favourite.
 *
 * - `reporter`, `assignee`: user ids, comma-separated (any of them matches).
 * - `at`: where the issue is in the pipeline, including the questions people
 *   keep asking: "which of mine are stuck?" and "which are live in production?".
 * - `pr`: has a pull request or not.
 * - `updated`: created within a window (the param name stays short).
 *
 * Each filter sets a plain field on the query (never `AND`/`OR`), so the status
 * tabs and their counts respect it too.
 */
export const REPORTER_PARAM = "reporter";
export const ASSIGNEE_PARAM = "assignee";
export const AT_PARAM = "at";
export const PR_PARAM = "pr";
export const UPDATED_PARAM = "updated";

export const SMART_FILTER_PARAMS = [REPORTER_PARAM, ASSIGNEE_PARAM, AT_PARAM, PR_PARAM, UPDATED_PARAM] as const;

/** An open issue still awaiting confirmation after this long counts as stuck. */
export const STUCK_AFTER_MS = 48 * 60 * 60 * 1000;

export const AT_OPTIONS = ["stuck", "unclaimed", "unreviewed", "on_dev", "on_staging", "on_prod"] as const;
export type AtFilter = (typeof AT_OPTIONS)[number];
export const atLabels: Record<AtFilter, string> = {
  stuck: "Stuck in confirmation (2+ days)",
  unclaimed: "Confirmed, no one working on it",
  unreviewed: "Delivered, not reviewed yet",
  on_dev: "Live on dev",
  on_staging: "Live on staging",
  on_prod: "Live in production",
};
/** Short form for the active-filter chip and the Filter button. */
export const atChipLabels: Record<AtFilter, string> = {
  stuck: "Stuck",
  unclaimed: "No one working on it",
  unreviewed: "Not reviewed",
  on_dev: "Live on dev",
  on_staging: "Live on staging",
  on_prod: "Live in production",
};

export const PR_OPTIONS = ["yes", "no"] as const;
export type PrFilter = (typeof PR_OPTIONS)[number];
export const prLabels: Record<PrFilter, string> = { yes: "Has a pull request", no: "No pull request yet" };

export const UPDATED_OPTIONS = ["1d", "7d", "30d"] as const;
export type UpdatedFilter = (typeof UPDATED_OPTIONS)[number];
export const updatedLabels: Record<UpdatedFilter, string> = { "1d": "Today", "7d": "This week", "30d": "This month" };
const UPDATED_MS: Record<UpdatedFilter, number> = { "1d": 864e5, "7d": 7 * 864e5, "30d": 30 * 864e5 };

export type SmartFilters = {
  reporters: string[];
  assignees: string[];
  at: AtFilter | null;
  pr: PrFilter | null;
  updated: UpdatedFilter | null;
};

const MAX_PEOPLE = 20;

function single(raw: string | string[] | undefined | null): string {
  return ((Array.isArray(raw) ? raw[0] : raw) ?? "").trim();
}

function ids(raw: string | string[] | undefined | null): string[] {
  const list = single(raw)
    .split(",")
    .map((id) => id.trim())
    .filter((id) => /^[A-Za-z0-9_-]{1,64}$/.test(id));
  return [...new Set(list)].slice(0, MAX_PEOPLE);
}

function oneOf<T extends string>(raw: string | string[] | undefined | null, options: readonly T[]): T | null {
  const value = single(raw).toLowerCase();
  return (options as readonly string[]).includes(value) ? (value as T) : null;
}

export function parseSmartFilters(params: Record<string, string | string[] | undefined>): SmartFilters {
  return {
    reporters: ids(params[REPORTER_PARAM]),
    assignees: ids(params[ASSIGNEE_PARAM]),
    at: oneOf(params[AT_PARAM], AT_OPTIONS),
    pr: oneOf(params[PR_PARAM], PR_OPTIONS),
    updated: oneOf(params[UPDATED_PARAM], UPDATED_OPTIONS),
  };
}

export function hasSmartFilters(filters: SmartFilters): boolean {
  return filters.reporters.length > 0 || filters.assignees.length > 0 || Boolean(filters.at || filters.pr || filters.updated);
}

/** The clause for one pipeline position. */
export function atWhere(at: AtFilter, now: Date): Prisma.BugWhereInput {
  switch (at) {
    case "stuck":
      // Still awaiting confirmation two days after it became an issue.
      return { substatus: "requires_confirmation", createdAt: { lt: new Date(now.getTime() - STUCK_AFTER_MS) } };
    case "unclaimed":
      return { substatus: "open", claims: { none: { status: { in: ["active", "offered"] }, releasedAt: null } } };
    case "unreviewed":
      return { substatus: "requires_review", testVerdicts: { none: {} } };
    default:
      return { substatus: at };
  }
}

/**
 * Narrows `where` in place. A field another filter already set (the "Created
 * by me" or "Assigned to me" Show filter) is intersected rather than replaced,
 * so the two together mean both.
 */
export function applySmartFilters(where: Prisma.BugWhereInput, filters: SmartFilters, now = new Date()): void {
  const intersect = (existing: unknown, wanted: string[]): Prisma.StringFilter | string => {
    if (typeof existing === "string") return wanted.includes(existing) ? existing : { in: [] };
    return { in: wanted };
  };
  if (filters.reporters.length) where.reporterId = intersect(where.reporterId, filters.reporters);
  if (filters.assignees.length) where.assigneeId = intersect(where.assigneeId, filters.assignees);
  if (filters.at) Object.assign(where, atWhere(filters.at, now));
  if (filters.pr === "yes") where.pullRequestUrl = { not: null };
  if (filters.pr === "no") where.pullRequestUrl = null;
  if (filters.updated) {
    const since = new Date(now.getTime() - UPDATED_MS[filters.updated]);
    // "stuck" already bounds createdAt from above; keep both bounds.
    const current = where.createdAt;
    where.createdAt = current && typeof current === "object" && !(current instanceof Date)
      ? { ...current, gte: since }
      : { gte: since };
  }
}

/** The query string with one smart filter changed (empty removes it); the page resets. */
export function withFilter(query: URLSearchParams | string, key: string, value: string | null): URLSearchParams {
  const next = new URLSearchParams(query);
  next.delete("page");
  if (value) next.set(key, value);
  else next.delete(key);
  return next;
}

/** Adds or removes one person from a comma-separated people filter. */
export function togglePerson(query: URLSearchParams | string, key: typeof REPORTER_PARAM | typeof ASSIGNEE_PARAM, userId: string): URLSearchParams {
  const current = ids(new URLSearchParams(query).get(key));
  const nextIds = current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId];
  return withFilter(query, key, nextIds.join(","));
}
