// The helm: keys and on-screen buttons, read as a handful of booleans.
//   steer        ArrowLeft / ArrowRight, or A / D
//   sheet        ArrowUp lets the sails out, ArrowDown hauls them in (or W / S)
//   engine       E switches it on and off

/**
 * @typedef {{ left: boolean, right: boolean, out: boolean, in: boolean, engine: boolean }} Helm
 *   left, right, out and in are true while held; engine stays on until switched off
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

/**
 * Listen for steering until the signal aborts. The returned object is live: read it every frame.
 * On-screen buttons are `button[data-helm="left|right|out|in|engine"]` inside `root`; the engine
 * button gets `aria-pressed`.
 * @param {HTMLElement} root
 * @param {AbortSignal} signal
 * @returns {Helm}
 */
export function takeHelm(root, signal) {
  /** @type {Helm} */
  const helm = { left: false, right: false, out: false, in: false, engine: false };
  const release = () => {
    helm.left = helm.right = helm.out = helm.in = false;
  };
  const switchEngine = () => {
    helm.engine = !helm.engine;
    for (const button of root.querySelectorAll('button[data-helm="engine"]')) {
      button.setAttribute('aria-pressed', String(helm.engine));
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
      if (key === 'e' && !event.repeat) switchEngine();
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
  const held = (order) => order === 'left' || order === 'right' || order === 'out' || order === 'in';

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
      if (hit.order === 'engine') {
        switchEngine();
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
