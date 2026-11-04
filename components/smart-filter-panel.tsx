"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { issuesPath } from "@/lib/project-paths";

export type SmartFilterChip = { label: string; removeHref: string };
/**
 * One choice in the Filters panel. `single`: one value per param, tapping the
 * picked one clears it. `radio`: one value, always set (the All / Rejected /
 * Duplicates list). `multi`: a comma-separated set (several people).
 */
export type SmartFilterOption = { label: string; count: number; param: string; value: string; kind: "single" | "radio" | "multi" };
export type SmartFilterGroup = { label: string; options: SmartFilterOption[] };
/** A searchable list of people (reporter or assignee); each count is their issues in this project. */
export type SmartFilterPicker = { label: string; options: SmartFilterOption[] };
export type SmartFilterColumn = { title: string; groups: SmartFilterGroup[]; pickers?: SmartFilterPicker[] };
type Favourite = { name: string; href: string };

/** Favourites are kept per project on this device until they move to the server. */
const storageKey = (slug: string) => `ziki:favourite-searches:${slug}`;
const MAX_FAVOURITES = 20;
/** Space kept between the panel and the window's edges. */
const EDGE = 16;
const PANEL_WIDTH = 1080;
/** People shown in a picker before anything is typed. */
const PICKER_TOP = 5;

function readFavourites(slug: string): Favourite[] {
  try {
    const raw = window.localStorage.getItem(storageKey(slug));
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list)
      ? list.filter((item): item is Favourite => typeof item?.name === "string" && typeof item?.href === "string" && item.href.startsWith("/"))
      : [];
  } catch {
    return [];
  }
}

function writeFavourites(slug: string, list: Favourite[]) {
  try {
    window.localStorage.setItem(storageKey(slug), JSON.stringify(list.slice(0, MAX_FAVOURITES)));
  } catch {
    // Private window or blocked storage: favourites last until the page closes.
  }
}

function listValues(query: URLSearchParams, param: string): string[] {
  return (query.get(param) ?? "").split(",").map((value) => value.trim()).filter(Boolean);
}

export function isPicked(query: URLSearchParams, option: SmartFilterOption): boolean {
  return option.kind === "multi" ? listValues(query, option.param).includes(option.value) : query.get(option.param) === option.value;
}

/** The draft with one option tapped: ticked if it wasn't, unticked if it was (a radio always stays set). */
export function toggleOption(query: URLSearchParams, option: SmartFilterOption): URLSearchParams {
  const next = new URLSearchParams(query);
  if (option.kind === "multi") {
    const values = listValues(next, option.param);
    const updated = values.includes(option.value) ? values.filter((value) => value !== option.value) : [...values, option.value];
    if (updated.length) next.set(option.param, updated.join(","));
    else next.delete(option.param);
  } else if (option.kind === "radio" || next.get(option.param) !== option.value) {
    next.set(option.param, option.value);
  } else {
    next.delete(option.param);
  }
  return next;
}

/** Same filters, ignoring order and the page number, so an untouched draft closes without reloading. */
function sameQuery(a: URLSearchParams, b: URLSearchParams): boolean {
  const norm = (query: URLSearchParams) => {
    const copy = new URLSearchParams(query);
    copy.delete("page");
    copy.sort();
    return copy.toString();
  };
  return norm(a) === norm(b);
}

const FilterIcon = () => (
  <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 5h18l-7 8v5l-4 2v-7L3 5Z" /></svg>
);
const PeopleIcon = () => (
  <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.6a3.5 3.5 0 0 1 0 6.8M18.5 20a6.5 6.5 0 0 0-3-5.5" /></svg>
);
const StarIcon = ({ filled = false }: { filled?: boolean }) => (
  <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinejoin="round"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3Z" /></svg>
);
const MineIcon = () => (
  <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>
);
const COLUMN_ICONS: ReactNode[] = [<FilterIcon key="f" />, <MineIcon key="m" />, <PeopleIcon key="p" />];

const OPTION_CLASS = "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] text-zk-text hover:bg-zk-chip focus-visible:outline-2 focus-visible:outline-electric-blue";
const GROUP_LABEL_CLASS = "m-0 px-2 pb-0.5 pt-1 text-[11px] font-semibold uppercase tracking-wide text-zk-muted";

