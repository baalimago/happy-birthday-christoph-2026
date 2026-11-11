/**
 * Captain's orders as numbers: is a goal done, and which views are open?
 *
 * Goal grammar: `sail` (the boat has moved), `port:<id>` (that port found),
 * `ports:<n>` (at least n ports found), `views:<n>` (at least n views unlocked, poster counts).
 *
 * @typedef {{ found: readonly string[], views: number, sailed: boolean }} Progress
 */

/** Every view, in shader order. The poster is always unlocked. */
const VIEW_ORDER = ['poster', 'terminal', 'gold', 'chart'];

/**
 * A count in a goal: digits only, so `ports:` or `ports:three` is never done.
 * @param {string} text
 * @returns {number}
 */
function count(text) {
  return /^\d+$/.test(text) ? Number(text) : Infinity;
}

/**
 * @param {string} goal
 * @param {Progress} progress
 * @returns {boolean} false for a goal the grammar does not know
 */
export function isDone(goal, progress) {
  if (goal === 'sail') return progress.sailed;
  const colon = goal.indexOf(':');
  if (colon < 0) return false;
  const kind = goal.slice(0, colon);
  const arg = goal.slice(colon + 1);
  if (kind === 'port') return arg !== '' && progress.found.includes(arg);
  if (kind === 'ports') return progress.found.length >= count(arg);
  if (kind === 'views') return progress.views >= count(arg);
  return false;
}

/**
 * @param {readonly string[]} found port ids found so far
 * @param {Readonly<Record<string, string>>} portViews the view each port unlocks, by port id
 * @returns {string[]} unlocked view ids in the order poster, terminal, gold, chart
 */
export function unlockedViews(found, portViews) {
  const open = new Set(['poster']);
  for (const port of found) {
    if (Object.hasOwn(portViews, port)) open.add(portViews[port]);
  }
  return VIEW_ORDER.filter((view) => open.has(view));
}
