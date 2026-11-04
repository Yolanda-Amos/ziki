"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { issuesPath } from "@/lib/project-paths";

export type SmartFilterChip = { label: string; removeHref: string };
type Favourite = { name: string; href: string };

/** Favourites are kept per project on this device until they move to the server. */
const storageKey = (slug: string) => `ziki:favourite-searches:${slug}`;
const MAX_FAVOURITES = 20;

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

/**
 * Under the issue toolbar: what the list is filtered by, as chips that each
 * remove one filter, and Favourites, the searches you saved to come back to.
 */
export function SmartFilterBar({ chips, clearHref, currentHref, projectSlug, resultCount, suggestedName }: {
  chips: SmartFilterChip[];
  clearHref: string;
  /** This list's address, saved as a favourite. */
  currentHref: string;
  projectSlug: string;
  resultCount: number;
  suggestedName: string;
}) {
  const [favourites, setFavourites] = useState<Favourite[]>([]);
  const [open, setOpen] = useState(false);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  // The name box appears on request ("Save this search"), so move focus into it.
  useEffect(() => {
    if (naming) nameRef.current?.focus();
  }, [naming]);

  useEffect(() => {
    // Read after mount: storage isn't there during the server render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFavourites(readFavourites(projectSlug));
  }, [projectSlug]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!panelRef.current?.contains(target) && !buttonRef.current?.contains(target)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const isSaved = favourites.some((favourite) => favourite.href === currentHref);
  const canSave = chips.length > 0 && !isSaved;

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

  // Shown while nothing is saved yet, so the menu teaches what favourites are for.
  const starters: Favourite[] = [
    { name: "My issues that are stuck", href: issuesPath(projectSlug, "all", "mine=created&at=stuck") },
    { name: "Live in production", href: issuesPath(projectSlug, "all", "at=on_prod") },
    { name: "Confirmed, no one working on it", href: issuesPath(projectSlug, "all", "at=unclaimed") },
  ];

  return (
    <div className="smart-filter-bar flex flex-wrap items-center gap-2 print:hidden" aria-label="Active filters and favourites">
      {chips.length > 0 ? (
        <>
          <span className="text-[12px] font-semibold text-zk-muted">
            {resultCount} {resultCount === 1 ? "issue" : "issues"} ·
          </span>
          <ul className="m-0 flex list-none flex-wrap items-center gap-1.5 p-0">
            {chips.map((chip) => (
              <li key={chip.label}>
                <Link
                  href={chip.removeHref}
                  aria-label={`Remove filter ${chip.label}`}
                  className="inline-flex h-7 items-center gap-1.5 rounded-full border border-zk-accent/30 bg-zk-tint pl-3 pr-2 text-[12px] font-semibold text-zk-accent hover:border-zk-accent"
                >
                  {chip.label}
                  <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
                </Link>
              </li>
            ))}
          </ul>
          <Link href={clearHref} className="text-[12px] font-semibold text-zk-muted underline-offset-2 hover:text-zk-text hover:underline">
            Clear all
          </Link>
        </>
      ) : null}

      <div className="relative ml-auto">
        <button
          ref={buttonRef}
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-[13px] font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric-blue ${
            isSaved ? "border-zk-accent bg-zk-tint text-zk-accent" : "border-zk-border bg-zk-surface text-zk-text2 hover:bg-zk-chip hover:text-zk-text"
          }`}
        >
          <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill={isSaved ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinejoin="round"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3Z" /></svg>
          Favourites
          {favourites.length > 0 ? <span className="font-mono text-[11px] tabular-nums text-zk-muted">{favourites.length}</span> : null}
        </button>

        {open ? (
          <div
            ref={panelRef}
            role="dialog"
            aria-label="Favourite searches"
            className="absolute right-0 z-40 mt-1.5 w-[300px] max-w-[calc(100vw-2rem)] rounded-xl border border-zk-border bg-zk-surface py-1.5 text-left shadow-[0_16px_40px_rgba(11,23,51,0.18)]"
          >
            {canSave ? (
              naming ? (
                <form
                  className="flex gap-1.5 border-b border-zk-divider px-3 pb-2.5 pt-1"
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
                <button
                  type="button"
                  onClick={() => setNaming(true)}
                  className="flex w-full items-center gap-2 border-b border-zk-divider px-3 pb-2 pt-1 text-left text-[13px] font-semibold text-zk-accent hover:bg-zk-chip"
                >
                  <span aria-hidden="true" className="text-base leading-none">+</span> Save this search
                </button>
              )
            ) : isSaved ? (
              <p className="m-0 border-b border-zk-divider px-3 pb-2 pt-1 text-[12px] text-zk-muted">This search is saved.</p>
            ) : (
              <p className="m-0 border-b border-zk-divider px-3 pb-2 pt-1 text-[12px] text-zk-muted">Pick a filter or search, then save it here.</p>
            )}

            <p className="m-0 px-3 pb-0.5 pt-2 text-[11px] font-semibold uppercase tracking-wide text-zk-muted">
              {favourites.length > 0 ? "Saved" : "Try one"}
            </p>
            <ul className="m-0 list-none p-0">
              {(favourites.length > 0 ? favourites : starters).map((favourite) => (
                <li key={favourite.href} className="group flex items-center hover:bg-zk-chip">
                  <Link
                    href={favourite.href}
                    onClick={() => setOpen(false)}
                    className={`min-w-0 flex-1 truncate px-3 py-1.5 text-[13px] ${favourite.href === currentHref ? "font-semibold text-zk-accent" : "text-zk-text"}`}
                  >
                    {favourite.name}
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
          </div>
        ) : null}
      </div>
    </div>
  );
}
