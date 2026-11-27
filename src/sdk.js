// CrazyGames HTML5 SDK v3 wrapper with safe fallbacks for local play.
// Docs: https://docs.crazygames.com/sdk/html5-v3/

const LS_PREFIX = 'gamble_';

class SDKWrapper {
  constructor() {
    this.sdk = null;
    this.ready = false;
    this.environment = 'none';
    this.inGameplay = false;
    this.adPlaying = false;
    this.onAdStart = () => {};
    this.onAdEnd = () => {};
    this.onMuteChange = () => {};
  }

  async init() {
    const CG = window.CrazyGames && window.CrazyGames.SDK;
    if (!CG) { console.info('[Gamble] CrazyGames SDK not present, running standalone.'); return; }
    try {
      await CG.init();
      this.sdk = CG;
      this.ready = true;
      this.environment = CG.environment || 'unknown';
      if (CG.game && CG.game.addSettingsChangeListener) {
        CG.game.addSettingsChangeListener((s) => this.onMuteChange(!!(s && s.muteAudio)));
      }
    } catch (e) {
      console.warn('[Gamble] SDK init failed', e);
      this.sdk = null;
    }
  }

  get muteAudioSetting() { try { return !!(this.sdk && this.sdk.game.settings && this.sdk.game.settings.muteAudio); } catch (e) { return false; } }

  _call(fn) { try { if (this.ready) fn(this.sdk); } catch (e) { console.warn('[Gamble] SDK call failed', e); } }
  loadingStart() { this._call((s) => s.game.loadingStart()); }
  loadingStop() { this._call((s) => s.game.loadingStop()); }
  gameplayStart() { if (this.inGameplay) return; this.inGameplay = true; this._call((s) => s.game.gameplayStart()); }
  gameplayStop() { if (!this.inGameplay) return; this.inGameplay = false; this._call((s) => s.game.gameplayStop()); }
  happytime() { this._call((s) => s.game.happytime()); }

  /** Midgame (interstitial) ad. Always resolves; game is paused + muted while it plays. */
  midgame() {
    return new Promise((resolve) => {
      if (!this.ready || !this.sdk.ad) return resolve(false);
      let done = false;
      const finish = (ok) => { if (done) return; done = true; this.adPlaying = false; this.onAdEnd(); resolve(ok); };
      try {
        this.sdk.ad.requestAd('midgame', {
          adStarted: () => { this.adPlaying = true; this.onAdStart(); },
          adFinished: () => finish(true),
          adError: () => finish(false),
        });
      } catch (e) { finish(false); }
      setTimeout(() => { if (!this.adPlaying) finish(false); }, 8000);
    });
  }

  /** Rewarded ad. Resolves true only when the reward should be granted. */
  rewarded() {
    return new Promise((resolve) => {
      if (!this.ready || !this.sdk.ad) {
        // Standalone / local build: grant the reward so the feature stays testable.
        return resolve(this.environment === 'none');
      }
      let done = false;
      const finish = (ok) => { if (done) return; done = true; this.adPlaying = false; this.onAdEnd(); resolve(ok); };
      try {
        this.sdk.ad.requestAd('rewarded', {
          adStarted: () => { this.adPlaying = true; this.onAdStart(); },
          adFinished: () => finish(true),
          adError: () => finish(false),
        });
      } catch (e) { finish(false); }
    });
  }

  // ---- persistent data ---------------------------------------------------
  // On CrazyGames every save goes through the SDK data module (SDK.data), which
  // stores it for the player and syncs it to their CrazyGames account. Plain
  // localStorage is used only when the game runs outside CrazyGames.
  get cloudData() { return !!(this.ready && this.sdk && this.sdk.data && this.environment !== 'disabled'); }
  getItem(key) {
    if (this.cloudData) {
      try { return this.sdk.data.getItem(LS_PREFIX + key); } catch (e) { console.warn('[Gamble] SDK.data.getItem failed', e); }
    }
    try { return localStorage.getItem(LS_PREFIX + key); } catch (e) { return null; }
  }
  setItem(key, value) {
    if (this.cloudData) {
      try { this.sdk.data.setItem(LS_PREFIX + key, String(value)); return true; } catch (e) { console.warn('[Gamble] SDK.data.setItem failed', e); }
    }
    try { localStorage.setItem(LS_PREFIX + key, String(value)); return true; } catch (e) { return false; }
  }
  removeItem(key) {
    if (this.cloudData) {
      try { this.sdk.data.removeItem(LS_PREFIX + key); return; } catch (e) { console.warn('[Gamble] SDK.data.removeItem failed', e); }
    }
    try { localStorage.removeItem(LS_PREFIX + key); } catch (e) { /* ignore */ }
  }
}

export const SDK = new SDKWrapper();
