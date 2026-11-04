"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { issuesPath } from "@/lib/project-paths";
import type { ToolbarFilterGroup, ToolbarFilterOption } from "@/components/toolbar-filter-menu";

export type SmartFilterChip = { label: string; removeHref: string };
/** A searchable list of people (reporter or assignee); each option's count is their issues in this project. */
export type SmartFilterPicker = { label: string; options: ToolbarFilterOption[] };
export type SmartFilterColumn = { title: string; groups: ToolbarFilterGroup[]; pickers?: SmartFilterPicker[] };
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

function CheckMark({ on }: { on: boolean }) {
  return (
    <span className="flex w-4 justify-center text-zk-accent" aria-hidden="true">
      {on ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg> : null}
    </span>
  );
}

/** Reporter or Assignee: picked people first, then the busiest; typing finds anyone. */
function PeoplePicker({ picker, optionClass, labelClass, onPick }: {
  picker: SmartFilterPicker;
  optionClass: string;
  labelClass: string;
  onPick: () => void;
}) {
  const [query, setQuery] = useState("");
  const typed = query.trim().toLowerCase();
  const selected = picker.options.filter((option) => option.selected);
  const rest = picker.options.filter((option) => !option.selected);
  const shown = typed
    ? picker.options.filter((option) => option.label.toLowerCase().includes(typed)).slice(0, 8)
    : [...selected, ...rest.slice(0, Math.max(0, PICKER_TOP - selected.length))];
  const inputId = `picker-${picker.label.toLowerCase()}`;
  return (
    <div className="mb-2">
      <p className={labelClass}>{picker.label}</p>
      <label htmlFor={inputId} className="sr-only">Find a {picker.label.toLowerCase()}</label>
      <input
        id={inputId}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={`Find a ${picker.label.toLowerCase()}…`}
        className="mx-2 mb-1 h-8 w-[calc(100%-1rem)] rounded-lg border border-zk-border bg-zk-surface px-2.5 text-[13px] text-zk-text outline-none placeholder:text-zk-muted focus:border-electric-blue"
      />
      {shown.length === 0 ? <p className="m-0 px-2 py-1 text-[12px] text-zk-muted">No one matches.</p> : null}
      {shown.map((option) => (
        <Link
          key={option.href}
          href={option.href}
          role="menuitemcheckbox"
          aria-checked={option.selected}
          onClick={onPick}
          className={`${optionClass} ${option.selected ? "bg-zk-tint" : ""}`}
        >
          <CheckMark on={option.selected} />
          <span className={`min-w-0 flex-1 truncate ${option.selected ? "font-semibold text-zk-accent" : ""}`}>{option.label}</span>
          <span className="font-mono text-[11px] tabular-nums text-zk-muted">{option.count}</span>
        </Link>
      ))}
      {!typed && picker.options.length > shown.length ? (
        <p className="m-0 px-2 pt-0.5 text-[11px] text-zk-muted">+{picker.options.length - shown.length} more, type to find</p>
      ) : null}
    </div>
  );
}

/**
 * The issue list's Filters panel (smart search): one box with every filter in
 * view at once, in columns (Filters, People, Favourites), so nothing is hidden
 * below the fold. Each option is a link, so the list still filters on the server.
 */
