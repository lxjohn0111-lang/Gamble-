// ============================================================================
//  Difficulty tuning in one place.
//
//  Gamble! is a player-friendly casino: every game pays back a little more than
//  it takes on average (RTP above 100%), Big Tony's quotas are moderate, and a
//  run of bad luck is softened by Lady Luck. Raise or lower these to retune.
// ============================================================================
export const BALANCE = {
  // Every win's profit is paid this much extra ("the house is on your side tonight").
  houseLuck: 0.1,
  // Hot streak: after the 2nd win in a row, each further win adds this to all wins, up to the cap.
  streakStep: 0.03,
  streakCap: 0.15,
  // Lady Luck: after this many losses in a row, wins pay extra for a while.
  pityLosses: 4,
  pityBuff: { luck: 0.25, dur: 75 },
  // Length of a night in casino minutes (1 real second = 1 minute). It always closes at 4:00 AM.
  nightMinutes: 540,
  // Big Tony's quota per night (nights 1-5), then it grows by quotaGrowth each night.
  quotas: [750, 1400, 2300, 3800, 6000],
  quotaGrowth: 1.4,
  // Starting stake: night 1 fixed, later nights this share of the quota.
  firstStake: 600,
  stakeShare: 0.5,
};
