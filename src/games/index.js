import { SlotMachine } from './slots.js';
import { LoanDesk } from './misc.js';
import { Blackjack } from './blackjack.js';
import { BigWheel } from './wheel.js';
import { ScratchKiosk } from './scratch.js';

export const STATIONS = {
  slots: SlotMachine,
  loan: LoanDesk,
  blackjack: Blackjack,
  wheel: BigWheel,
  scratch: ScratchKiosk,
};