/** A tickable option: a checkbox for sets, a radio button for one-of choices. */
function OptionButton({ option, picked, onToggle }: { option: SmartFilterOption; picked: boolean; onToggle: () => void }) {
  const round = option.kind === "radio";
  return (
    <button
      type="button"
      role={round ? "menuitemradio" : "menuitemcheckbox"}
      aria-checked={picked}
      onClick={onToggle}
      className={`${OPTION_CLASS} ${picked ? "bg-zk-tint" : ""}`}
    >
      <span
        aria-hidden="true"
        className={`flex h-4 w-4 shrink-0 items-center justify-center border ${round ? "rounded-full" : "rounded"} ${
          picked ? "border-electric-blue-strong bg-electric-blue-strong text-white" : "border-zk-border bg-zk-surface"
        }`}
      >
        {picked ? (
          round ? <span className="h-1.5 w-1.5 rounded-full bg-white" /> : (
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
          )
        ) : null}
      </span>
      <span className={`min-w-0 flex-1 truncate ${picked ? "font-semibold text-zk-accent" : ""}`}>{option.label}</span>
      <span className="font-mono text-[11px] tabular-nums text-zk-muted">{option.count}</span>
    </button>
  );
}

/** Reporter or Assignee: ticked people first, then the busiest; typing finds anyone. */
function PeoplePicker({ picker, draft, onToggle }: {
  picker: SmartFilterPicker;
  draft: URLSearchParams;
  onToggle: (option: SmartFilterOption) => void;
}) {
  const [query, setQuery] = useState("");
  const typed = query.trim().toLowerCase();
  const picked = picker.options.filter((option) => isPicked(draft, option));
  const rest = picker.options.filter((option) => !isPicked(draft, option));
  const shown = typed
    ? picker.options.filter((option) => option.label.toLowerCase().includes(typed)).slice(0, 8)
    : [...picked, ...rest.slice(0, Math.max(0, PICKER_TOP - picked.length))];
  const noun = picker.label.toLowerCase();
  const article = /^[aeiou]/.test(noun) ? "an" : "a";
  const inputId = `picker-${noun}`;
  return (
    <div className="mb-2">
      <p className={GROUP_LABEL_CLASS}>{picker.label}</p>
      <label htmlFor={inputId} className="sr-only">Find {article} {noun}</label>
      <input
        id={inputId}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={`Find ${article} ${noun}…`}
        className="mx-2 mb-1 h-8 w-[calc(100%-1rem)] rounded-lg border border-zk-border bg-zk-surface px-2.5 text-[13px] text-zk-text outline-none placeholder:text-zk-muted focus:border-electric-blue"
      />
      {shown.length === 0 ? <p className="m-0 px-2 py-1 text-[12px] text-zk-muted">No one matches.</p> : null}
      {shown.map((option) => (
        <OptionButton key={option.value} option={option} picked={isPicked(draft, option)} onToggle={() => onToggle(option)} />
      ))}
      {!typed && picker.options.length > shown.length ? (
        <p className="m-0 px-2 pt-0.5 text-[11px] text-zk-muted">+{picker.options.length - shown.length} more, type to find</p>
      ) : null}
    </div>
  );
}

/**
 * The issue list's Filters panel (smart search): one box with every filter in
 * view at once, in columns (Filters, Mine, People, Favourites). Ticking options
 * builds a draft; Done, the close button, a tap outside or Esc applies it in
 * one navigation, so several filters combine without the panel closing.
 */
