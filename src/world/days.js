import { BALANCE } from '../game/balance.js';
// Casino definitions for each night. Station "rot" = yaw; a station's front
// (where the player stands/sits) faces local +Z.
const H = Math.PI / 2;

function row(type, x0, z0, n, dx, dz, rot, variant) {
  const out = [];
  for (let i = 0; i < n; i++) out.push({ type, x: x0 + dx * i, z: z0 + dz * i, rot, variant });
  return out;
}

export const CASINOS = [
  // ------------------------------------------------------------------ 1
  {
    id: 'horseshoe', name: 'The Lucky Horseshoe', tagline: 'A dusty frontier saloon with sticky floors and looser slots.', theme: 'western', seed: 11,
    rooms: [
      { id: 'main', x0: -12, z0: -10, x1: 12, z1: 6, h: 5, main: true },
      { id: 'lobby', x0: -5, z0: 6, x1: 5, z1: 13, h: 4, floor: 'planks' },
      { id: 'bar', x0: 12, z0: -7, x1: 21, z1: 5, h: 4.2, floor: 'planks' },
    ],
    doors: [{ x: 0, z: 6, w: 5 }, { x: 12, z: -1, w: 3, label: 'SALOON', color: '#ffb340' }],
    spawn: { x: 0, z: 10.6, yaw: 0 },
    stations: [
      ...row('slots', -10.9, -9.1, 7, 0.95, 0, 0, 'classic'),
      ...row('slots', -10.2, -3.3, 5, 0.95, 0, 0, 'classic'),
      ...row('slots', -10.2, -4.5, 5, 0.95, 0, Math.PI, 'classic'),
      { type: 'blackjack', x: 1.5, z: -6.2, rot: 0, limits: [5, 500] },
      { type: 'blackjack', x: 7.5, z: -1.2, rot: 0, limits: [10, 1000] },
      { type: 'wheel', x: 7.6, z: -8.9, rot: 0 },
      { type: 'scratch', x: -4.35, z: 9.2, rot: H },
      { type: 'loan', x: 19.4, z: 3.6, rot: -2.4 },
    ],
    decor: [
      { type: 'exit', x: 0, z: 12.65, rot: Math.PI },
      { type: 'atm', x: 4.45, z: 9.2, rot: -H },
      { type: 'bar', x: 19.6, z: -1.2, rot: -H, len: 8 },
      { type: 'lounge', x: 15.2, z: -4.2, rot: 0 },
      { type: 'column', x: -3.5, z: 2.4 }, { type: 'column', x: 3.5, z: 2.4 }, { type: 'column', x: -3.5, z: -2.5 },
      { type: 'cactus', x: -11.2, z: 5.2 }, { type: 'cactus', x: 11.2, z: 5.2 }, { type: 'cactus', x: -4.3, z: 12.2 }, { type: 'cactus', x: 4.3, z: 12.2 },
      { type: 'barrel', x: 13, z: 4.2 }, { type: 'barrel', x: 13.7, z: 4.4 }, { type: 'barrel', x: 13, z: -6.2 }, { type: 'barrel', x: 11.2, z: -9.2 },
      { type: 'jackpot', x: -8, z: -9.72, y: 3.5, w: 4.6 },
      { type: 'marquee', text: 'LUCKY HORSESHOE', x: 0, z: 6.2, y: 3.45, w: 4.4, h: 0.7, color: '#ffd24a', bg: '#5a2008' },
      { type: 'neon', text: 'SLOTS', color: '#ff5a2a', x: -10, z: -9.7, y: 4.1, size: 0.6 },
      { type: 'neon', text: 'BLACKJACK', color: '#2affb0', x: 4.5, z: -9.7, y: 4.1, size: 0.5 },
      { type: 'trash', x: -2.2, z: 5.4 }, { type: 'trash', x: 2.2, z: 5.4 },
      { type: 'rope', pts: [[-2.4, 7.2], [-2.4, 8.8]] }, { type: 'rope', pts: [[2.4, 7.2], [2.4, 8.8]] },
    ],
    npcs: 12,
  },
  // ------------------------------------------------------------------ 2
  {
    id: 'tiki', name: 'Tiki Lagoon', tagline: 'Tropical drinks, roulette under thatch, and an arcade full of coin pushers.', theme: 'tiki', seed: 23,
    rooms: [
      { id: 'main', x0: -14, z0: -12, x1: 14, z1: 6, h: 5.5, main: true },
      { id: 'lobby', x0: -5, z0: 6, x1: 5, z1: 13, h: 4.2, floor: 'planks' },
      { id: 'lounge', x0: -24, z0: -9, x1: -14, z1: 4, h: 4.5 },
      { id: 'arcade', x0: 14, z0: -9, x1: 25, z1: 4, h: 5 },
    ],
    doors: [{ x: 0, z: 6, w: 5 }, { x: -14, z: -2, w: 3, label: 'TIKI BAR', color: '#ff8a3a' }, { x: 14, z: -2, w: 3, label: 'ARCADE', color: '#3affd2' }],
    spawn: { x: 0, z: 10.6, yaw: 0 },
    stations: [
      ...row('slots', -12.6, -11.1, 8, 0.95, 0, 0, 'video'),
      ...row('slots', 5.8, -1.0, 5, 0.95, 0, 0, 'video'),
      ...row('slots', 5.8, -2.2, 5, 0.95, 0, Math.PI, 'video'),
      { type: 'roulette', x: -5.5, z: -6.5, rot: 0, limits: [5, 500] },
      { type: 'blackjack', x: 4.6, z: -7.2, rot: 0, limits: [10, 1000] },
      { type: 'blackjack', x: -6, z: 0.5, rot: 0, limits: [5, 500] },
      { type: 'plinko', x: 19.5, z: -8.1, rot: 0 },
      { type: 'pusher', x: 16.3, z: 3.0, rot: Math.PI },
      { type: 'pusher', x: 18.4, z: 3.0, rot: Math.PI },
      { type: 'wheel', x: 24.0, z: -2.2, rot: -H },
      { type: 'scratch', x: -4.35, z: 9.2, rot: H },
      { type: 'loan', x: -22.8, z: -7.6, rot: 0.8 },
    ],
    decor: [
      { type: 'exit', x: 0, z: 12.65, rot: Math.PI },
      { type: 'atm', x: 4.45, z: 9.2, rot: -H },
      { type: 'bar', x: -22.6, z: -1.6, rot: H, len: 8 },
      { type: 'lounge', x: -17.6, z: 1.6, rot: H },
      { type: 'aquarium', x: -9.5, z: 5.35, rot: Math.PI, w: 5, h: 2.2 },
      { type: 'aquarium', x: 9.5, z: 5.35, rot: Math.PI, w: 5, h: 2.2 },
      { type: 'column', x: -2.5, z: -2.5 }, { type: 'column', x: 2.5, z: -2.5 },
      { type: 'palm', x: -13.2, z: 5.2, h: 2.6 }, { type: 'palm', x: 13.2, z: 5.2, h: 2.6 }, { type: 'palm', x: -13.2, z: -3.5 }, { type: 'palm', x: 13.2, z: -11.2 },
      { type: 'palm', x: -4.2, z: 12.2 }, { type: 'palm', x: 4.2, z: 12.2 }, { type: 'monstera', x: 24.3, z: 3.3 }, { type: 'monstera', x: -23.3, z: 3.3 },
      { type: 'torch', x: -1.8, z: 7.0 }, { type: 'torch', x: 1.8, z: 7.0 }, { type: 'torch', x: -15, z: 3.2 }, { type: 'torch', x: -15, z: -8.2 }, { type: 'torch', x: 15, z: -8.2 }, { type: 'torch', x: 15, z: 3.2 },
      { type: 'tiki', x: -13.3, z: 0.5 }, { type: 'tiki', x: 13.3, z: 0.5 }, { type: 'tiki', x: -13.3, z: -4.5 }, { type: 'tiki', x: 13.3, z: -4.5 },
      { type: 'jackpot', x: -9, z: -11.72, y: 3.8, w: 5 },
      { type: 'marquee', text: 'TIKI LAGOON', x: 0, z: 6.2, y: 3.6, w: 4, h: 0.7, color: '#ffe36a', bg: '#0a4a3a' },
      { type: 'neon', text: 'ROULETTE', color: '#ff4fa0', x: -5.5, z: -11.7, y: 4.3, size: 0.55 },
      { type: 'trash', x: -2.3, z: 5.4 }, { type: 'trash', x: 2.3, z: 5.4 },
    ],
    npcs: 15,
  },
  // ------------------------------------------------------------------ 3
  {
    id: 'palace', name: 'The Grand Velvet Palace', tagline: 'Crystal chandeliers, craps tables and a velvet-roped high-limit room.', theme: 'palace', seed: 37,
    rooms: [
      { id: 'lobby', x0: -7, z0: 8, x1: 7, z1: 19, h: 5, floor: 'tiles' },
      { id: 'main', x0: -16, z0: -12, x1: 16, z1: 8, h: 7, main: true },
      { id: 'high', x0: -6, z0: -22, x1: 6, z1: -12, h: 5, carpet: { style: 'royal', pal: { base: '#2a0a2a', a: '#e8c25a', b: '#6a1a6a', c: '#3a0a3a', d: '#ffe9a8' } } },
      { id: 'lounge', x0: -26, z0: -7, x1: -16, z1: 5, h: 5 },
      { id: 'poker', x0: 16, z0: -7, x1: 26, z1: 5, h: 5, carpet: { style: 'deco', pal: { base: '#0b1a2a', a: '#d8b24a', b: '#14304a', c: '#0f2a3e', d: '#f6e3a0' } } },
    ],
    doors: [{ x: 0, z: 8, w: 6, h: 3.8 }, { x: 0, z: -12, w: 3, label: 'HIGH LIMIT', color: '#ffd24a' }, { x: -16, z: -1, w: 3, label: 'LOUNGE', color: '#ff4fa0' }, { x: 16, z: -1, w: 3, label: 'POKER ROOM', color: '#4fc0ff' }],
    spawn: { x: 0, z: 17.0, yaw: 0 },
    stations: [
      ...row('slots', -15.1, -10.5, 7, 0, 0.95, H, 'video'),
      ...row('slots', 15.1, -10.5, 7, 0, 0.95, -H, 'classic'),
      { type: 'craps', x: -6.5, z: -6.5, rot: 0 },
      { type: 'roulette', x: 6, z: -7.2, rot: 0, limits: [10, 1000] },
      { type: 'blackjack', x: -6.5, z: 2, rot: 0, limits: [10, 1000] },
      { type: 'blackjack', x: 6.5, z: 2, rot: 0, limits: [25, 2500] },
      { type: 'wheel', x: 11.5, z: -11.1, rot: 0 },
      { type: 'baccarat', x: 21, z: -3.5, rot: 0 },
      ...row('videopoker', 18.4, 4.2, 4, 1.0, 0, Math.PI),
      { type: 'blackjack', x: -2.8, z: -18.2, rot: 0, limits: [100, 10000], high: true },
      { type: 'roulette', x: 2.8, z: -18.2, rot: 0, limits: [50, 5000], high: true },
      { type: 'scratch', x: 6.35, z: 14.6, rot: -H },
      { type: 'loan', x: -24.5, z: -5.5, rot: 0.8 },
    ],
    decor: [
      { type: 'exit', x: 0, z: 18.65, rot: Math.PI },
      { type: 'fountain', x: 0, z: 12.2 },
      { type: 'cashier', x: -6.35, z: 13, rot: H, w: 4 },
      { type: 'atm', x: 6.45, z: 11, rot: -H },
      { type: 'bar', x: -24.6, z: -0.8, rot: H, len: 8 },
      { type: 'lounge', x: -19.5, z: -4.2, rot: H }, { type: 'lounge', x: -19.5, z: 2.6, rot: H },
      { type: 'column', x: -11, z: -2 }, { type: 'column', x: 11, z: -2 }, { type: 'column', x: -11, z: 5.5 }, { type: 'column', x: 11, z: 5.5 }, { type: 'column', x: -2.6, z: 6.4 }, { type: 'column', x: 2.6, z: 6.4 },
      { type: 'statue', x: 0, z: -2.2 },
      { type: 'palm', x: -6.2, z: 9, h: 2.8 }, { type: 'palm', x: 6.2, z: 9, h: 2.8 }, { type: 'palm', x: -15.2, z: 7.2 }, { type: 'palm', x: 15.2, z: 7.2 },
      { type: 'palm', x: -5.2, z: -21.2 }, { type: 'palm', x: 5.2, z: -21.2 }, { type: 'monstera', x: 25.2, z: -6.2 }, { type: 'monstera', x: -25.3, z: 4.3 },
      { type: 'rope', pts: [[-1.6, -11.3], [-3.6, -10.6]] }, { type: 'rope', pts: [[1.6, -11.3], [3.6, -10.6]] },
      { type: 'jackpot', x: 0, z: -11.75, y: 4.6, w: 6, h: 1.3 },
      { type: 'marquee', text: 'GRAND VELVET PALACE', x: 0, z: 8.2, y: 4.45, w: 6, h: 0.8, color: '#ffe08a', bg: '#5a0a14' },
      { type: 'neon', text: 'CRAPS', color: '#ff4f4f', x: -6.5, z: -11.7, y: 5.2, size: 0.7 },
      { type: 'neon', text: 'ROULETTE', color: '#ffd24a', x: 6, z: -11.7, y: 5.2, size: 0.6 },
      { type: 'trash', x: -3, z: 7.4 }, { type: 'trash', x: 3, z: 7.4 },
    ],
    npcs: 20,
  },
  // ------------------------------------------------------------------ 4
  {
    id: 'nebula', name: 'Neon Nebula', tagline: 'A retro-future space casino: rockets, mines, sic bo and rockets that crash.', theme: 'neon', seed: 51,
    rooms: [
      { id: 'main', x0: -14, z0: -12, x1: 14, z1: 6, h: 6, main: true },
      { id: 'lobby', x0: -5, z0: 6, x1: 5, z1: 13, h: 4.5 },
      { id: 'arcade', x0: 14, z0: -10, x1: 26, z1: 4, h: 5.5 },
      { id: 'lounge', x0: -24, z0: -8, x1: -14, z1: 4, h: 4.5 },
    ],
    doors: [{ x: 0, z: 6, w: 5 }, { x: 14, z: -3, w: 3, label: 'ARCADE', color: '#2bf0ff' }, { x: -14, z: -2, w: 3, label: 'SPACE BAR', color: '#ff2bd6' }],
    spawn: { x: 0, z: 10.6, yaw: 0 },
    stations: [
      { type: 'crash', x: 0, z: -10.9, rot: 0 },
      { type: 'roulette', x: -7.5, z: -5.5, rot: 0, limits: [10, 1000] },
      { type: 'blackjack', x: 7.5, z: -5.5, rot: 0, limits: [10, 1000] },
      ...row('slots', -10.6, 1.4, 5, 0.95, 0, 0, 'video'),
      ...row('slots', -10.6, 0.2, 5, 0.95, 0, Math.PI, 'video'),
      ...row('slots', 6.6, 1.4, 5, 0.95, 0, 0, 'classic'),
      ...row('slots', 6.6, 0.2, 5, 0.95, 0, Math.PI, 'classic'),
      { type: 'mines', x: 15.6, z: -9.2, rot: 0 }, { type: 'mines', x: 16.7, z: -9.2, rot: 0 },
      { type: 'plinko', x: 21.5, z: -9.1, rot: 0 },
      { type: 'pusher', x: 25.0, z: -4.5, rot: -H },
      ...row('videopoker', 16.2, 3.2, 3, 1.0, 0, Math.PI),
      { type: 'sicbo', x: -19, z: -5.2, rot: 0 },
      { type: 'scratch', x: -4.35, z: 9.2, rot: H },
      { type: 'loan', x: -23, z: 2.9, rot: 2.3 },
    ],
    decor: [
      { type: 'exit', x: 0, z: 12.65, rot: Math.PI },
      { type: 'atm', x: 4.45, z: 9.2, rot: -H },
      { type: 'bar', x: -22.6, z: -1.2, rot: H, len: 7 },
      { type: 'lounge', x: -17.4, z: 1.4, rot: H },
      { type: 'rocket', x: -3.3, z: 11.8 },
      { type: 'column', x: -3, z: -3 }, { type: 'column', x: 3, z: -3 }, { type: 'column', x: -12.5, z: 4.5 }, { type: 'column', x: 12.5, z: 4.5 },
      { type: 'planet', x: -6, z: -3, y: 4.6, r: 0.9, color: 0xff7a2a }, { type: 'planet', x: 6, z: -8, y: 4.8, r: 0.6, color: 0x2ad1ff, ring: false }, { type: 'planet', x: 20, z: -3, y: 4.2, r: 0.7, color: 0xb04aff },
      { type: 'jackpot', x: -8, z: 5.75, y: 3.8, w: 4.6, rot: Math.PI },
      { type: 'marquee', text: 'NEON NEBULA', x: 0, z: 6.2, y: 3.85, w: 4, h: 0.7, color: '#2bf0ff', bg: '#120430' },
      { type: 'neon', text: 'TO THE MOON', color: '#fff23b', x: 0, z: -11.7, y: 4.9, size: 0.6 },
      { type: 'neon', text: 'GAME OVER?', color: '#ff2bd6', x: 20, z: -9.7, y: 4.2, size: 0.5 },
      { type: 'monstera', x: -13.3, z: 5.3 }, { type: 'monstera', x: 13.3, z: 5.3 },
      { type: 'trash', x: -2.3, z: 5.4 }, { type: 'trash', x: 2.3, z: 5.4 },
    ],
    npcs: 16,
  },
  // ------------------------------------------------------------------ 5
  {
    id: 'fortuna', name: 'Château Fortuna', tagline: 'Old-money Riviera glamour: horse derby, baccarat salon and everything else.', theme: 'monaco', seed: 77,
    rooms: [
      { id: 'lobby', x0: -7, z0: 9, x1: 7, z1: 19, h: 5, floor: 'tiles' },
      { id: 'main', x0: -18, z0: -13, x1: 18, z1: 9, h: 7.5, main: true },
      { id: 'derby', x0: -8, z0: -25, x1: 8, z1: -13, h: 6, carpet: { style: 'royal', pal: { base: '#0b2a22', a: '#d8b24a', b: '#14453a', c: '#0a3a2e', d: '#f6e3a0' } } },
      { id: 'salon', x0: 18, z0: -8, x1: 28, z1: 6, h: 5 },
      { id: 'bar', x0: -28, z0: -8, x1: -18, z1: 6, h: 5 },
    ],
    doors: [{ x: 0, z: 9, w: 6, h: 3.8 }, { x: 0, z: -13, w: 4, label: 'THE DERBY', color: '#ffd24a' }, { x: 18, z: -1, w: 3, label: 'SALON PRIVÉ', color: '#4fc0ff' }, { x: -18, z: -1, w: 3, label: 'LE BAR', color: '#ff4fa0' }],
    spawn: { x: 0, z: 17, yaw: 0 },
    stations: [
      ...row('slots', -17.1, -11.5, 8, 0, 0.95, H, 'video'),
      ...row('slots', 17.1, -11.5, 8, 0, 0.95, -H, 'classic'),
      { type: 'craps', x: -8.5, z: -8, rot: 0 },
      { type: 'roulette', x: 8.5, z: -8.3, rot: 0, limits: [25, 2500] },
      { type: 'blackjack', x: -8.5, z: 1.5, rot: 0, limits: [25, 2500] },
      { type: 'blackjack', x: 8.5, z: 1.5, rot: 0, limits: [50, 5000] },
      { type: 'wheel', x: -12, z: -12.1, rot: 0 },
      { type: 'plinko', x: 12.5, z: -12.1, rot: 0 },
      { type: 'derby', x: 0, z: -19.5, rot: 0 },
      { type: 'baccarat', x: 23, z: -4.3, rot: 0 },
      ...row('videopoker', 20.4, 5.2, 3, 1.0, 0, Math.PI),
      { type: 'crash', x: 27.1, z: 0.5, rot: -H },
      { type: 'sicbo', x: -22.5, z: -5.2, rot: 0 },
      { type: 'mines', x: -21, z: 5.2, rot: Math.PI }, { type: 'mines', x: -19.9, z: 5.2, rot: Math.PI },
      { type: 'pusher', x: 4.5, z: 8.0, rot: Math.PI }, { type: 'pusher', x: -4.5, z: 8.0, rot: Math.PI },
      { type: 'scratch', x: 6.35, z: 14.6, rot: -H },
      { type: 'loan', x: -26.6, z: 4.6, rot: 2.3 },
    ],
    decor: [
      { type: 'exit', x: 0, z: 18.65, rot: Math.PI },
      { type: 'fountain', x: 0, z: 13 },
      { type: 'cashier', x: -6.35, z: 13.5, rot: H, w: 4 },
      { type: 'atm', x: 6.45, z: 11.2, rot: -H },
      { type: 'bar', x: -26.6, z: -1.5, rot: H, len: 8 },
      { type: 'lounge', x: -21.5, z: 1.5, rot: H },
      { type: 'column', x: -13, z: -3 }, { type: 'column', x: 13, z: -3 }, { type: 'column', x: -13, z: 6 }, { type: 'column', x: 13, z: 6 }, { type: 'column', x: -3.2, z: 7.4 }, { type: 'column', x: 3.2, z: 7.4 },
      { type: 'statue', x: 0, z: -3 },
      { type: 'palm', x: -6.2, z: 10, h: 2.8 }, { type: 'palm', x: 6.2, z: 10, h: 2.8 }, { type: 'palm', x: -17.2, z: 8.2 }, { type: 'palm', x: 17.2, z: 8.2 },
      { type: 'palm', x: -7.2, z: -24.2 }, { type: 'palm', x: 7.2, z: -24.2 }, { type: 'monstera', x: 27.2, z: -7.2 }, { type: 'monstera', x: -27.2, z: 5.3 },
      { type: 'jackpot', x: 0, z: -12.75, y: 4.7, w: 6, h: 1.3 },
      { type: 'marquee', text: 'CHÂTEAU FORTUNA', x: 0, z: 9.2, y: 4.45, w: 5.5, h: 0.8, color: '#f6e3a0', bg: '#0b2a22' },
      { type: 'neon', text: 'CRAPS', color: '#ff4f4f', x: -8.5, z: -12.7, y: 5.2, size: 0.7 },
      { type: 'neon', text: 'ROULETTE', color: '#ffd24a', x: 8.5, z: -12.7, y: 5.2, size: 0.6 },
      { type: 'trash', x: -3, z: 8.4 }, { type: 'trash', x: 3, z: 8.4 },
    ],
    npcs: 22,
  },
];

