import { useEffect, useRef } from "react";

/** Everything a person can change something with. A plain `role="button"` tile is not one. */
const CONTROLS = [
  "button",
  "input",
  "select",
  "textarea",
  '[role="slider"]',
  '[role="switch"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="combobox"]',
  '[contenteditable="true"]',
].join(", ");

/**
 * Spread onto a control (or a wrapper around several) that only LOOKS at the video — a time
 * range tab, the search box, the player, Cost, Download — so `useViewOnlyGuard` leaves it working.
 */
export const VIEW_OK = { "data-view-ok": "" } as const;

/** Spread onto a part of a `VIEW_OK` area that changes the video after all (a save field). */
export const VIEW_EDIT = { "data-view-edit": "" } as const;

/**
 * View only, without freezing the page: while `active`, every control inside is paused UNLESS
 * it is marked `VIEW_OK`. Paused by default is the safe direction — a button added later is
 * paused until someone decides it only looks.
 *
 * A `<fieldset disabled>` (what a takeover uses) cannot do this: nothing inside one can be
 * switched back on, so it froze the time-range tabs and the search box along with Regenerate.
 * This marks each paused control `inert` instead — not clickable, not focusable, skipped by the
 * keyboard — and re-marks whatever the page draws later. The server refuses the changes
 * regardless (`assertJobAccess`); this is what makes the screen say so before the click.
 *
 * Returns the ref to put on the element that holds the controls.
 */
export function useViewOnlyGuard<T extends HTMLElement>(active: boolean) {
  const ref = useRef<T>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const apply = () => {
      root.querySelectorAll<HTMLElement>(CONTROLS).forEach(el => {
        const looksOnly =
          !!el.closest("[data-view-ok]") && !el.closest("[data-view-edit]");
        const pause = active && !looksOnly;
        if (pause && !el.hasAttribute("data-view-paused")) {
          el.setAttribute("inert", "");
          el.setAttribute("data-view-paused", "");
        } else if (!pause && el.hasAttribute("data-view-paused")) {
          el.removeAttribute("inert");
          el.removeAttribute("data-view-paused");
        }
      });
    };
    apply();
    if (!active) return;
    const observer = new MutationObserver(apply);
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [active]);

  return ref;
}
