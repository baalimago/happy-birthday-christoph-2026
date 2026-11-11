import { wrapBirthday } from '#gift/birthday.js';
import { lazyDefine } from '#lib/lazy-define.js';

// Every 11 November the page opens under gift paper. First thing, before anything draws.
wrapBirthday();

lazyDefine('voyage-sea', () => import('#components/voyage-sea/voyage-sea.js'));
lazyDefine('voyage-hud', () => import('#components/voyage-hud/voyage-hud.js'));
lazyDefine('voyage-chart', () => import('#components/voyage-chart/voyage-chart.js'));
lazyDefine('voyage-reading', () => import('#components/voyage-reading/voyage-reading.js'));
lazyDefine('voyage-log', () => import('#components/voyage-log/voyage-log.js'));

// The sea has a sound. Nothing plays before the first key or tap, and Q or the Sound button mutes it.
import('#audio/soundscape.js').then(({ startSoundscape }) =>
  startSoundscape(new AbortController().signal),
);