/** Night modifiers for endless mode (day 6+). */
export const MODIFIERS = [
  { id: 'happyhour', name: 'Happy Hour', desc: 'Drinks are free and slot wins pay +25%.', slotsMult: 1.25, freeDrinks: true },
  { id: 'fullmoon', name: 'Full Moon', desc: 'Roulette straight-up wins pay 40 to 1.', rouletteStraight: 40 },
  { id: 'highroller', name: 'High Roller Night', desc: 'Table limits are doubled. So is the quota pressure.', limitMult: 2 },
  { id: 'luckystars', name: 'Lucky Stars', desc: 'Scratch cards have double the jackpot chance.', scratchLuck: 2 },
  { id: 'rushhour', name: 'Rush Hour', desc: 'Packed house! Extra patrons, extra chaos.', extraNpcs: 6 },
  { id: 'goldrush', name: 'Gold Rush', desc: 'Dropped chips are worth 3x.', pickupMult: 3 },
];

export function quotaFor(day) {
  const base = BALANCE.quotas;
  if (day <= base.length) return base[day - 1];
  return Math.round((base[base.length - 1] * Math.pow(BALANCE.quotaGrowth, day - base.length)) / 500) * 500;
}
export function stakeFor(day) { return day === 1 ? BALANCE.firstStake : Math.round((quotaFor(day) * BALANCE.stakeShare) / 50) * 50; }
export function casinoFor(day) { return CASINOS[(day - 1) % CASINOS.length]; }
