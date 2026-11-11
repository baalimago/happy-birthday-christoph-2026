// The helm: keys and on-screen buttons, read as a handful of booleans.
//   steer        ArrowLeft / ArrowRight, or A / D
//   sheet        ArrowUp lets the sails out, ArrowDown hauls them in (or W / S)
//   engine       E switches it on and off
//   anchor       X drops it and weighs it
//   syrus        T five times in quick succession and she flies; T once more lands her (Syrus mode)
//   rocket       R five times in quick succession lights it, and R once more puts it out (Amin mode)

/**
 * @typedef {{ left: boolean, right: boolean, out: boolean, in: boolean, engine: boolean, rocket: boolean, anchor: boolean, syrus: boolean }} Helm
 *   left, right, out and in are true while held; engine, rocket and anchor stay until switched
 * @typedef {'left' | 'right' | 'out' | 'in'} Order
 */

/** @type {Record<string, Order>} */
const KEYS = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'out',
  ArrowDown: 'in',
  a: 'left',
  d: 'right',
  w: 'out',
  s: 'in',
};

/** How long a keyboard press of an on-screen button holds its order, in milliseconds. */
const NUDGE = 450;
/** R this many times, each within this many milliseconds of the last, lights the rocket. */
const FUSE = 5;
const FUSE_GAP = 900;

/**
 * Listen for steering until the signal aborts. The returned object is live: read it every frame.
 * On-screen buttons are `button[data-helm="left|right|out|in|engine|anchor"]` inside `root`; the
 * engine and anchor buttons get `aria-pressed`.
 * @param {HTMLElement} root
 * @param {AbortSignal} signal
 * @returns {Helm}
 */
export function takeHelm(root, signal) {
  /** @type {Helm} */
  const helm = {
    left: false,
    right: false,
    out: false,
    in: false,
    engine: false,
    rocket: false,
    anchor: false,
    syrus: false,
  };
  const release = () => {
    helm.left = helm.right = helm.out = helm.in = false;
  };
  /** @param {'engine' | 'anchor'} gear */
  const flip = (gear) => {
    helm[gear] = !helm[gear];
    for (const button of root.querySelectorAll(`button[data-helm="${gear}"]`)) {
      button.setAttribute('aria-pressed', String(helm[gear]));
    }
  };

  // The fuse: `[data-rocket-hint]` elements show how far it has burnt (`data-count`) and
  // whether the rocket is lit (`data-lit`).
  let burnt = 0;
  let lastPress = 0;
  const showFuse = () => {
    for (const hint of root.querySelectorAll('[data-rocket-hint]')) {
      hint.setAttribute('data-count', String(burnt));
      hint.toggleAttribute('data-lit', helm.rocket);
    }
  };
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let fizzle;
  signal.addEventListener('abort', () => clearTimeout(fizzle));
  const pressFuse = () => {
    // Lit, one press puts it out.
    if (helm.rocket) {
      helm.rocket = false;
      burnt = 0;
      lastPress = 0;
      showFuse();
      return;
    }
    const now = performance.now();
    burnt = now - lastPress < FUSE_GAP ? burnt + 1 : 1;
    lastPress = now;
    if (burnt >= FUSE) {
      burnt = 0;
      helm.rocket = !helm.rocket;
    }
    showFuse();
    clearTimeout(fizzle);
    fizzle = setTimeout(() => {
      burnt = 0;
      showFuse();
    }, FUSE_GAP);
  };

  // The other fuse, with nothing on screen to give it away.
  let wound = 0;
  let lastWind = 0;
  const pressSyrus = () => {
    if (helm.syrus) {
      helm.syrus = false;
      wound = 0;
      return;
    }
    const now = performance.now();
    wound = now - lastWind < FUSE_GAP ? wound + 1 : 1;
    lastWind = now;
    if (wound >= FUSE) {
      wound = 0;
      helm.syrus = true;
    }
  };

  /** @param {KeyboardEvent} event */
  const typing = (event) =>
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    (event.target instanceof HTMLElement &&
      event.target.closest('input, textarea, select, [contenteditable]') !== null);
  /** @param {KeyboardEvent} event */
  const keyOf = (event) => (event.key.length === 1 ? event.key.toLowerCase() : event.key);

  addEventListener(
    'keydown',
    (event) => {
      if (typing(event)) return;
      const key = keyOf(event);
      if (key === 'e' && !event.repeat) flip('engine');
      if (key === 'x' && !event.repeat) flip('anchor');
      if (key === 'r' && !event.repeat) pressFuse();
      if (key === 't' && !event.repeat) pressSyrus();
      const order = KEYS[key];
      if (!order) return;
      helm[order] = true;
      event.preventDefault();
    },
    { signal },
  );
  addEventListener(
    'keyup',
    (event) => {
      const order = KEYS[keyOf(event)];
      if (order) helm[order] = false;
    },
    { signal },
  );
  addEventListener('blur', release, { signal });

  /** @param {Event} event */
  const buttonOf = (event) => {
    const button =
      event.target instanceof Element ? event.target.closest('button[data-helm]') : null;
    return button ? { button, order: button.getAttribute('data-helm') ?? '' } : null;
  };
  /** @param {string} order @returns {order is Order} */
  const held = (order) =>
    order === 'left' || order === 'right' || order === 'out' || order === 'in';

  root.addEventListener(
    'pointerdown',
    (event) => {
      const hit = buttonOf(event);
      if (!hit || !held(hit.order)) return;
      helm[hit.order] = true;
      hit.button.setPointerCapture(event.pointerId);
    },
    { signal },
  );
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    root.addEventListener(
      type,
      (event) => {
        const hit = buttonOf(event);
        if (hit && held(hit.order)) helm[hit.order] = false;
      },
      { signal },
    );
  }
  root.addEventListener(
    'click',
    (event) => {
      const hit = buttonOf(event);
      if (!hit) return;
      if (hit.order === 'engine' || hit.order === 'anchor') {
        flip(hit.order);
        return;
      }
      // Enter or Space on a focused button: a click with no pointer. Hold the order for a moment.
      const order = hit.order;
      if (!held(order) || /** @type {MouseEvent} */ (event).detail !== 0) return;
      helm[order] = true;
      setTimeout(() => {
        helm[order] = false;
      }, NUDGE);
    },
    { signal },
  );
  root.addEventListener(
    'contextmenu',
    (event) => {
      if (buttonOf(event)) event.preventDefault();
    },
    { signal },
  );
  return helm;
}
