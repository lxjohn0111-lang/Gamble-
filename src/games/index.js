import { SlotMachine } from './slots.js';
import { LoanDesk } from './misc.js';
import { Blackjack } from './blackjack.js';
import { BigWheel } from './wheel.js';
import { ScratchKiosk } from './scratch.js';
import { Roulette } from './roulette.js';
import { Plinko } from './plinko.js';
import { CoinPusher } from './pusher.js';
import { Craps } from './craps.js';
import { VideoPoker } from './videopoker.js';
import { Baccarat } from './baccarat.js';
import { Crash } from './crash.js';
import { Mines } from './mines.js';
import { SicBo } from './sicbo.js';
import { Derby } from './derby.js';

// Registry of every casino game station by layout type.
export const STATIONS = {
  slots: SlotMachine,
  loan: LoanDesk,
  blackjack: Blackjack,
  wheel: BigWheel,
  scratch: ScratchKiosk,
  roulette: Roulette,
  plinko: Plinko,
  pusher: CoinPusher,
  craps: Craps,
  videopoker: VideoPoker,
  baccarat: Baccarat,
  crash: Crash,
  mines: Mines,
  sicbo: SicBo,
  derby: Derby,
};
