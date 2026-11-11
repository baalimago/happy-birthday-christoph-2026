import { wrapBirthday } from '#gift/birthday.js';
import { lazyDefine } from '#lib/lazy-define.js';

let afloat = false;
/** Wake the sea and its sound. Charting and rigging are heavy, so they wait for the paper to go. */
function launch() {
  if (afloat) return;
  afloat = true;
  lazyDefine('voyage-sea', () => import('#components/voyage-sea/voyage-sea.js'));
  // Nothing plays before the first key or tap, and Q or the Sound button mutes it.
  import('#audio/soundscape.js').then(({ startSoundscape }) =>
    startSoundscape(new AbortController().signal),
  );
}

// Every 11 November the page opens under gift paper. First thing, before anything draws; and the
// paper has the machine to itself until it is torn off.
const present = wrapBirthday({ options: { onOpen: launch } });

lazyDefine('voyage-hud', () => import('#components/voyage-hud/voyage-hud.js'));
lazyDefine('voyage-chart', () => import('#components/voyage-chart/voyage-chart.js'));
lazyDefine('voyage-reading', () => import('#components/voyage-reading/voyage-reading.js'));
lazyDefine('voyage-log', () => import('#components/voyage-log/voyage-log.js'));

if (present.current) {
  // Under the paper lies the greeting on its backdrop, not the logbook: tearing shows that, and
  // the loading bar starts to move once the paper is off.
  document.querySelector('voyage-sea')?.setAttribute('loading', 'wait');
} else launch();
