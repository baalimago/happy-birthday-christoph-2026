// The helm: arrow keys (or WASD) and on-screen buttons, read as four booleans.

/** @typedef {{ left: boolean, right: boolean, up: boolean, down: boolean }} Helm */
/** @typedef {keyof Helm} Order */

/** @type {Record<string, Order>} */
const KEYS = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
  a: 'left',
  d: 'right',
  w: 'up',
  s: 'down',
};

/** How long a keyboard press of an on-screen button holds its order, in milliseconds. */
const NUDGE = 450;

/**
 * Listen for steering until the signal aborts. The returned object is live: read it every frame.
 * On-screen buttons are `button[data-helm="left|right|up|down"]` inside `root`.
 * @param {HTMLElement} root
 * @param {AbortSignal} signal
 * @returns {Helm}
 */
export function takeHelm(root, signal) {
  /** @type {Helm} */
  const helm = { left: false, right: false, up: false, down: false };
  const release = () => {
    helm.left = helm.right = helm.up = helm.down = false;
  };

  /** @param {KeyboardEvent} event */
  const orderOf = (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return undefined;
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      target.closest('input, textarea, select, [contenteditable]')
    ) {
      return undefined;
    }
    return KEYS[event.key.length === 1 ? event.key.toLowerCase() : event.key];
  };
  addEventListener(
    'keydown',
    (event) => {
      const order = orderOf(event);
      if (!order) return;
      helm[order] = true;
      event.preventDefault();
    },
    { signal },
  );
  addEventListener(
    'keyup',
    (event) => {
      const order = orderOf(event);
      if (order) helm[order] = false;
    },
    { signal },
  );
  addEventListener('blur', release, { signal });

  /** @param {Event} event */
  const buttonOrder = (event) => {
    const button =
      event.target instanceof Element ? event.target.closest('button[data-helm]') : null;
    const order = button?.getAttribute('data-helm') ?? '';
    return order in helm ? { button, order: /** @type {Order} */ (order) } : null;
  };
  root.addEventListener(
    'pointerdown',
    (event) => {
      const hit = buttonOrder(event);
      if (!hit) return;
      helm[hit.order] = true;
      hit.button?.setPointerCapture(event.pointerId);
    },
    { signal },
  );
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    root.addEventListener(
      type,
      (event) => {
        const hit = buttonOrder(event);
        if (hit) helm[hit.order] = false;
      },
      { signal },
    );
  }
  // Enter or Space on a focused button: a click with no pointer. Hold the order for a moment.
  root.addEventListener(
    'click',
    (event) => {
      const hit = buttonOrder(event);
      if (!hit || /** @type {MouseEvent} */ (event).detail !== 0) return;
      helm[hit.order] = true;
      setTimeout(() => {
        helm[hit.order] = false;
      }, NUDGE);
    },
    { signal },
  );
  root.addEventListener(
    'contextmenu',
    (event) => {
      if (buttonOrder(event)) event.preventDefault();
    },
    { signal },
  );
  return helm;
}