export function SmartFilterPanel({ columns, summary, hasFilters, currentHref, projectSlug, suggestedName }: {
  columns: SmartFilterColumn[];
  /** What is on, named on the button while the panel is closed. */
  summary?: string;
  /** A search or filter is on, so there is something to save. */
  hasFilters: boolean;
  /** This list's address, saved as a favourite. */
  currentHref: string;
  projectSlug: string;
  suggestedName: string;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; right: number; width: number; maxHeight: number } | null>(null);
  const [favourites, setFavourites] = useState<Favourite[]>([]);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");

  useEffect(() => {
    // Read after mount: storage isn't there during the server render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFavourites(readFavourites(projectSlug));
  }, [projectSlug]);

  useEffect(() => {
    if (naming) nameRef.current?.focus();
  }, [naming]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!panelRef.current?.contains(target) && !buttonRef.current?.contains(target)) setOpen(false);
    };
    const close = () => setOpen(false);
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  const isSaved = favourites.some((favourite) => favourite.href === currentHref);
  const canSave = hasFilters && !isSaved;

  function toggle() {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) {
      const top = rect.bottom + 6;
      // Line the panel up with the button's right edge, but keep the whole box inside the window.
      const width = Math.min(PANEL_WIDTH, window.innerWidth - 2 * EDGE);
      const right = Math.min(Math.max(EDGE, window.innerWidth - rect.right), window.innerWidth - width - EDGE);
      setPosition({ top, right, width, maxHeight: window.innerHeight - top - EDGE });
    }
    setOpen((value) => !value);
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
  const shown = favourites.length > 0 ? favourites : starters;

  const headingClass = "m-0 mb-1.5 flex items-center gap-2 px-2 text-[14px] font-bold text-zk-text";
  const groupLabelClass = "m-0 px-2 pb-0.5 pt-1 text-[11px] font-semibold uppercase tracking-wide text-zk-muted";
  const optionClass = "flex items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] text-zk-text hover:bg-zk-chip";

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={toggle}
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
          style={{ position: "fixed", top: position.top, right: position.right, width: position.width, maxHeight: Math.max(240, position.maxHeight) }}
          className="z-[60] grid grid-cols-1 overflow-y-auto rounded-2xl border border-zk-border bg-zk-surface text-left shadow-[0_16px_40px_rgba(11,23,51,0.18)] md:grid-cols-2 lg:grid-cols-4"
        >
          {columns.map((column, columnIndex) => (
            <section key={column.title} aria-label={column.title} className="border-zk-divider p-4 max-md:border-b md:border-r">
              <h2 className={headingClass}>
                <span className="text-zk-accent">{COLUMN_ICONS[columnIndex] ?? <FilterIcon />}</span>
                {column.title}
              </h2>
              {column.groups.map((group, index) => (
                <div key={group.label ?? index} className={index > 0 ? "mt-2 border-t border-zk-divider pt-2" : ""}>
                  {group.label ? <p className={groupLabelClass}>{group.label}</p> : null}
                  {group.options.map((option) => (
                    <Link
                      key={option.href + option.label}
                      href={option.href}
                      role="menuitemcheckbox"
                      aria-checked={option.selected}
                      onClick={() => setOpen(false)}
                      className={`${optionClass} ${option.selected ? "bg-zk-tint" : ""}`}
                    >
                      <span className="flex w-4 justify-center text-zk-accent" aria-hidden="true">
                        {option.selected ? (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                        ) : null}
                      </span>
                      <span className={`flex-1 ${option.selected ? "font-semibold text-zk-accent" : ""}`}>{option.label}</span>
                      <span className="font-mono text-[11px] tabular-nums text-zk-muted">{option.count}</span>
                    </Link>
                  ))}
                </div>
              ))}
              {column.pickers?.map((picker) => (
                <PeoplePicker key={picker.label} picker={picker} optionClass={optionClass} labelClass={groupLabelClass} onPick={() => setOpen(false)} />
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
                <button type="button" onClick={() => setNaming(true)} className={`${optionClass} mb-1 w-full text-left font-semibold text-zk-accent`}>
                  <span className="flex w-4 justify-center" aria-hidden="true">+</span>
                  Save current search
                </button>
              )
            ) : (
              <p className="m-0 mb-1 px-2 text-[12px] text-zk-muted">
                {isSaved ? "This search is saved." : "Pick a filter or search, then save it here."}
              </p>
            )}
            <p className={groupLabelClass}>{favourites.length > 0 ? "Saved" : "Try one"}</p>
            <ul className="m-0 list-none p-0">
              {shown.map((favourite) => (
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
        </div>,
        document.body,
      ) : null}
    </>
  );
}