export function SmartFilterPanel({ columns, summary, hasFilters, currentQuery, currentHref, projectSlug, suggestedName }: {
  columns: SmartFilterColumn[];
  /** What is on, named on the button while the panel is closed. */
  summary?: string;
  /** A search or filter is on, so there is something to save. */
  hasFilters: boolean;
  /** The list's query as applied now, including `status` (the tab). */
  currentQuery: string;
  /** This list's address, saved as a favourite. */
  currentHref: string;
  projectSlug: string;
  suggestedName: string;
}) {
  const router = useRouter();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; right: number; width: number; maxHeight: number } | null>(null);
  const [draft, setDraft] = useState(() => new URLSearchParams(currentQuery));
  const [favourites, setFavourites] = useState<Favourite[]>([]);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  // The latest draft for the document listeners, which are set up once per opening.
  const draftRef = useRef(draft);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    // Read after mount: storage isn't there during the server render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFavourites(readFavourites(projectSlug));
  }, [projectSlug]);

  useEffect(() => {
    if (naming) nameRef.current?.focus();
  }, [naming]);

  /** Closes the panel and, if anything changed, loads the list with the draft's filters. */
  function applyAndClose(nextDraft: URLSearchParams = draftRef.current) {
    setOpen(false);
    setNaming(false);
    const applied = new URLSearchParams(currentQuery);
    if (sameQuery(nextDraft, applied)) return;
    const query = new URLSearchParams(nextDraft);
    query.delete("page");
    const status = query.get("status") || "all";
    query.delete("status");
    router.push(issuesPath(projectSlug, status, query));
  }
  const applyRef = useRef(applyAndClose);
  useEffect(() => {
    applyRef.current = applyAndClose;
  });

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        applyRef.current();
        buttonRef.current?.focus();
      }
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!panelRef.current?.contains(target) && !buttonRef.current?.contains(target)) applyRef.current();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  const isSaved = favourites.some((favourite) => favourite.href === currentHref);
  const canSave = hasFilters && !isSaved;
  const pendingChanges = !sameQuery(draft, new URLSearchParams(currentQuery));

  function openPanel() {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) {
      const top = rect.bottom + 6;
      // Line the panel up with the button's right edge, but keep the whole box inside the window.
      const width = Math.min(PANEL_WIDTH, window.innerWidth - 2 * EDGE);
      const right = Math.min(Math.max(EDGE, window.innerWidth - rect.right), window.innerWidth - width - EDGE);
      setPosition({ top, right, width, maxHeight: window.innerHeight - top - EDGE });
    }
    // Every opening starts from the filters applied now.
    setDraft(new URLSearchParams(currentQuery));
    setOpen(true);
  }

  function toggle(option: SmartFilterOption) {
    setDraft((current) => toggleOption(current, option));
  }

  /** Unticks every option the panel offers; the tab and the text search stay. */
  function clearDraft() {
    const params = new Set(
      columns
        .flatMap((column) => [...column.groups.flatMap((group) => group.options), ...(column.pickers ?? []).flatMap((picker) => picker.options)])
        .filter((option) => option.kind !== "radio")
        .map((option) => option.param),
    );
    setDraft((current) => {
      const next = new URLSearchParams(current);
      params.forEach((param) => next.delete(param));
      return next;
    });
  }

  function save() {
    const label = name.trim() || suggestedName || "Saved search";
    const next = [{ name: label.slice(0, 60), href: currentHref }, ...favourites.filter((favourite) => favourite.href !== currentHref)];
    setFavourites(next);
    writeFavourites(projectSlug, next);
    setNaming(false);
    setName("");
  }

  function remove(href: string) {
    const next = favourites.filter((favourite) => favourite.href !== href);
    setFavourites(next);
    writeFavourites(projectSlug, next);
  }

  // Shown while nothing is saved yet, so the column teaches what favourites are for.
  const starters: Favourite[] = [
    { name: "My issues that are stuck", href: issuesPath(projectSlug, "all", "mine=created&at=stuck") },
    { name: "Live in production", href: issuesPath(projectSlug, "all", "at=on_prod") },
    { name: "Confirmed, no one working on it", href: issuesPath(projectSlug, "all", "at=unclaimed") },
  ];
  const shownFavourites = favourites.length > 0 ? favourites : starters;
  const headingClass = "m-0 mb-1.5 flex items-center gap-2 px-2 text-[14px] font-bold text-zk-text";

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => (open ? applyAndClose() : openPanel())}
        className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-[13px] font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric-blue ${
          summary || isSaved ? "border-zk-accent bg-zk-tint text-zk-accent" : "border-zk-border bg-zk-surface text-zk-text2 hover:bg-zk-chip hover:text-zk-text"
        }`}
      >
        <FilterIcon />
        {summary ? `Filters: ${summary}` : "Filters"}
        <svg aria-hidden="true" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {open && position ? createPortal(
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Filters and favourites"
          // Rendered on <body> (a portal) so no toolbar ancestor can clip or re-anchor it.
          style={{ position: "fixed", top: position.top, right: position.right, width: position.width, maxHeight: Math.max(260, position.maxHeight) }}
          className="z-[60] flex flex-col overflow-hidden rounded-2xl border border-zk-border bg-zk-surface text-left shadow-[0_16px_40px_rgba(11,23,51,0.18)]"
        >
          <div className="flex items-center justify-between border-b border-zk-divider px-4 py-2.5">
            <p className="m-0 text-[13px] text-zk-muted">Tick as many as you like, then press Done.</p>
            <button
              type="button"
              onClick={() => applyAndClose()}
              aria-label="Apply filters and close"
              className="rounded-lg p-1.5 text-zk-muted hover:bg-zk-chip hover:text-zk-text"
            >
              <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto md:grid-cols-2 lg:grid-cols-4">
            {columns.map((column, columnIndex) => (
              <section key={column.title} aria-label={column.title} className="border-zk-divider p-4 max-md:border-b md:border-r">
                <h2 className={headingClass}>
                  <span className="text-zk-accent">{COLUMN_ICONS[columnIndex] ?? <FilterIcon />}</span>
                  {column.title}
                </h2>
                {column.groups.map((group, index) => (
                  <div key={group.label} className={index > 0 ? "mt-2 border-t border-zk-divider pt-2" : ""}>
                    <p className={GROUP_LABEL_CLASS}>{group.label}</p>
                    {group.options.map((option) => (
                      <OptionButton key={option.param + option.value} option={option} picked={isPicked(draft, option)} onToggle={() => toggle(option)} />
                    ))}
                  </div>
                ))}
                {column.pickers?.map((picker) => (
                  <PeoplePicker key={picker.label} picker={picker} draft={draft} onToggle={toggle} />
                ))}
              </section>
            ))}

            <section aria-label="Favourites" className="p-4">
              <h2 className={headingClass}>
                <span className="text-[#e3a008]"><StarIcon filled /></span>
                Favourites
              </h2>
              {canSave ? (
                naming ? (
                  <form
                    className="mb-2 flex gap-1.5 px-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      save();
                    }}
                  >
                    <label htmlFor="favourite-name" className="sr-only">Name this search</label>
                    <input
                      id="favourite-name"
                      ref={nameRef}
                      value={name}
                      maxLength={60}
                      placeholder={suggestedName || "Name this search"}
                      onChange={(event) => setName(event.target.value)}
                      className="h-8 min-w-0 flex-1 rounded-lg border border-zk-border bg-zk-surface px-2.5 text-[13px] text-zk-text outline-none focus:border-electric-blue"
                    />
                    <button type="submit" className="h-8 rounded-lg bg-electric-blue-strong px-3 text-[13px] font-bold text-white">Save</button>
                  </form>
                ) : (
                  <button type="button" onClick={() => setNaming(true)} className={`${OPTION_CLASS} mb-1 font-semibold text-zk-accent`}>
                    <span className="flex w-4 justify-center" aria-hidden="true">+</span>
                    Save current search
                  </button>
                )
              ) : (
                <p className="m-0 mb-1 px-2 text-[12px] text-zk-muted">
                  {isSaved ? "This search is saved." : "Apply a filter or search, then save it here."}
                </p>
              )}
              <p className={GROUP_LABEL_CLASS}>{favourites.length > 0 ? "Saved" : "Try one"}</p>
              <ul className="m-0 list-none p-0">
                {shownFavourites.map((favourite) => (
                  <li key={favourite.href} className="group flex items-center rounded-lg hover:bg-zk-chip">
                    <Link
                      href={favourite.href}
                      onClick={() => setOpen(false)}
                      className={`flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-[13px] ${favourite.href === currentHref ? "font-semibold text-zk-accent" : "text-zk-text"}`}
                    >
                      <span className="flex w-4 justify-center text-zk-muted" aria-hidden="true"><StarIcon filled={favourites.length > 0} /></span>
                      <span className="truncate">{favourite.name}</span>
                    </Link>
                    {favourites.length > 0 ? (
                      <button
                        type="button"
                        onClick={() => remove(favourite.href)}
                        aria-label={`Remove favourite ${favourite.name}`}
                        className="mr-1.5 rounded-md p-1 text-zk-muted opacity-60 hover:bg-zk-surface hover:text-zk-text group-hover:opacity-100"
                      >
                        <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-zk-divider px-4 py-2.5">
            <button type="button" onClick={clearDraft} className="rounded-lg px-2.5 py-1.5 text-[13px] font-semibold text-zk-muted hover:bg-zk-chip hover:text-zk-text">
              Clear all
            </button>
            <button
              type="button"
              onClick={() => applyAndClose()}
              className="h-9 rounded-lg bg-electric-blue-strong px-5 text-[13px] font-bold text-white shadow-[0_8px_20px_rgba(46,111,239,0.25)] hover:brightness-105"
            >
              {pendingChanges ? "Apply" : "Done"}
            </button>
          </div>
        </div>,
        document.body,
      ) : null}
    </>
  );
}
