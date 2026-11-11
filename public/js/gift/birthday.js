// birthday.js: Christoph's birthday wrapping, the one line a page needs. Every 11 November (the
// visitor's local time, any year) the page opens under a sheet of gift paper to tear off. Ported
// from Klara's Farm's main.js wiring, without its flag system: the mode comes from `?wrap=` instead.
//
//   import { wrapBirthday } from "./gift/birthday.js";
//   wrapBirthday();                         // in main.js, first thing, before any await
//
// Modes, read from the page URL (`?wrap=always` to preview it on any day, `?wrap=never` to skip it):
//   auto    on 11 November only, and never in an automated browser (navigator.webdriver), so test
//           suites see the page itself unless they ask for the paper
//   always  every load
//   never   not at all
//
// It wraps on every load that day, and again when a tab or Home Screen app comes back from the
// background on an 11 November it has not wrapped on yet (those are resumed, not reloaded). Nothing
// is stored. A failure here is logged and the page carries on: a present never blocks the site.

import { wrap, wrapOn } from "./wrapper.js";

/** Christoph's birthday, every year. */
export const BIRTHDAY = "11-11";

const MODES = ["auto", "always", "never"];

/**
 * @param {{
 *   mode?: 'auto'|'always'|'never', when?: string, search?: string,
 *   options?: import("./wrapper.js").WrapOptions, now?: () => Date
 * }} [config]
 *   mode: overrides `?wrap=`; when: the gift day (default "11-11"); options: passed to the wrapper
 *   (theme defaults to "voyage"); now: the clock (tests)
 * @returns {{ current: import("./wrapper.js").Wrapping | null, stop: () => void }}
 */
export function wrapBirthday(config = {}) {
  const mode = config.mode ?? readMode(config.search ?? globalThis.location?.search ?? "");
  const handle = { current: null, stop() {} };
  if (mode === "never" || (mode === "auto" && globalThis.navigator?.webdriver)) return handle;

  const reduced = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  const options = {
    theme: "voyage",
    label: "A birthday present for Christoph. Drag to tear the paper open, or press Enter.",
    confetti: !reduced,
    ...config.options,
  };
  const now = config.now ?? (() => new Date());
  let wrappedOn = null;

  const tryWrap = () => {
    try {
      const today = now();
      if (wrappedOn === today.toDateString()) return;
      const present = mode === "always" ? wrap(options) : wrapOn(config.when ?? BIRTHDAY, { ...options, today });
      if (present) {
        wrappedOn = today.toDateString();
        handle.current = present;
      }
    } catch (e) {
      console.warn("birthday wrapping skipped", e);
    }
  };
  const onVisible = () => {
    if (document.visibilityState === "visible") tryWrap();
  };

  tryWrap();
  document.addEventListener("visibilitychange", onVisible);
  handle.stop = () => document.removeEventListener("visibilitychange", onVisible);
  return handle;
}

/** The mode from a query string: `?wrap=always|never|auto`; anything else is auto. */
export function readMode(search) {
  const value = new URLSearchParams(search).get("wrap");
  return MODES.includes(value ?? "") ? /** @type {'auto'|'always'|'never'} */ (value) : "auto";
}
