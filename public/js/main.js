import { wrapBirthday } from '#gift/birthday.js';
import { lazyDefine } from '#lib/lazy-define.js';

// Every 11 November the page opens under gift paper. First thing, before anything draws.
wrapBirthday();

lazyDefine('voyage-sea', () => import('#components/voyage-sea/voyage-sea.js'));
lazyDefine('voyage-hud', () => import('#components/voyage-hud/voyage-hud.js'));
lazyDefine('voyage-chart', () => import('#components/voyage-chart/voyage-chart.js'));
lazyDefine('voyage-log', () => import('#components/voyage-log/voyage-log.js'));
