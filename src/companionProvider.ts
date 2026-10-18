import * as vscode from 'vscode';
import { CompanionState } from './types';
import { POKEDEX_ROSTER, POKEMON_SPRITE_COORDS, getEvolutionTarget } from './pokedexData';

export class CompanionViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'commitmon.companionView';
  public static readonly explorerViewType = 'commitmon.explorerView';
  public static readonly panelViewType = 'commitmon.bottomPanel';
  private _view?: vscode.WebviewView;
  private readonly _webviews = new Set<vscode.Webview>();
  private _arenaPanel?: vscode.WebviewPanel;
  private readonly _onDidChangeState = new vscode.EventEmitter<void>();
  public readonly onDidChangeState = this._onDidChangeState.event;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _context: vscode.ExtensionContext
  ) { }

  private _registerWebview(view: vscode.WebviewView | vscode.WebviewPanel) {
    this._webviews.add(view.webview);
    view.onDidDispose(() => {
      this._webviews.delete(view.webview);
    });
  }

  public _broadcast(payload: any) {
    for (const webview of this._webviews) {
      try {
        webview.postMessage(payload);
      } catch (err) {
        console.error('CommitMon: Error broadcasting to webview', err);
      }
    }
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;
    this._registerWebview(webviewView);

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this._extensionUri, 'media')]
    };

    const isBottomPanel = webviewView.viewType === CompanionViewProvider.panelViewType;
    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview, isBottomPanel ? 'bottomPanel' : 'sidebar', this.getState());

    webviewView.webview.onDidReceiveMessage(async (data) => {
      await this._handleMessage(data);
    });

    // Initial state push once view is ready
    setTimeout(() => this.syncState(), 200);
  }

  public openArena() {
    if (this._arenaPanel) {
      this._arenaPanel.reveal(vscode.ViewColumn.Active);
      this.syncState();
      return;
    }

    this._arenaPanel = vscode.window.createWebviewPanel(
      'commitmon.arena',
      'CommitMon: Anti-Gravity Arena',
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(this._extensionUri, 'media')]
      }
    );

    this._registerWebview(this._arenaPanel);

    this._arenaPanel.iconPath = vscode.Uri.joinPath(this._extensionUri, 'media', 'icon.svg');
    this._arenaPanel.webview.html = this._getHtmlForWebview(this._arenaPanel.webview, 'arena', this.getState());

    this._arenaPanel.webview.onDidReceiveMessage(async (data) => {
      await this._handleMessage(data);
    });

    this._arenaPanel.onDidDispose(() => {
      this._arenaPanel = undefined;
    });

    setTimeout(() => this.syncState(), 200);
  }

  private async _handleMessage(data: any) {
    switch (data.type) {
      case 'INIT_STATE': {
        this.syncState();
        break;
      }
      case 'SELECT_POKEMON': {
        await this.selectPokemon(data.pokemonId);
        break;
      }
      case 'TOGGLE_SLEEP': {
        await this.toggleSleep();
        break;
      }
      case 'TOGGLE_ANTI_GRAVITY': {
        await this.toggleAntiGravity();
        break;
      }
      case 'TOGGLE_FLY_MODE': {
        await this.toggleFlyMode();
        break;
      }
      case 'TOGGLE_SOUND': {
        const state = this.getState();
        state.soundEnabled = data.enabled !== undefined ? data.enabled : !state.soundEnabled;
        await this.saveState(state);
        break;
      }
      case 'FEED_TREAT': {
        await this.feedBerry(data.treatType || 'oran');
        break;
      }
      case 'SIMULATE_COMMIT': {
        await this.onCommitDetected('sim-' + Math.random().toString(36).substring(2, 7));
        break;
      }
      case 'SIMULATE_PUSH': {
        await this.onPushDetected();
        break;
      }
      case 'RESET_PROGRESS': {
        await this.resetProgress();
        break;
      }
      case 'OPEN_ARENA': {
        this.openArena();
        break;
      }
      case 'UPDATE_WALKING_PARTY': {
        const state = this.getState();
        state.walkingParty = data.party;
        await this.saveState(state);
        this.syncState();
        break;
      }
      case 'ADD_TO_WALKING_PARTY': {
        const state = this.getState();
        if (!state.walkingParty) state.walkingParty = [];
        if (state.walkingParty.length < 6 && data.pokemonSlug) {
          state.walkingParty.push(data.pokemonSlug);
          await this.saveState(state);
          this.syncState();
        }
        break;
      }
      case 'RESET_WALKING_PARTY': {
        const state = this.getState();
        state.walkingParty = [state.activePokemonSlug];
        await this.saveState(state);
        this.syncState();
        break;
      }
    }
  }

  public getState(): CompanionState {
    const saved = this._context.globalState.get<CompanionState>('commitmon.gameState');
    if (saved) {
      // Ensure defaults for new fields
      if (saved.antiGravity === undefined) saved.antiGravity = false;
      if (saved.happiness === undefined) saved.happiness = 0;
      if (saved.soundEnabled === undefined) saved.soundEnabled = true;
      if (saved.variant === undefined) saved.variant = 'normal';

      if (!saved.activePokemonSlug) {
        saved.activePokemonSlug = saved.isEggHatched ? (saved.activePokemonId || 'pikachu') : 'egg';
      }
      if (!saved.activePokemonId) {
        saved.activePokemonId = saved.activePokemonSlug;
      }
      if (!saved.activePokemonName) {
        const found = POKEDEX_ROSTER.find((p) => p.slug === saved.activePokemonSlug || p.id === saved.activePokemonId);
        saved.activePokemonName = found ? found.name : (saved.isEggHatched ? 'Pikachu' : 'Mystery Egg');
      }

      const currentSpecies = POKEDEX_ROSTER.find((p) => p.id === saved.activePokemonId || p.slug === saved.activePokemonSlug);
      saved.hasWings = !!currentSpecies?.hasWings;
      if (!saved.hasWings) {
        saved.flyMode = false;
      } else if (saved.flyMode === undefined) {
        saved.flyMode = false;
      }

      if (!saved.walkingParty || saved.walkingParty.length === 0) {
        if (saved.isEggHatched && saved.activePokemonSlug) {
          saved.walkingParty = [saved.activePokemonSlug];
        } else {
          saved.walkingParty = [];
        }
      } else if (saved.isEggHatched && saved.activePokemonSlug && !saved.walkingParty.includes(saved.activePokemonSlug)) {
        saved.walkingParty = [saved.activePokemonSlug];
      }

      return saved;
    }

    const defaultState: CompanionState = {
      totalCommits: 0,
      todayCommits: 0,
      activePokemonId: 'egg',
      activePokemonName: 'Mystery Egg',
      activePokemonSlug: 'egg',
      level: 1,
      exp: 0,
      expToNextLevel: 100,
      isEggHatched: false,
      eggProgress: 0,
      eggRequiredCommits: 2,
      unlockedIds: [],
      walkingParty: [],
      soundEnabled: true,
      isSleeping: false,
      antiGravity: false,
      flyMode: false,
      hasWings: false,
      happiness: 0,
      variant: 'normal'
    };

    this._context.globalState.update('commitmon.gameState', defaultState);
    return defaultState;
  }

  public async setActivePokemon(slugOrId: string) {
    const state = this.getState();
    const species = POKEDEX_ROSTER.find((p) => p.slug === slugOrId || p.id === slugOrId);
    if (species) {
      state.activePokemonId = species.id;
      state.activePokemonName = species.name;
      state.activePokemonSlug = species.slug;
      state.activePokemonColor = species.color;
      state.walkingParty = [species.slug];
      state.hasWings = !!species.hasWings;
      state.flyMode = !!species.hasWings;
      state.isSleeping = false;
    } else {
      state.activePokemonSlug = slugOrId;
      state.activePokemonId = slugOrId;
      state.activePokemonName = slugOrId.charAt(0).toUpperCase() + slugOrId.slice(1);
      state.walkingParty = [slugOrId];
      state.isSleeping = false;
    }
    await this.saveState(state);
  }

  public async saveState(state: CompanionState) {
    await this._context.globalState.update('commitmon.gameState', state);
    this.syncState();
  }

  public syncState() {
    const state = this.getState();
    const payload = {
      type: 'STATE_UPDATE',
      state,
      roster: POKEDEX_ROSTER,
      coords: POKEMON_SPRITE_COORDS
    };

    this._broadcast(payload);
    this._onDidChangeState.fire();
  }

  public async onCommitDetected(commitHash: string, commitMessage?: string) {
    const state = this.getState();
    state.totalCommits += 1;
    state.todayCommits += 1;
    state.lastCommitHash = commitHash;
    state.lastCommitMessage = commitMessage || 'Committed code';
    state.isSleeping = false;

    let leveledUp = false;
    let hatched = false;
    let evolved = false;
    let evolvedFrom = '';
    let evolvedTo = '';
    let newUnlocks: string[] = [];

    // 1. Egg hatching logic
    if (!state.isEggHatched) {
      state.eggProgress += 1;
      if (state.eggProgress >= state.eggRequiredCommits) {
        state.isEggHatched = true;
        hatched = true;
        const starter = POKEDEX_ROSTER[0]; // Pikachu
        state.activePokemonId = starter.id;
        state.activePokemonName = starter.name;
        state.activePokemonSlug = starter.slug;
        state.walkingParty = [starter.slug];
        state.level = 5;
        state.exp = 0;
        state.expToNextLevel = 100;
        if (!state.unlockedIds.includes(starter.id)) {
          state.unlockedIds.push(starter.id);
          newUnlocks.push(starter.name);
        }
      }
    } else {
      // 2. EXP & Leveling
      const earnedExp = 50;
      state.exp += earnedExp;
      while (state.exp >= state.expToNextLevel) {
        state.exp -= state.expToNextLevel;
        state.level += 1;
        state.expToNextLevel = Math.floor(state.expToNextLevel * 1.25);
        leveledUp = true;
      }

      // 3. Evolution Check based on game levels
      const evo = getEvolutionTarget(state.activePokemonSlug, state.level, state.variant);
      if (evo) {
        evolved = true;
        evolvedFrom = state.activePokemonName;
        evolvedTo = evo.name;
        const oldSlug = state.activePokemonSlug;
        state.activePokemonSlug = evo.slug;
        state.activePokemonName = evo.name;
        state.activePokemonId = evo.slug;
        state.walkingParty = [evo.slug];
        const evoSpecies = POKEDEX_ROSTER.find((p) => p.id === evo.slug);
        state.hasWings = !!evoSpecies?.hasWings;
        if (state.hasWings) {
          state.flyMode = true; // Automatically take to the sky upon gaining wings!
        }
        if (!state.unlockedIds.includes(evo.slug)) {
          state.unlockedIds.push(evo.slug);
          newUnlocks.push(evo.name);
        }
      }
    }

    // 4. Milestone Unlocks ("Catch 'Em All")
    for (const species of POKEDEX_ROSTER) {
      if (state.totalCommits >= species.milestoneCommits && !state.unlockedIds.includes(species.id)) {
        state.unlockedIds.push(species.id);
        newUnlocks.push(species.name);
      }
    }

    await this.saveState(state);

    const postPayload = {
      type: 'CELEBRATE_COMMIT',
      state,
      hatched,
      leveledUp,
      evolved,
      evolvedFrom,
      evolvedTo,
      newUnlocks,
      commitHash
    };

    this._broadcast(postPayload);
  }

  public async onPushDetected() {
    const state = this.getState();
    state.isSleeping = false;
    state.exp += 80;

    let leveledUp = false;
    let evolved = false;
    let evolvedFrom = '';
    let evolvedTo = '';
    let hatched = false;

    if (!state.isEggHatched) {
      state.eggProgress += 1;
      if (state.eggProgress >= state.eggRequiredCommits) {
        state.isEggHatched = true;
        hatched = true;
        const starter = POKEDEX_ROSTER[0]; // Pikachu
        state.activePokemonId = starter.id;
        state.activePokemonName = starter.name;
        state.activePokemonSlug = starter.slug;
        state.walkingParty = [starter.slug];
        state.level = 5;
        state.exp = 0;
        state.expToNextLevel = 100;
        if (!state.unlockedIds.includes(starter.id)) {
          state.unlockedIds.push(starter.id);
        }
      }
    } else {
      while (state.exp >= state.expToNextLevel) {
        state.exp -= state.expToNextLevel;
        state.level += 1;
        state.expToNextLevel = Math.floor(state.expToNextLevel * 1.25);
        leveledUp = true;
      }

      const evo = getEvolutionTarget(state.activePokemonSlug, state.level, state.variant);
      if (evo) {
        evolved = true;
        evolvedFrom = state.activePokemonName;
        evolvedTo = evo.name;
        const oldSlug = state.activePokemonSlug;
        state.activePokemonSlug = evo.slug;
        state.activePokemonName = evo.name;
        state.activePokemonId = evo.slug;
        state.walkingParty = [evo.slug];
        const evoSpecies = POKEDEX_ROSTER.find((p) => p.id === evo.slug);
        state.hasWings = !!evoSpecies?.hasWings;
        if (state.hasWings) {
          state.flyMode = true;
        }
        if (!state.unlockedIds.includes(evo.slug)) {
          state.unlockedIds.push(evo.slug);
        }
      }
    }

    await this.saveState(state);

    const postPayload = {
      type: 'CELEBRATE_PUSH',
      state,
      hatched,
      leveledUp,
      evolved,
      evolvedFrom,
      evolvedTo
    };

    this._broadcast(postPayload);
  }

  /**
   * Easter Egg Feature: Feeding treats grants EXP, can incubate the egg,
   * and triggers evolution based on evolution level like in the Pokémon game!
   */
  public async feedBerry(treatType: string = 'oran') {
    const state = this.getState();
    state.isSleeping = false;

    // EASTER EGG 1: Feeding the Mystery Egg incubates it!
    if (!state.isEggHatched) {
      state.eggProgress += 1;
      let hatched = false;

      if (state.eggProgress >= state.eggRequiredCommits) {
        state.isEggHatched = true;
        hatched = true;
        const starter = POKEDEX_ROSTER[0]; // Pikachu
        state.activePokemonId = starter.id;
        state.activePokemonName = starter.name;
        state.activePokemonSlug = starter.slug;
        state.walkingParty = [starter.slug];
        state.level = 5;
        state.exp = 0;
        state.expToNextLevel = 100;
        if (!state.unlockedIds.includes(starter.id)) {
          state.unlockedIds.push(starter.id);
        }
        vscode.window.showInformationMessage('🐣 Easter Egg: Your warm berries incubated the egg and it hatched into Pikachu! 🎉');
      } else {
        vscode.window.showInformationMessage(
          `🥚 Easter Egg: You fed and warmed the Mystery Egg! Incubation: ${state.eggProgress}/${state.eggRequiredCommits} commits!`
        );
      }

      await this.saveState(state);

      const payload = {
        type: 'BERRY_FED',
        state,
        treatType,
        isEgg: true,
        hatched,
        leveledUp: false,
        evolved: false
      };
      this._broadcast(payload);
      return;
    }

    // Feeding Hatched Pokémon:
    let expGain = 20;
    if (treatType === 'sitrus') {
      expGain = 45;
      state.happiness += 10;
    } else if (treatType === 'candy') {
      // Rare Candy: Instant level-up!
      expGain = state.expToNextLevel - state.exp;
      state.happiness += 25;
    } else {
      // Oran Berry
      expGain = 20;
      state.happiness += 5;
    }

    state.exp += expGain;
    let leveledUp = false;

    while (state.exp >= state.expToNextLevel) {
      state.exp -= state.expToNextLevel;
      state.level += 1;
      state.expToNextLevel = Math.floor(state.expToNextLevel * 1.25);
      leveledUp = true;
    }

    // Determine variant preference if Eevee
    if (state.activePokemonSlug === 'eevee') {
      if (treatType === 'oran') state.variant = 'water';
      else if (treatType === 'sitrus') state.variant = 'electric';
      else if (treatType === 'candy') state.variant = 'psychic';
    }

    // EASTER EGG 2: Check for authentic game evolution levels!
    let evolved = false;
    let evolvedFrom = '';
    let evolvedTo = '';

    const evo = getEvolutionTarget(state.activePokemonSlug, state.level, state.variant);
    if (evo) {
      evolved = true;
      evolvedFrom = state.activePokemonName;
      evolvedTo = evo.name;
      const oldSlug = state.activePokemonSlug;
      state.activePokemonSlug = evo.slug;
      state.activePokemonName = evo.name;
      state.activePokemonId = evo.slug;
      state.walkingParty = [evo.slug];
      const evoSpecies = POKEDEX_ROSTER.find((p) => p.id === evo.slug);
      state.hasWings = !!evoSpecies?.hasWings;
      if (state.hasWings) {
        state.flyMode = true;
      }
      if (!state.unlockedIds.includes(evo.slug)) {
        state.unlockedIds.push(evo.slug);
      }
      vscode.window.showInformationMessage(`🌟 Pokémon Evolution! ${evolvedFrom} evolved into ${evolvedTo}! 🌟`);
    }

    await this.saveState(state);

    const payload = {
      type: 'BERRY_FED',
      state,
      treatType,
      isEgg: false,
      leveledUp,
      evolved,
      evolvedFrom,
      evolvedTo
    };

    this._broadcast(payload);
  }

  public async toggleAntiGravity() {
    const state = this.getState();
    state.antiGravity = !state.antiGravity;
    await this.saveState(state);
    vscode.window.showInformationMessage(
      `CommitMon: Anti-Gravity Sideways Roam ${state.antiGravity ? 'ENABLED 🚀' : 'DISABLED 🌍'}`
    );
  }

  public async toggleFlyMode() {
    const state = this.getState();
    const species = POKEDEX_ROSTER.find((p) => p.id === state.activePokemonId);
    if (!species?.hasWings) {
      vscode.window.showWarningMessage(
        `CommitMon: ${species ? species.name : 'This Pokémon'} does not have wings to fly! Only Pokémon with wings (like Charizard 🪽) can fly.`
      );
      return;
    }
    state.flyMode = !state.flyMode;
    await this.saveState(state);
    vscode.window.showInformationMessage(
      `CommitMon: ${species.name} is now ${state.flyMode ? 'soaring through the mountain skies! 🪽☁️' : 'gliding down to walk on the snowy path! 🐾'}`
    );
  }

  public async toggleSleep() {
    const state = this.getState();
    state.isSleeping = !state.isSleeping;
    await this.saveState(state);
  }

  public async selectPokemon(pokemonId: string) {
    const state = this.getState();
    const species = POKEDEX_ROSTER.find((p) => p.id === pokemonId || p.slug === pokemonId);
    if (!species) return;

    if (!state.unlockedIds.includes(species.id)) {
      vscode.window.showWarningMessage(
        `CommitMon: ${species.name} unlocks at ${species.milestoneCommits} total commits! You have ${state.totalCommits}.`
      );
      return;
    }

    await this.setActivePokemon(species.slug);
    vscode.window.showInformationMessage(`CommitMon: You chose ${species.name} as your companion!`);
  }

  public async resetProgress() {
    const choice = await vscode.window.showWarningMessage(
      'CommitMon: Reset all companion progress and start back at the Egg?',
      { modal: true },
      'Reset',
      'Cancel'
    );
    if (choice === 'Reset') {
      await this._context.globalState.update('commitmon.gameState', undefined);
      this.syncState();
      vscode.window.showInformationMessage('CommitMon: Progress reset to Mystery Egg.');
    }
  }

  private _getHtmlForWebview(webview: vscode.Webview, viewKind: 'sidebar' | 'bottomPanel' | 'arena', initialState?: CompanionState): string {
    const isArena = viewKind === 'arena';
    const isBottomPanel = viewKind === 'bottomPanel';
    const state = initialState || this.getState();
    const mediaUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media'));
    const bgUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'bg_snowy_mountain.jpg'));
    const spritePngUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'pokesprite.png'));
    const spritesBaseUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'sprites', 'pokemons'));

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CommitMon Companion</title>
  <style>
    :root {
      --gba-dark: #0f172a;
      --gba-panel: #1e293b;
      --gba-accent: #38bdf8;
      --gba-border: #334155;
      --gba-gold: #f59e0b;
      --gba-green: #10b981;
      --text-main: #f8fafc;
      --text-muted: #94a3b8;
    }

    * {
      box-sizing: border-box;
      user-select: none;
    }

    body {
      margin: 0;
      padding: 0;
      background-color: var(--gba-dark);
      color: var(--text-main);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 12px;
      overflow-x: hidden;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }

    /* GBA Viewport Container */
    .viewport-card {
      position: relative;
      width: 100%;
      height: ${isBottomPanel ? 'calc(100vh - 36px)' : isArena ? 'calc(100vh - 170px)' : '240px'};
      min-height: ${isBottomPanel ? '130px' : '220px'};
      background: #090d16;
      overflow: hidden;
      border-bottom: ${isBottomPanel ? 'none' : '2px solid var(--gba-border)'};
    }

    body.bottom-panel-mode:not(.show-controls) .controls-deck {
      display: none !important;
    }
    body.bottom-panel-mode.show-controls .viewport-card {
      height: 240px !important;
      min-height: 200px !important;
    }
    body.bottom-panel-mode .viewport-hud {
      display: flex;
    }

    /* Top Bar in Bottom Panel (matching VS Code Pokémon) */
    .panel-top-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      height: 36px;
      padding: 0 12px;
      background: #0f172a;
      border-bottom: 1px solid rgba(56, 189, 248, 0.2);
      z-index: 20;
    }

    .panel-brand {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .panel-title {
      font-weight: 700;
      letter-spacing: 0.05em;
      color: #38bdf8;
      font-size: 11px;
      text-transform: uppercase;
    }

    .panel-badge {
      font-size: 10px;
      padding: 2px 7px;
      border-radius: 10px;
      background: rgba(56, 189, 248, 0.15);
      color: #bae6fd;
      border: 1px solid rgba(56, 189, 248, 0.3);
    }

    .panel-actions {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .panel-btn {
      background: rgba(30, 41, 59, 0.85);
      border: 1px solid rgba(148, 163, 184, 0.25);
      color: #e2e8f0;
      width: 26px;
      height: 26px;
      border-radius: 4px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 13px;
      transition: all 0.2s ease;
    }

    .panel-btn:hover {
      background: rgba(56, 189, 248, 0.25);
      border-color: #38bdf8;
      color: #ffffff;
      transform: scale(1.08);
    }

    /* Modal Backdrop */
    .party-modal-backdrop {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(10, 15, 29, 0.85);
      backdrop-filter: blur(4px);
      z-index: 50;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
    }

    .party-modal-card {
      background: #1e293b;
      border: 2px solid #38bdf8;
      border-radius: 8px;
      width: 90%;
      max-width: 460px;
      max-height: 85%;
      display: flex;
      flex-direction: column;
      box-shadow: 0 10px 25px rgba(0, 0, 0, 0.6);
      overflow: hidden;
    }

    .party-modal-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 14px;
      background: rgba(15, 23, 42, 0.8);
      border-bottom: 1px solid #334155;
      font-weight: 600;
      color: #38bdf8;
      font-size: 12px;
    }

    .party-modal-close {
      background: none;
      border: none;
      color: #94a3b8;
      cursor: pointer;
      font-size: 14px;
    }

    .party-modal-close:hover {
      color: #ffffff;
    }

    .party-modal-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(72px, 1fr));
      gap: 8px;
      padding: 12px;
      overflow-y: auto;
      max-height: 280px;
    }

    .party-picker-item {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 8px 4px;
      background: rgba(15, 23, 42, 0.6);
      border: 1px solid rgba(51, 65, 85, 0.8);
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.2s ease;
    }

    .party-picker-item:hover {
      background: rgba(56, 189, 248, 0.2);
      border-color: #38bdf8;
      transform: translateY(-2px);
    }

    .party-picker-thumb {
      width: 32px;
      height: 32px;
      image-rendering: pixelated;
    }

    .party-picker-name {
      font-size: 9px;
      color: #e2e8f0;
      margin-top: 4px;
      text-align: center;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      width: 100%;
    }

    /* Walker items on stage */
    .walker-wrapper {
      position: absolute;
      cursor: grab;
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 4;
      user-select: none;
    }

    .walker-wrapper:active {
      cursor: grabbing;
    }

    .walker-sprite {
      image-rendering: pixelated;
      transform: scale(2.0);
      transform-origin: center bottom;
      background-repeat: no-repeat;
    }

    .walker-shadow {
      position: absolute;
      height: 7px;
      background: radial-gradient(ellipse at center, rgba(15, 23, 42, 0.72) 0%, rgba(15, 23, 42, 0.35) 60%, transparent 85%);
      border-radius: 50%;
      pointer-events: none;
      z-index: 3;
    }

    #bgCanvas {
      position: absolute;
      top: 0;
      left: 0;
      z-index: 0;
      image-rendering: pixelated;
      transition: filter 0.5s ease;
    }

    .anti-gravity-active #bgCanvas {
      filter: hue-rotate(180deg) saturate(1.4);
    }

    /* Anti-gravity grid lines overlay */
    .ag-grid {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      opacity: 0;
      background: radial-gradient(circle, rgba(56, 189, 248, 0.15) 1px, transparent 1px);
      background-size: 24px 24px;
      transition: opacity 0.4s ease;
      z-index: 1;
    }

    .anti-gravity-active .ag-grid {
      opacity: 1;
    }

    /* Twinkling Stars in Mountain Night Sky */
    .stars-layer {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 48%;
      pointer-events: none;
      z-index: 1;
      overflow: hidden;
    }

    .star-twinkle {
      position: absolute;
      background: #ffffff;
      border-radius: 50%;
      box-shadow: 0 0 3px #ffffff, 0 0 7px #7dd3fc;
      animation: starTwinkle 2.5s infinite ease-in-out;
    }

    @keyframes starTwinkle {
      0%, 100% { opacity: 0.15; transform: scale(0.7); }
      50% { opacity: 1; transform: scale(1.35); }
    }

    /* Moon Radiance Breathing Glow */
    .moon-glow {
      position: absolute;
      top: 24px;
      right: 78px;
      width: 52px;
      height: 52px;
      border-radius: 50%;
      background: radial-gradient(circle, rgba(224, 242, 254, 0.45) 0%, rgba(186, 230, 253, 0.15) 50%, transparent 75%);
      pointer-events: none;
      z-index: 1;
      animation: moonPulse 4.5s infinite alternate ease-in-out;
    }

    @keyframes moonPulse {
      0% { opacity: 0.4; transform: scale(0.85); }
      100% { opacity: 0.95; transform: scale(1.25); }
    }

    /* Ethereal Aurora Borealis Waves in Night Sky */
    .sky-aurora {
      position: absolute;
      top: 0;
      left: -20%;
      width: 140%;
      height: 38%;
      background: linear-gradient(135deg, transparent 20%, rgba(56, 189, 248, 0.08) 40%, rgba(52, 211, 153, 0.09) 60%, transparent 80%);
      pointer-events: none;
      filter: blur(12px);
      z-index: 1;
      animation: auroraWave 10s infinite alternate ease-in-out;
    }

    @keyframes auroraWave {
      0% { transform: translateX(-4%) translateY(0) skewX(-4deg); opacity: 0.35; }
      100% { transform: translateX(4%) translateY(5px) skewX(4deg); opacity: 0.85; }
    }

    /* Drifting Snowy Fog along mountain base */
    .mist-layer {
      position: absolute;
      bottom: 24px;
      left: 0;
      width: 100%;
      height: 38px;
      background: linear-gradient(180deg, transparent 0%, rgba(241, 245, 249, 0.07) 50%, rgba(241, 245, 249, 0.14) 100%);
      pointer-events: none;
      z-index: 2;
      animation: mistDrift 7.5s infinite alternate ease-in-out;
    }

    @keyframes mistDrift {
      0% { opacity: 0.3; transform: translateX(-6px); }
      100% { opacity: 0.75; transform: translateX(6px); }
    }

    #snowCanvas {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 2;
    }

    /* Pet Arena & Stage */
    .pet-stage {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      z-index: 3;
    }

    /* Pet Movement Container */
    #petWrapper {
      position: absolute;
      width: 48px;
      height: 48px;
      cursor: grab;
      display: flex;
      align-items: center;
      justify-content: center;
      transform-origin: center center;
      z-index: 4;
      transition: filter 0.2s ease;
    }

    #petWrapper:active {
      cursor: grabbing;
    }

    /* Ground Snow Shadow beneath Pokemon */
    #petShadow {
      position: absolute;
      bottom: -2px;
      left: 50%;
      width: 34px;
      height: 8px;
      margin-left: -17px;
      background: radial-gradient(ellipse at center, rgba(15, 23, 42, 0.65) 0%, rgba(15, 23, 42, 0) 75%);
      border-radius: 50%;
      pointer-events: none;
      z-index: -1;
      transform-origin: center center;
      transition: transform 0.08s ease-out, opacity 0.08s ease-out;
    }


    /* Tiny snow puff particles when walking */
    .snow-step-puff {
      position: absolute;
      width: 4px;
      height: 4px;
      background: #ffffff;
      border-radius: 50%;
      pointer-events: none;
      z-index: 3;
      box-shadow: 0 0 3px rgba(255,255,255,0.9);
      animation: snowStepDisperse 0.45s forwards ease-out;
    }

    @keyframes snowStepDisperse {
      0% { opacity: 0.95; transform: translate(0, 0) scale(1); }
      100% { opacity: 0; transform: translate(var(--dx, 2px), var(--dy, -6px)) scale(0.3); }
    }

    /* Wind trail curls during flight */
    .wind-trail-curl {
      position: absolute;
      width: 14px;
      height: 3px;
      background: linear-gradient(90deg, rgba(255,255,255,0.85), transparent);
      border-radius: 2px;
      pointer-events: none;
      z-index: 3;
      filter: blur(0.5px);
      animation: windCurlAnim 0.5s forwards ease-out;
    }

    @keyframes windCurlAnim {
      0% { opacity: 0.8; transform: translate(0, 0) scaleX(1); }
      100% { opacity: 0; transform: translate(var(--wdx, -12px), var(--wdy, 4px)) scaleX(1.8); }
    }

    .btn-action.disabled-mode {
      opacity: 0.55;
      filter: grayscale(0.6);
      border-style: dashed;
      cursor: not-allowed !important;
    }

    /* Pokemon animated sprite element (32x32 multi-frame pixel art) */
    #petSprite {
      display: block;
      width: 32px;
      height: 32px;
      image-rendering: pixelated;
      transform-origin: center bottom;
      transform: scale(2.2);
      background-repeat: no-repeat;
      transition: filter 0.2s ease;
    }

    /* Dedicated Pixel Art Mystery Egg Component */
    .pokemon-egg-container {
      width: 40px;
      height: 44px;
      display: flex;
      align-items: center;
      justify-content: center;
      transform: scale(1.6);
      transform-origin: center bottom;
    }

    .pokemon-egg-svg {
      width: 100%;
      height: 100%;
      overflow: visible;
      filter: drop-shadow(0 2px 4px rgba(0,0,0,0.4));
    }

    /* Egg Animations */
    .egg-wobble .pokemon-egg-container {
      animation: eggShake 1.8s infinite ease-in-out;
    }

    .egg-cracking .pokemon-egg-container {
      animation: eggTremble 0.35s infinite ease-in-out;
    }

    @keyframes eggShake {
      0%, 100% { transform: scale(1.6) rotate(0deg); }
      15% { transform: scale(1.6) rotate(-14deg); }
      30% { transform: scale(1.6) rotate(14deg); }
      45% { transform: scale(1.6) rotate(-8deg); }
      60% { transform: scale(1.6) rotate(8deg); }
      75% { transform: scale(1.6) rotate(0deg); }
    }

    @keyframes eggTremble {
      0%, 100% { transform: scale(1.65) translate(0, 0); }
      25% { transform: scale(1.65) translate(-2px, 1px) rotate(-3deg); }
      75% { transform: scale(1.65) translate(2px, -1px) rotate(3deg); }
    }

    /* Sleeping Rest */
    .sleeping #petSprite, .sleeping .pokemon-egg-container {
      filter: brightness(0.85);
    }
    .sleeping #petShadow {
      transform: scale(0.9, 0.9);
      opacity: 0.38;
    }

    /* Zero-G Star Particle */
    .particle {
      position: absolute;
      pointer-events: none;
      z-index: 5;
      font-size: 14px;
      animation: particleFloat 1.2s forwards ease-out;
    }

    @keyframes particleFloat {
      0% { opacity: 0; transform: translate(0, 0) scale(0.5); }
      20% { opacity: 1; transform: translate(0, -6px) scale(1.2); }
      100% { opacity: 0; transform: translate(var(--tx, 0), var(--ty, -30px)) scale(0.6); }
    }

    /* Pokémon Skill Move Banners & Floating Emotes */
    .skill-banner {
      position: absolute;
      bottom: 60px;
      left: 50%;
      transform: translateX(-50%) scale(0.6);
      padding: 4px 11px;
      border-radius: 12px;
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 0.6px;
      text-transform: uppercase;
      white-space: nowrap;
      pointer-events: none;
      z-index: 25;
      display: flex;
      align-items: center;
      gap: 5px;
      box-shadow: 0 4px 14px rgba(0,0,0,0.6);
      animation: skillBannerPop 1.15s cubic-bezier(0.18, 0.89, 0.32, 1.28) forwards;
    }

    @keyframes skillBannerPop {
      0% { opacity: 0; transform: translateX(-50%) translateY(8px) scale(0.6); }
      18% { opacity: 1; transform: translateX(-50%) translateY(-2px) scale(1.1); }
      32% { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); }
      80% { opacity: 1; transform: translateX(-50%) translateY(-4px) scale(1); }
      100% { opacity: 0; transform: translateX(-50%) translateY(-18px) scale(0.85); }
    }

    .skill-electric {
      background: linear-gradient(135deg, #eab308, #ca8a04);
      color: #0f172a;
      border: 1.5px solid #fef08a;
      box-shadow: 0 0 16px rgba(234, 179, 8, 0.7);
    }
    .skill-fire {
      background: linear-gradient(135deg, #ef4444, #b91c1c);
      color: #ffffff;
      border: 1.5px solid #fecaca;
      box-shadow: 0 0 16px rgba(239, 68, 68, 0.7);
    }
    .skill-water {
      background: linear-gradient(135deg, #0284c7, #0369a1);
      color: #ffffff;
      border: 1.5px solid #bae6fd;
      box-shadow: 0 0 16px rgba(2, 132, 199, 0.7);
    }
    .skill-grass {
      background: linear-gradient(135deg, #16a34a, #15803d);
      color: #ffffff;
      border: 1.5px solid #bbf7d0;
      box-shadow: 0 0 16px rgba(22, 163, 74, 0.7);
    }
    .skill-psychic {
      background: linear-gradient(135deg, #c026d3, #9333ea);
      color: #ffffff;
      border: 1.5px solid #f5d0fe;
      box-shadow: 0 0 16px rgba(192, 38, 211, 0.7);
    }
    .skill-dark {
      background: linear-gradient(135deg, #475569, #1e293b);
      color: #f1f5f9;
      border: 1.5px solid #cbd5e1;
      box-shadow: 0 0 16px rgba(15, 23, 42, 0.8);
    }
    .skill-ghost {
      background: linear-gradient(135deg, #7c3aed, #4c1d95);
      color: #ffffff;
      border: 1.5px solid #ddd6fe;
      box-shadow: 0 0 16px rgba(124, 58, 237, 0.75);
    }
    .skill-fighting {
      background: linear-gradient(135deg, #ea580c, #c2410c);
      color: #ffffff;
      border: 1.5px solid #fed7aa;
      box-shadow: 0 0 16px rgba(234, 88, 12, 0.7);
    }
    .skill-normal, .skill-fairy {
      background: linear-gradient(135deg, #ec4899, #d946ef);
      color: #ffffff;
      border: 1.5px solid #fbcfe8;
      box-shadow: 0 0 16px rgba(236, 72, 153, 0.7);
    }
    .skill-dragon {
      background: linear-gradient(135deg, #6366f1, #4338ca);
      color: #ffffff;
      border: 1.5px solid #c7d2fe;
      box-shadow: 0 0 16px rgba(99, 102, 241, 0.75);
    }

    /* Pokémon Speech Bubble */
    .pokemon-speech-bubble {
      position: absolute;
      bottom: 54px;
      left: 50%;
      transform: translateX(-50%);
      background: #0f172a;
      color: #f8fafc;
      font-size: 11px;
      font-weight: 700;
      padding: 3px 8px;
      border-radius: 8px;
      border: 1.5px solid var(--gba-border);
      box-shadow: 0 2px 10px rgba(0,0,0,0.55);
      white-space: nowrap;
      pointer-events: none;
      z-index: 26;
      animation: speechBubblePop 1.25s forwards ease-out;
    }

    .pokemon-speech-bubble::after {
      content: '';
      position: absolute;
      bottom: -6px;
      left: 50%;
      margin-left: -5px;
      border-width: 6px 5px 0;
      border-style: solid;
      border-color: #0f172a transparent transparent;
      display: block;
      width: 0;
    }

    @keyframes speechBubblePop {
      0% { opacity: 0; transform: translateX(-50%) scale(0.7); }
      15% { opacity: 1; transform: translateX(-50%) scale(1.05); }
      30% { transform: translateX(-50%) scale(1); }
      80% { opacity: 1; }
      100% { opacity: 0; transform: translateX(-50%) translateY(-8px) scale(0.9); }
    }

    /* Skill Visual FX */
    .skill-fx-lightning {
      position: absolute;
      pointer-events: none;
      z-index: 10;
      filter: drop-shadow(0 0 6px #facc15) drop-shadow(0 0 12px #38bdf8);
      animation: lightningFlicker 0.45s forwards linear;
    }

    @keyframes lightningFlicker {
      0% { opacity: 0; transform: scale(0.8); }
      20% { opacity: 1; transform: scale(1.1); }
      40% { opacity: 0.3; }
      60% { opacity: 1; transform: scale(1); }
      80% { opacity: 0.6; }
      100% { opacity: 0; transform: scale(0.9); }
    }

    .skill-fx-flame {
      position: absolute;
      pointer-events: none;
      z-index: 10;
      border-radius: 50%;
      background: radial-gradient(circle, #fef08a 0%, #f97316 45%, #ef4444 80%, transparent 100%);
      filter: blur(1px);
      box-shadow: 0 0 12px #ef4444;
      animation: flameSurge 0.6s forwards ease-out;
    }

    @keyframes flameSurge {
      0% { opacity: 0.95; transform: translate(0, 0) scale(0.4); }
      100% { opacity: 0; transform: translate(var(--fx-dx, 40px), var(--fx-dy, -15px)) scale(2.2); }
    }

    .skill-fx-bubble {
      position: absolute;
      pointer-events: none;
      z-index: 10;
      border-radius: 50%;
      background: radial-gradient(circle at 30% 30%, rgba(255,255,255,0.95), rgba(56,189,248,0.7) 60%, rgba(2,132,199,0.9) 100%);
      box-shadow: 0 0 8px rgba(56,189,248,0.8);
      animation: bubblePopAnim 0.7s forwards ease-out;
    }

    @keyframes bubblePopAnim {
      0% { opacity: 0; transform: scale(0.3) translate(0, 0); }
      30% { opacity: 1; transform: scale(1.1) translate(var(--bx, 0), -12px); }
      100% { opacity: 0; transform: scale(1.4) translate(var(--bx, 0), -34px); }
    }

    .skill-fx-leaf {
      position: absolute;
      pointer-events: none;
      z-index: 10;
      font-size: 16px;
      animation: leafWhirl 0.75s forwards ease-out;
      filter: drop-shadow(0 0 4px #4ade80);
    }

    @keyframes leafWhirl {
      0% { opacity: 0; transform: translate(0, 0) rotate(0deg) scale(0.5); }
      20% { opacity: 1; transform: translate(var(--lx, 15px), -10px) rotate(180deg) scale(1.2); }
      100% { opacity: 0; transform: translate(var(--lx2, 45px), var(--ly2, -35px)) rotate(540deg) scale(0.6); }
    }

    .skill-fx-star {
      position: absolute;
      pointer-events: none;
      z-index: 10;
      font-size: 15px;
      animation: starBurst 0.65s forwards ease-out;
      filter: drop-shadow(0 0 6px #fde047);
    }

    @keyframes starBurst {
      0% { opacity: 1; transform: translate(0, 0) rotate(0deg) scale(0.6); }
      100% { opacity: 0; transform: translate(var(--sx, 30px), var(--sy, -30px)) rotate(360deg) scale(1.3); }
    }

    .skill-fx-ring {
      position: absolute;
      pointer-events: none;
      z-index: 10;
      border-radius: 50%;
      border: 2px solid var(--ring-color, #c084fc);
      box-shadow: 0 0 10px var(--ring-color, #c084fc);
      animation: ringExpand 0.7s forwards ease-out;
    }

    @keyframes ringExpand {
      0% { width: 10px; height: 10px; opacity: 1; transform: translate(-50%, -50%) scale(0.5); }
      100% { width: 80px; height: 80px; opacity: 0; transform: translate(-50%, -50%) scale(1.8); }
    }

    /* Subtle stage impact shake */
    .stage-impact-shake {
      animation: impactShakeAnim 0.22s ease-in-out;
    }

    @keyframes impactShakeAnim {
      0%, 100% { transform: translate(0, 0); }
      20% { transform: translate(-2.5px, 1.5px); }
      40% { transform: translate(2.5px, -1.5px); }
      60% { transform: translate(-1.5px, 0.5px); }
      80% { transform: translate(1px, -0.5px); }
    }

    /* Click Hop Wobble for Egg */
    .egg-click-hop .pokemon-egg-container {
      animation: eggClickHopAnim 0.65s ease-out;
    }

    @keyframes eggClickHopAnim {
      0% { transform: scale(1.6) translateY(0); }
      35% { transform: scale(1.75, 1.45) translateY(-14px) rotate(8deg); }
      60% { transform: scale(1.5, 1.7) translateY(-4px) rotate(-6deg); }
      80% { transform: scale(1.65, 1.55) translateY(0); }
      100% { transform: scale(1.6) translateY(0); }
    }

    /* Evolution Flash Overlay */
    #evolutionOverlay {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: radial-gradient(circle, rgba(255,255,255,0.95) 0%, rgba(56,189,248,0.85) 100%);
      z-index: 50;
      opacity: 0;
      pointer-events: none;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      transition: opacity 0.5s ease;
    }

    #evolutionOverlay.active {
      opacity: 1;
      pointer-events: auto;
    }

    .evo-text {
      font-size: 16px;
      font-weight: 800;
      color: #0f172a;
      text-transform: uppercase;
      letter-spacing: 1px;
      margin-top: 12px;
      animation: evoPulse 0.5s infinite alternate;
    }

    @keyframes evoPulse {
      0% { transform: scale(0.95); }
      100% { transform: scale(1.05); }
    }

    /* Status HUD Bar Overlay on Viewport */
    .viewport-hud {
      position: absolute;
      top: 8px;
      left: 8px;
      right: 8px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      z-index: 10;
      pointer-events: none;
    }

    .hud-badge {
      background: rgba(15, 23, 42, 0.85);
      backdrop-filter: blur(6px);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 6px;
      padding: 3px 8px;
      font-size: 11px;
      font-weight: 600;
      color: #fff;
      display: flex;
      align-items: center;
      gap: 6px;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.4);
    }

    .level-tag {
      background: #3b82f6;
      color: white;
      padding: 1px 5px;
      border-radius: 4px;
      font-size: 10px;
      font-weight: 700;
    }

    .ag-indicator {
      display: none;
      background: #ec4899;
      color: white;
      padding: 1px 6px;
      border-radius: 4px;
      font-size: 10px;
      font-weight: 800;
    }

    .anti-gravity-active .ag-indicator {
      display: inline-block;
      animation: blink 1s infinite alternate;
    }

    @keyframes blink {
      0% { opacity: 0.7; }
      100% { opacity: 1; }
    }

    /* Announcement Banner */
    #bannerOverlay {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%) scale(0.8);
      background: rgba(15, 23, 42, 0.95);
      border: 2px solid var(--gba-gold);
      border-radius: 8px;
      padding: 10px 16px;
      text-align: center;
      z-index: 20;
      opacity: 0;
      pointer-events: none;
      transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.6);
      max-width: 85%;
    }

    #bannerOverlay.show {
      opacity: 1;
      transform: translate(-50%, -50%) scale(1);
    }

    .banner-title {
      font-size: 13px;
      font-weight: 800;
      color: var(--gba-gold);
      margin-bottom: 2px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .banner-sub {
      font-size: 11px;
      color: var(--text-main);
    }

    /* Lower Controls & Stats Deck */
    .controls-deck {
      padding: 10px;
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 8px;
      overflow-y: auto;
    }

    /* EXP Progress Bar */
    .exp-container {
      background: var(--gba-panel);
      border: 1px solid var(--gba-border);
      border-radius: 6px;
      padding: 8px 10px;
      margin-bottom: 2px;
    }

    .exp-header {
      display: flex;
      justify-content: space-between;
      font-size: 11px;
      margin-bottom: 4px;
      color: var(--text-muted);
    }

    .exp-bar-bg {
      width: 100%;
      height: 8px;
      background: #0f172a;
      border-radius: 4px;
      overflow: hidden;
      border: 1px solid #334155;
    }

    .exp-bar-fill {
      height: 100%;
      width: 0%;
      background: linear-gradient(90deg, #10b981, #38bdf8);
      transition: width 0.4s ease-out;
    }

    /* Treat & Easter Egg Feeding Bar - Fully Responsive */
    .treat-bar {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 6px;
      width: 100%;
    }

    .btn-treat {
      min-width: 0;
      background: linear-gradient(180deg, #1e293b 0%, #0f172a 100%);
      border: 1px solid #334155;
      color: var(--text-main);
      padding: 7px 4px;
      border-radius: 6px;
      font-size: 11px;
      font-weight: 700;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      position: relative;
      overflow: hidden;
      transition: all 0.15s cubic-bezier(0.4, 0, 0.2, 1);
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
      user-select: none;
      -webkit-user-select: none;
      outline: none;
    }

    .btn-treat:hover {
      background: linear-gradient(180deg, #334155 0%, #1e293b 100%);
      border-color: var(--gba-accent);
      transform: translateY(-1px);
      box-shadow: 0 3px 8px rgba(56, 189, 248, 0.25);
    }

    .btn-treat:active, .btn-treat.btn-pressed {
      transform: translateY(1px) scale(0.96);
      filter: brightness(1.15);
      box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.4);
    }

    .btn-treat.oran {
      border-color: rgba(56, 189, 248, 0.4);
    }
    .btn-treat.oran:hover {
      border-color: #38bdf8;
      box-shadow: 0 0 10px rgba(56, 189, 248, 0.35);
    }

    .btn-treat.sitrus {
      border-color: rgba(244, 63, 94, 0.4);
    }
    .btn-treat.sitrus:hover {
      border-color: #f43f5e;
      box-shadow: 0 0 10px rgba(244, 63, 94, 0.35);
    }

    .btn-treat.candy {
      background: linear-gradient(135deg, #6366f1 0%, #a855f7 100%);
      border-color: #c084fc;
      color: #ffffff;
      text-shadow: 0 1px 2px rgba(0,0,0,0.5);
    }
    .btn-treat.candy:hover {
      background: linear-gradient(135deg, #4f46e5 0%, #9333ea 100%);
      border-color: #e9d5ff;
      box-shadow: 0 0 12px rgba(168, 85, 247, 0.45);
    }

    .treat-icon {
      font-size: 13px;
      flex-shrink: 0;
    }
    .treat-label {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .treat-bonus {
      font-size: 9px;
      font-weight: 800;
      opacity: 0.85;
      background: rgba(0, 0, 0, 0.3);
      padding: 1px 4px;
      border-radius: 4px;
      flex-shrink: 0;
    }

    /* Action Buttons Grid - Auto-fit responsive layout */
    .action-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(115px, 1fr));
      gap: 6px;
      width: 100%;
    }

    .btn-action {
      min-width: 0;
      background: linear-gradient(180deg, #1e293b 0%, #151e2e 100%);
      color: var(--text-main);
      border: 1px solid #334155;
      border-radius: 6px;
      padding: 7px 8px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      position: relative;
      overflow: hidden;
      transition: all 0.15s cubic-bezier(0.4, 0, 0.2, 1);
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
      user-select: none;
      -webkit-user-select: none;
      outline: none;
    }

    button, .btn-action, .btn-treat, .btn-tool, .dex-slot {
      pointer-events: auto !important;
      cursor: pointer !important;
    }
    button *, .btn-action *, .btn-treat *, .btn-tool * {
      pointer-events: none;
    }

    .btn-action:hover {
      background: linear-gradient(180deg, #334155 0%, #1e293b 100%);
      border-color: #475569;
      transform: translateY(-1px);
      box-shadow: 0 3px 6px rgba(0, 0, 0, 0.4);
    }

    .btn-action:active, .btn-action.btn-pressed {
      transform: translateY(1px) scale(0.96);
      filter: brightness(1.2);
      box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.4);
    }

    .btn-action.active-mode {
      background: linear-gradient(180deg, #0284c7 0%, #0369a1 100%);
      border-color: #38bdf8;
      box-shadow: 0 0 10px rgba(56, 189, 248, 0.4);
      color: #ffffff;
    }

    .btn-action .btn-icon, .btn-treat .treat-icon, .btn-tool .btn-icon {
      font-size: 13px;
      width: 14px;
      height: 14px;
      flex-shrink: 0;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }

    /* ItsHover Motion-First Icons Engine (https://www.itshover.com/icons) */
    .itshover-svg {
      width: 14px;
      height: 14px;
      stroke: currentColor;
      fill: none;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
      display: inline-block;
      vertical-align: middle;
      overflow: visible;
      transition: transform 0.25s cubic-bezier(0.33, 1, 0.68, 1);
    }

    /* 1. Rocket Icon (ItsHover rocket-icon) */
    .rocket-upper {
      transition: transform 0.35s cubic-bezier(0.33, 1, 0.68, 1);
      transform-origin: center;
    }
    .rocket-flame {
      transition: transform 0.25s ease-out, opacity 0.25s ease-out;
      transform-origin: 4px 28px;
    }
    .btn-action:hover .rocket-upper {
      transform: translate(2.5px, -2.5px);
    }
    .btn-action:hover .rocket-flame {
      animation: itshoverFlamePulse 0.38s infinite alternate ease-in-out;
    }
    @keyframes itshoverFlamePulse {
      0% { transform: scale(0.85) translate(0, 0); opacity: 0.6; }
      100% { transform: scale(1.3) translate(-1px, 1px); opacity: 1; }
    }

    /* 2. Airplane Icon (ItsHover airplane-icon) */
    .itshover-airplane .airplane {
      transition: transform 0.25s ease;
      transform-origin: center;
    }
    .itshover-airplane .wind1, .itshover-airplane .wind2 {
      opacity: 0;
      transition: opacity 0.2s ease, transform 0.4s ease;
    }
    .btn-action:hover .itshover-airplane .airplane {
      animation: itshoverPlaneHover 0.45s infinite alternate ease-in-out;
    }
    .btn-action:hover .itshover-airplane .wind1 {
      animation: itshoverWindGlide 0.55s infinite ease-out;
    }
    .btn-action:hover .itshover-airplane .wind2 {
      animation: itshoverWindGlide 0.55s 0.18s infinite ease-out;
    }
    @keyframes itshoverPlaneHover {
      0% { transform: translate(0, 0) rotate(0deg); }
      50% { transform: translate(1px, -1px) rotate(-3deg); }
      100% { transform: translate(0, -2px) rotate(2deg); }
    }
    @keyframes itshoverWindGlide {
      0% { opacity: 0; transform: translate(6px, -6px); }
      50% { opacity: 0.9; }
      100% { opacity: 0; transform: translate(-6px, 6px); }
    }

    /* 3. Paw Print Icon (ItsHover paw-print-icon) */
    .itshover-paw .paw-inner {
      transform-origin: center;
      transition: transform 0.25s cubic-bezier(0.33, 1, 0.68, 1);
    }
    .btn-action:hover .itshover-paw .paw-inner {
      animation: itshoverPawStamp 0.42s ease-in-out;
    }
    @keyframes itshoverPawStamp {
      0% { transform: scale(1); }
      35% { transform: scale(0.75) translateY(1.5px); }
      70% { transform: scale(1.18) translateY(-1px); }
      100% { transform: scale(1); }
    }

    /* 4. Moon Icon (ItsHover moon-icon) */
    .itshover-moon .moon {
      transform-origin: center;
      transition: transform 0.4s cubic-bezier(0.33, 1, 0.68, 1);
    }
    .btn-action:hover .itshover-moon .moon {
      transform: rotate(-20deg) scale(1.12);
    }

    /* 5. Sun Icon (ItsHover brightness-down-icon) */
    .itshover-sun .sun-center {
      transform-origin: center;
      transition: transform 0.3s ease;
    }
    .itshover-sun .sun-rays {
      transform-origin: center;
      transition: transform 0.5s cubic-bezier(0.33, 1, 0.68, 1);
    }
    .btn-action:hover .itshover-sun .sun-center {
      transform: scale(0.82);
    }
    .btn-action:hover .itshover-sun .sun-rays {
      transform: rotate(45deg);
    }

    /* 6. Expand Icon (ItsHover expand-icon) */
    .itshover-expand .arrows-tl, .itshover-expand .corners.arrows-tl,
    .itshover-expand .arrows-tr, .itshover-expand .corners.arrows-tr,
    .itshover-expand .arrows-bl, .itshover-expand .corners.arrows-bl,
    .itshover-expand .arrows-br, .itshover-expand .corners.arrows-br {
      transition: transform 0.25s cubic-bezier(0.33, 1, 0.68, 1);
    }
    .btn-action:hover .itshover-expand .arrows-tl {
      transform: translate(-2px, -2px);
    }
    .btn-action:hover .itshover-expand .arrows-tr {
      transform: translate(2px, -2px);
    }
    .btn-action:hover .itshover-expand .arrows-bl {
      transform: translate(-2px, 2px);
    }
    .btn-action:hover .itshover-expand .arrows-br {
      transform: translate(2px, 2px);
    }

    /* 7. Terminal Icon (ItsHover terminal-icon) */
    .itshover-terminal .terminal-chevron {
      transition: transform 0.25s ease;
    }
    .itshover-terminal .cursor-line {
      transition: opacity 0.2s ease;
    }
    .btn-action:hover .itshover-terminal .terminal-chevron {
      transform: translateX(2.5px);
    }
    .btn-action:hover .itshover-terminal .cursor-line {
      animation: itshoverCursorBlink 0.6s infinite ease-in-out;
    }
    @keyframes itshoverCursorBlink {
      0%, 100% { opacity: 1; }
      50% { opacity: 0; }
    }

    /* 8. Flame Icon (ItsHover flame-icon) */
    .itshover-flame .flame-group {
      transform-origin: 50% 100%;
      transition: transform 0.2s ease;
    }
    .btn-action:hover .itshover-flame .flame-group {
      animation: itshoverFlameDance 0.55s infinite alternate ease-in-out;
    }
    @keyframes itshoverFlameDance {
      0% { transform: scale(1) rotate(0deg) translateY(0); }
      33% { transform: scale(1.12, 1.15) rotate(4deg) translateY(-2px); }
      66% { transform: scale(0.94, 1.08) rotate(-3deg) translateY(-1px); }
      100% { transform: scale(1.1, 1.2) rotate(2deg) translateY(-2px); }
    }

    /* 9. Treats Animations (ItsHover sparkles-icon, heart-icon, berry) */
    .itshover-sparkle .sparkle-main {
      transform-origin: 9px 12px;
      transition: transform 0.5s cubic-bezier(0.33, 1, 0.68, 1);
    }
    .itshover-sparkle .sparkle-top {
      transform-origin: 18px 6px;
      transition: transform 0.5s cubic-bezier(0.33, 1, 0.68, 1);
    }
    .itshover-sparkle .sparkle-bottom {
      transform-origin: 18px 18px;
      transition: transform 0.5s cubic-bezier(0.33, 1, 0.68, 1);
    }
    .btn-treat:hover .itshover-sparkle .sparkle-main {
      transform: rotate(180deg) scale(1.22);
    }
    .btn-treat:hover .itshover-sparkle .sparkle-top {
      transform: rotate(-90deg) scale(1.3);
    }
    .btn-treat:hover .itshover-sparkle .sparkle-bottom {
      transform: rotate(90deg) scale(0.75);
    }

    .itshover-sitrus .heart {
      transform-origin: 50% 50%;
      transition: transform 0.25s ease;
    }
    .btn-treat:hover .itshover-sitrus .heart {
      animation: itshoverHeartPulse 0.45s infinite alternate ease-in-out;
    }
    @keyframes itshoverHeartPulse {
      0% { transform: scale(1); }
      50% { transform: scale(1.25); }
      100% { transform: scale(1.1); }
    }

    .itshover-oran .berry-body {
      transform-origin: center;
      transition: transform 0.25s ease;
    }
    .itshover-oran .berry-leaf {
      transform-origin: 12px 7px;
      transition: transform 0.25s ease;
    }
    .btn-treat:hover .itshover-oran .berry-body {
      animation: itshoverBerryBob 0.38s infinite alternate ease-in-out;
    }
    .btn-treat:hover .itshover-oran .berry-leaf {
      transform: rotate(16deg);
    }
    @keyframes itshoverBerryBob {
      0% { transform: translateY(0) scale(1); }
      100% { transform: translateY(-2px) scale(1.12); }
    }

    /* 10. Volume Animations (ItsHover volume-2-icon & volume-x-icon) */
    .itshover-volume .wave-inner {
      transform-origin: 16px 12px;
      transition: transform 0.3s ease, opacity 0.3s ease;
    }
    .itshover-volume .wave-outer {
      transform-origin: 19.364px 12px;
      transition: transform 0.4s ease, opacity 0.4s ease;
    }
    .btn-tool:hover .itshover-volume .wave-inner {
      animation: itshoverWavePulse 0.55s infinite alternate ease-in-out;
    }
    .btn-tool:hover .itshover-volume .wave-outer {
      animation: itshoverWavePulse 0.55s 0.15s infinite alternate ease-in-out;
    }
    @keyframes itshoverWavePulse {
      0% { transform: scale(1); opacity: 0.6; }
      100% { transform: scale(1.3); opacity: 1; }
    }

    .itshover-volume-x .speaker {
      transition: transform 0.25s ease;
    }
    .itshover-volume-x .x-mark {
      transform-origin: 19px 12px;
      transition: transform 0.25s ease;
    }
    .btn-tool:hover .itshover-volume-x .speaker {
      animation: itshoverSpeakerShake 0.32s ease-in-out;
    }
    .btn-tool:hover .itshover-volume-x .x-mark {
      transform: scale(1.22);
    }
    @keyframes itshoverSpeakerShake {
      0%, 100% { transform: translateX(0); }
      25% { transform: translateX(-1.5px); }
      75% { transform: translateX(1.5px); }
    }

    /* 11. Refresh Animation (ItsHover refresh-icon) */
    .itshover-refresh {
      transform-origin: 50% 50%;
      transition: transform 0.45s cubic-bezier(0.33, 1, 0.68, 1);
    }
    .btn-tool:hover .itshover-refresh {
      transform: rotate(-180deg);
    }

    .btn-action .btn-text {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .status-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #64748b;
      margin-left: auto;
      flex-shrink: 0;
      transition: all 0.2s ease;
    }
    .active-mode .status-dot {
      background: #22c55e;
      box-shadow: 0 0 6px #4ade80;
    }

    /* Screen-size Responsive Breakpoints */
    @media (max-width: 240px) {
      .treat-bar {
        gap: 4px;
      }
      .btn-treat {
        padding: 5px 2px;
        font-size: 10px;
        gap: 2px;
      }
      .treat-bonus {
        display: none;
      }
      .action-grid {
        grid-template-columns: 1fr 1fr;
        gap: 4px;
      }
      .btn-action {
        padding: 6px 4px;
        font-size: 10.5px;
        gap: 4px;
      }
      .status-dot {
        display: none;
      }
    }

    @media (max-width: 180px) {
      .treat-bar {
        grid-template-columns: 1fr;
      }
      .action-grid {
        grid-template-columns: 1fr;
      }
    }

    @media (min-width: 480px) {
      .treat-bar {
        max-width: 600px;
      }
      .action-grid {
        grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
        max-width: 800px;
      }
    }

    @keyframes btnPress {
      0% { transform: scale(1); }
      40% { transform: scale(0.93); }
      100% { transform: scale(1); }
    }
    .btn-pressed {
      animation: btnPress 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275);
    }

    /* Pokédex Section */
    .pokedex-card {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 6px;
      padding: 10px;
      margin-top: 4px;
    }

    .pokedex-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-weight: 700;
      font-size: 11px;
      color: var(--gba-gold);
      margin-bottom: 8px;
      padding-bottom: 4px;
      border-bottom: 1px solid #334155;
    }

    .pokedex-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(44px, 1fr));
      gap: 6px;
      max-height: 180px;
      overflow-y: auto;
    }

    .dex-slot {
      aspect-ratio: 1;
      background: #0f172a;
      border: 1px solid #334155;
      border-radius: 6px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      position: relative;
      transition: all 0.15s;
    }

    .dex-slot:hover {
      border-color: var(--gba-accent);
      background: #1e293b;
    }

    .dex-slot.active-pet {
      border-color: var(--gba-gold);
      box-shadow: 0 0 8px rgba(245, 158, 11, 0.5);
      background: #1e293b;
    }

    .dex-slot.locked {
      cursor: not-allowed;
      opacity: 0.45;
    }

    .dex-slot.locked .dex-icon {
      filter: brightness(0) invert(0.2);
    }

    @keyframes slotShake {
      0%, 100% { transform: translateX(0); }
      20%, 60% { transform: translateX(-3px); }
      40%, 80% { transform: translateX(3px); }
    }
    .slot-locked-shake {
      animation: slotShake 0.35s ease-in-out;
    }

    .dex-icon {
      width: 32px;
      height: 32px;
      image-rendering: pixelated;
      background-repeat: no-repeat;
      transform: scale(1.05);
      transition: transform 0.2s ease;
    }
    .dex-slot:hover .dex-icon {
      transform: scale(1.2);
    }

    .lock-badge {
      position: absolute;
      bottom: 2px;
      font-size: 8px;
      color: #94a3b8;
    }

    /* Footer Tools */
    .footer-tools {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
      margin-top: 8px;
      padding: 0 2px;
    }

    .btn-tool {
      background: #1e293b;
      border: 1px solid #334155;
      color: var(--text-muted);
      border-radius: 6px;
      padding: 5px 8px;
      font-size: 10.5px;
      font-weight: 600;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      transition: all 0.15s ease;
      user-select: none;
      outline: none;
    }

    .btn-tool:hover {
      background: #334155;
      color: var(--text-main);
      border-color: #475569;
    }

    .btn-tool:active, .btn-tool.btn-pressed {
      transform: scale(0.96);
      filter: brightness(1.2);
    }

    .btn-tool.danger:hover {
      border-color: #ef4444;
      color: #f87171;
      background: rgba(239, 68, 68, 0.12);
    }
  </style>
</head>
<body>

  <!-- Top Bar for Panel View -->
  <div class="panel-top-bar" id="panelTopBar" style="${isBottomPanel ? 'display: flex;' : 'display: none;'}">
    <div class="panel-brand">
      <span class="panel-title">VS CODE POKÉMON</span>
      <span class="panel-badge" id="panelCompanionBadge">${state.isEggHatched ? 'Lv. ' + state.level + ' ' + state.activePokemonName : '🥚 Mystery Egg'}</span>
    </div>
    <div class="panel-actions">
      <button class="panel-btn" id="btnPartyAdd" title="Add Pokémon to Walking Squad">+</button>
      <button class="panel-btn" id="btnPartyShuffle" title="Shuffle Squad / Cheer">🔀</button>
      <button class="panel-btn" id="btnPartyReset" title="Reset to Single Companion">🗑️</button>
      <button class="panel-btn" id="btnPanelSound" title="Toggle Sound">🔊</button>
      <button class="panel-btn" id="btnToggleDeck" title="Show / Hide Controls & Pokédex Deck">🎮 Deck</button>
    </div>
  </div>

  <!-- Party Picker Modal -->
  <div class="party-modal-backdrop" id="partyModal" style="display: none;">
    <div class="party-modal-card">
      <div class="party-modal-header">
        <span>🐾 Add Pokémon to Walking Squad (Max 6)</span>
        <button class="party-modal-close" id="btnClosePartyModal">✕</button>
      </div>
      <div class="party-modal-grid" id="partyModalGrid"></div>
    </div>
  </div>

  <!-- 1. GBA Viewport Stage -->
  <div class="viewport-card" id="viewportCard">
    <canvas id="bgCanvas" style="position:absolute;left:0;top:0;z-index:0;image-rendering:pixelated"></canvas>
    <div class="sky-aurora"></div>
    <div class="moon-glow"></div>
    <div class="stars-layer" id="starsLayer"></div>
    <div class="mist-layer"></div>
    <div class="ag-grid"></div>
    <canvas id="snowCanvas"></canvas>

    <!-- HUD Overlay -->
    <div class="viewport-hud">
      <div class="hud-badge">
        <span id="petNameLabel">${state.activePokemonName}</span>
        <span class="level-tag" id="levelLabel">${state.isEggHatched ? `Lv. ${state.level}` : 'Egg Stage'}</span>
        <span class="ag-indicator" id="agIndicator">ZERO-G</span>
      </div>
      <div class="hud-badge">
        <span>⭐ <strong id="commitCountLabel">${state.totalCommits}</strong> commits</span>
      </div>
    </div>

    <!-- Announcement Overlay -->
    <div id="bannerOverlay">
      <div class="banner-title" id="bannerTitle">LEVEL UP!</div>
      <div class="banner-sub" id="bannerSub">Pikachu reached Lv. 6!</div>
    </div>

    <!-- Evolution Flash Cutscene -->
    <div id="evolutionOverlay">
      <div id="evoSpriteTarget" style="transform: scale(3.5);"></div>
      <div class="evo-text" id="evoText">What? Pokémon is evolving!</div>
    </div>

    <!-- Pet Movement Stage -->
    <div class="pet-stage" id="petStage">
      <div id="petWrapper" style="${state.isEggHatched ? 'display:none;' : ''}" title="Click to interact! Drag in Anti-Gravity!">
        <div id="petShadow"></div>
        <!-- Dynamically rendered sprite or Egg SVG -->
        <div id="petSpriteContainer"></div>
      </div>
    </div>
  </div>

  <!-- 2. Controls & EXP Deck -->
  <div class="controls-deck">
    <!-- EXP / Hatch Bar -->
    <div class="exp-container">
      <div class="exp-header">
        <span id="expLabel">${state.isEggHatched ? 'EXP' : 'HATCH PROGRESS'}</span>
        <span id="expRatioLabel">${state.isEggHatched ? `${state.exp} / ${state.expToNextLevel}` : `${state.eggProgress} / ${state.eggRequiredCommits} commits`}</span>
      </div>
      <div class="exp-bar-bg">
        <div class="exp-bar-fill" id="expFill" style="width: ${state.isEggHatched ? Math.min(100, Math.round((state.exp / state.expToNextLevel) * 100)) : Math.min(100, Math.round((state.eggProgress / state.eggRequiredCommits) * 100))}%;"></div>
      </div>
    </div>

    <!-- Easter Egg Feeding Treat Menu -->
    <div class="treat-bar">
      <button class="btn-treat oran" id="btnOran" title="Oran Berry: +20 EXP & Water Evolution">
        <span class="treat-icon" id="oranIcon">
          <svg class="itshover-svg itshover-oran" viewBox="0 0 24 24"><path class="berry-leaf" d="M12 7c-2-3-5-3-7-1s-1 5 1 7c2 2 4 1 6-6Z"/><path class="berry-stem" d="M12 7c1-2 3-3 5-3"/><circle class="berry-body" cx="12" cy="15" r="6"/></svg>
        </span> <span class="treat-label">Oran</span> <span class="treat-bonus">+20</span>
      </button>
      <button class="btn-treat sitrus" id="btnSitrus" title="Sitrus Berry: +45 EXP & Electric Evolution">
        <span class="treat-icon" id="sitrusIcon">
          <svg class="itshover-svg itshover-sitrus" viewBox="0 0 24 24"><path class="heart" d="M19.5 12.572l-7.5 7.428l-7.5 -7.428a5 5 0 1 1 7.5 -6.566a5 5 0 1 1 7.5 6.572"/></svg>
        </span> <span class="treat-label">Sitrus</span> <span class="treat-bonus">+45</span>
      </button>
      <button class="btn-treat candy" id="btnCandy" title="Rare Candy: Instant Level-Up & Special Evolution!">
        <span class="treat-icon" id="candyIcon">
          <svg class="itshover-svg itshover-sparkle" viewBox="0 0 24 24"><path class="sparkle-bottom" d="M16 18a2 2 0 0 1 2 2a2 2 0 0 1 2 -2a2 2 0 0 1 -2 -2a2 2 0 0 1 -2 2z"/><path class="sparkle-top" d="M16 6a2 2 0 0 1 2 2a2 2 0 0 1 2 -2a2 2 0 0 1 -2 -2a2 2 0 0 1 -2 2z"/><path class="sparkle-main" d="M9 18a6 6 0 0 1 6 -6a6 6 0 0 1 -6 -6a6 6 0 0 1 -6 6a6 6 0 0 1 6 6z"/></svg>
        </span> <span class="treat-label">Candy</span> <span class="treat-bonus">Lv+</span>
      </button>
    </div>

    <!-- Quick Actions & Motion Modes -->
    <div class="action-grid">
      <button class="btn-action" id="btnAntiGravity" title="Toggle Sideways Wall-Walking & Anti-Gravity Zero-G Drift">
        <span class="btn-icon" id="agIcon">
          <svg class="itshover-svg itshover-rocket" viewBox="0 0 32 32"><path class="rocket-fin-left rocket-upper" d="m13.299,9h-3.891c-.892,0-1.738.397-2.308,1.083l-5.1,6.139,6.31,1.51"/><path class="rocket-fin-bottom rocket-upper" d="m23,18.701v3.891c0,.892-.397,1.738-1.083,2.308l-6.139,5.1-1.51-6.31"/><path class="rocket-body rocket-upper" d="m14.268,23.69c7.986-2.194,14.642-9.015,15.732-21.69-12.675,1.09-19.496,7.746-21.69,15.732l5.958,5.958Z"/><path class="rocket-trajectory rocket-upper" d="m19,5c4.111,1.389,6.778,4.056,8,8"/><circle class="rocket-window rocket-upper" cx="19" cy="13" r="1.8" fill="currentColor"/><path class="rocket-flame" d="m2,30s.707-4.95,2.121-6.364c1.172-1.172,3.071-1.172,4.243,0s1.172,3.071,0,4.243c-1.414,1.414-6.364,2.121-6.364,2.121Z"/></svg>
        </span> <span class="btn-text" id="agText">Anti-Gravity</span>
        <span class="status-dot" id="agDot"></span>
      </button>
      <button class="btn-action" id="btnFlyMode" title="Toggle Flying/Hover Mode vs Ground Walk">
        <span class="btn-icon" id="flyIcon">
          <svg class="itshover-svg itshover-paw" viewBox="0 0 24 24"><g class="paw-inner"><circle cx="11" cy="4" r="1.8"/><circle cx="18" cy="8" r="1.8"/><circle cx="20" cy="16" r="1.8"/><path d="M9 10a5 5 0 0 1 5 5v3.5a3.5 3.5 0 0 1-6.84 1.045Q6.52 17.48 4.46 16.84A3.5 3.5 0 0 1 5.5 10Z"/></g></svg>
        </span> <span class="btn-text" id="flyText">Fly Mode</span>
        <span class="status-dot" id="flyDot"></span>
      </button>
      <button class="btn-action" id="btnSleep" title="Toggle Sleep / Wake Rest State">
        <span class="btn-icon" id="sleepIcon">
          <svg class="itshover-svg itshover-moon" viewBox="0 0 24 24"><path class="moon" d="M12 3c.132 0 .263 0 .393 0a7.5 7.5 0 0 0 7.92 12.446a9 9 0 1 1 -8.313 -12.454z"/></svg>
        </span> <span class="btn-text" id="sleepText">Sleep</span>
        <span class="status-dot" id="sleepDot"></span>
      </button>
      <button class="btn-action" id="btnArena" title="Open Fullscreen Anti-Gravity Roam in Editor Tab">
        <span class="btn-icon" id="arenaIcon">
          <svg class="itshover-svg itshover-expand" viewBox="0 0 24 24"><path class="arrows-br" d="m15 15 6 6"/><path class="arrows-tr" d="m15 9 6-6"/><path class="corners arrows-br" d="M21 16v5h-5"/><path class="corners arrows-tr" d="M21 8V3h-5"/><path class="corners arrows-bl" d="M3 16v5h5"/><path class="arrows-bl" d="m3 21 6-6"/><path class="corners arrows-tl" d="M3 8V3h5"/><path class="arrows-tl" d="M9 9 3 3"/></svg>
        </span> <span class="btn-text" id="arenaBtnText">${isArena ? 'In Arena' : 'Pop-Out Arena'}</span>
      </button>
      <button class="btn-action" id="btnTestCommit" title="Simulate a Git commit event (EXP & Hatch)">
        <span class="btn-icon" id="commitIcon">
          <svg class="itshover-svg itshover-terminal" viewBox="0 0 24 24"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path class="terminal-chevron" d="M5 7l5 5l-5 5"/><path class="cursor-line" d="M12 19l7 0"/></svg>
        </span> <span class="btn-text">Test Commit</span>
      </button>
      <button class="btn-action" id="btnTestPush" title="Simulate a Git push event (Big EXP & Push Celebration)">
        <span class="btn-icon" id="pushIcon">
          <svg class="itshover-svg itshover-flame" viewBox="0 0 24 24"><g class="flame-group"><path d="M12 10.941c2.333 -3.308 .167 -7.823 -1 -8.941c0 3.395 -2.235 5.299 -3.667 6.706c-1.43 1.408 -2.333 3.621 -2.333 5.588c0 3.704 3.134 6.706 7 6.706s7 -3.002 7 -6.706c0 -1.712 -1.232 -4.403 -2.333 -5.588c-2.084 3.353 -3.257 3.353 -4.667 2.235"/></g></svg>
        </span> <span class="btn-text">Test Push</span>
      </button>
    </div>

    <!-- Catch 'Em All Pokédex Roster -->
    <div class="pokedex-card">
      <div class="pokedex-header">
        <span>📖 CATCH 'EM ALL POKÉDEX</span>
        <span id="pokedexRatio">0 / 22 Caught</span>
      </div>
      <div class="pokedex-grid" id="pokedexGrid">
        <!-- Rendered dynamically -->
      </div>
    </div>

    <!-- Footer Settings & Reset -->
    <div class="footer-tools">
      <button class="btn-tool" id="toggleSound" title="Toggle 8-bit sound chimes">
        <span class="btn-icon" id="soundIcon">
          <svg class="itshover-svg itshover-volume" viewBox="0 0 24 24"><path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"/><path class="wave-inner" d="M16 9a5 5 0 0 1 0 6"/><path class="wave-outer" d="M19.364 18.364a9 9 0 0 0 0-12.728"/></svg>
        </span> <span id="soundLabel">Sound: ON</span>
      </button>
      <button class="btn-tool danger" id="resetBtn" title="Reset all progress and return to Mystery Egg">
        <span class="btn-icon" id="resetIcon">
          <svg class="itshover-svg itshover-refresh" viewBox="0 0 24 24"><path d="M20 11a8.1 8.1 0 0 0 -15.5 -2m-.5 -4v4h4"/><path d="M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4"/></svg>
        </span> <span>Reset to Egg</span>
      </button>
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const isArenaView = ${isArena};
    const isBottomPanel = ${isBottomPanel};
    if (isBottomPanel) {
      document.body.classList.add('bottom-panel-mode');
    }

    const INITIAL_STATE = ${JSON.stringify(state)};
    const INITIAL_ROSTER = ${JSON.stringify(POKEDEX_ROSTER)};
    const INITIAL_COORDS = ${JSON.stringify(POKEMON_SPRITE_COORDS)};

    // DOM Elements
    const viewportCard = document.getElementById('viewportCard');
    const petStage = document.getElementById('petStage');
    const petWrapper = document.getElementById('petWrapper');
    const petSpriteContainer = document.getElementById('petSpriteContainer');
    const petNameLabel = document.getElementById('petNameLabel');
    const levelLabel = document.getElementById('levelLabel');
    const commitCountLabel = document.getElementById('commitCountLabel');
    const expLabel = document.getElementById('expLabel');
    const expRatioLabel = document.getElementById('expRatioLabel');
    const expFill = document.getElementById('expFill');
    const pokedexGrid = document.getElementById('pokedexGrid');
    const pokedexRatio = document.getElementById('pokedexRatio');
    const bannerOverlay = document.getElementById('bannerOverlay');
    const bannerTitle = document.getElementById('bannerTitle');
    const bannerSub = document.getElementById('bannerSub');
    const evolutionOverlay = document.getElementById('evolutionOverlay');
    const evoSpriteTarget = document.getElementById('evoSpriteTarget');
    const evoText = document.getElementById('evoText');
    const sleepIcon = document.getElementById('sleepIcon');
    const sleepText = document.getElementById('sleepText');
    const btnAntiGravity = document.getElementById('btnAntiGravity');
    const agText = document.getElementById('agText');
    const btnFlyMode = document.getElementById('btnFlyMode');
    const flyIcon = document.getElementById('flyIcon');
    const flyText = document.getElementById('flyText');
    const toggleSoundBtn = document.getElementById('toggleSound');
    const soundIcon = document.getElementById('soundIcon');
    const soundLabel = document.getElementById('soundLabel');
    const resetBtn = document.getElementById('resetBtn');
    const snowCanvas = document.getElementById('snowCanvas');
    const bgCanvas = document.getElementById('bgCanvas');

    const PX = 3; // size of one "8-bit pixel" on screen

    function rng(seed) {
      return function () { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    }

    // Walkable lane, as "bottom" offsets in CSS px. Trees never reach this area.
    function getLane(stageH) {
      return { min: Math.round(stageH * 0.06), max: Math.round(stageH * 0.24) };
    }

    function pine(g, x, base, s, dark, mid) {
      g.fillStyle = '#3b2a24'; g.fillRect(x - 1, base - 2, 2, 2);          // trunk
      const th = Math.max(4, Math.round(s * 0.55));
      for (let t = 0; t < 3; t++) {
        const hw = Math.max(2, Math.round(s * (0.5 - t * 0.12)));
        const bottom = base - 2 - Math.round(t * th * 0.7);
        for (let row = 0; row < th; row++) {
          const half = Math.round(hw * (row + 1) / th);
          const y = bottom - th + row;
          g.fillStyle = dark; g.fillRect(x - half, y, half * 2 + 1, 1);
          g.fillStyle = mid;  g.fillRect(x - half, y, Math.max(1, half >> 1), 1);   // lit left side
          if (row < 2) { g.fillStyle = '#e8f1fb'; g.fillRect(x - Math.min(half, 1), y, Math.min(half, 1) * 2 + 1, 1); } // snow cap
        }
      }
    }

    function drawBackground(canvas, stageW, stageH) {
      if (!canvas) return;
      const effectiveW = Math.max(300, stageW || 300);
      const effectiveH = Math.max(160, stageH || 220);
      const w = Math.ceil(effectiveW / PX), h = Math.ceil(effectiveH / PX);
      canvas.width = w; canvas.height = h;
      canvas.style.width = effectiveW + 'px'; canvas.style.height = effectiveH + 'px';
      const g = canvas.getContext('2d');
      if (!g) return;
      const r = rng(7);
      const horizon = Math.floor(h * 0.45);
      const lane = getLane(effectiveH);
      const laneTop = h - Math.round(lane.max / PX) - 2;
      const laneBot = h - Math.round(lane.min / PX) + 2;

      // sky bands
      ['#0b1026', '#121a3a', '#1b2650', '#27346a'].forEach(function (c, i) {
        g.fillStyle = c; g.fillRect(0, Math.floor(i * horizon / 4), w, Math.ceil(horizon / 4) + 1);
      });
      g.fillStyle = '#ffffff';
      for (let i = 0; i < 28; i++) g.fillRect((r() * w) | 0, (r() * horizon * 0.55) | 0, 1, 1);

      // mountains
      g.fillStyle = '#2d2a52';
      for (let x = 0; x < w; x++) {
        const m = horizon - 6 - Math.abs(Math.sin(x * 0.05 + 1) * 14 + Math.sin(x * 0.13) * 5);
        g.fillRect(x, Math.floor(m), 1, horizon - Math.floor(m));
      }

      // ground (snow)
      g.fillStyle = '#c9d8ea'; g.fillRect(0, horizon, w, h - horizon);
      g.fillStyle = '#b6c8de'; g.fillRect(0, horizon, w, 2);

      // tree rows: bases stay ABOVE the lane, so nothing stands in the walking path
      for (let x = 4; x < w; x += 9 + ((r() * 6) | 0))  pine(g, x, horizon + 1, 14 + ((r() * 5) | 0), '#12302f', '#1c4a45');
      for (let x = 0; x < w; x += 12 + ((r() * 8) | 0)) pine(g, x, horizon + 6, 18 + ((r() * 6) | 0), '#183d3a', '#255c55');

      // path, with dithered edges
      g.fillStyle = '#8d93a8'; g.fillRect(0, laneTop, w, laneBot - laneTop);
      g.fillStyle = '#a3a9bd';
      for (let x = 0; x < w; x++) { if ((x & 1) === 0) g.fillRect(x, laneTop, 1, 1); if (((x >> 1) & 1) === 1) g.fillRect(x, laneBot - 1, 1, 1); }
      g.fillStyle = '#767c92';
      for (let i = 0; i < w / 6; i++) g.fillRect((r() * w) | 0, laneTop + 2 + ((r() * (laneBot - laneTop - 4)) | 0), 2, 1);

      // snow specks
      g.fillStyle = '#ffffff';
      for (let i = 0; i < 25; i++) g.fillRect((r() * w) | 0, horizon + 3 + ((r() * (h - horizon - 3)) | 0), 1, 1);
    }

    function redrawBg() {
      drawBackground(bgCanvas, viewportCard.clientWidth || 300, viewportCard.clientHeight || 220);
    }
    redrawBg();
    new ResizeObserver(redrawBg).observe(viewportCard);

    // ItsHover SVG Icons Catalog (https://www.itshover.com/icons)
    const ITSHOVER_ICONS = {
      rocket: '<svg class="itshover-svg itshover-rocket" viewBox="0 0 32 32"><path class="rocket-fin-left rocket-upper" d="m13.299,9h-3.891c-.892,0-1.738.397-2.308,1.083l-5.1,6.139,6.31,1.51"/><path class="rocket-fin-bottom rocket-upper" d="m23,18.701v3.891c0,.892-.397,1.738-1.083,2.308l-6.139,5.1-1.51-6.31"/><path class="rocket-body rocket-upper" d="m14.268,23.69c7.986-2.194,14.642-9.015,15.732-21.69-12.675,1.09-19.496,7.746-21.69,15.732l5.958,5.958Z"/><path class="rocket-trajectory rocket-upper" d="m19,5c4.111,1.389,6.778,4.056,8,8"/><circle class="rocket-window rocket-upper" cx="19" cy="13" r="1.8" fill="currentColor"/><path class="rocket-flame" d="m2,30s.707-4.95,2.121-6.364c1.172-1.172,3.071-1.172,4.243,0s1.172,3.071,0,4.243c-1.414,1.414-6.364,2.121-6.364,2.121Z"/></svg>',
      airplane: '<svg class="itshover-svg itshover-airplane" viewBox="0 0 24 24"><path class="airplane" d="M13.617 1.53c.926-.747 1.964-.793 3.097-.777.587.009.88.013 1.115.104.373.145.67.442.815.815.09.235.095.528.104 1.115.016 1.133-.03 2.17-.778 3.097-.63.78-1.714 1.188-2.235 2.05-.398.656-.213 1.337-.042 2.038l1.28 5.245c.255 1.046.06 1.715-.67 2.446-.39.39-.713.37-1.028-.133l-3.862-6.154-1.845 1.466c-.67.532-1.003.798-1.18 1.172-.41.876-.15 2.192-.136 3.142.008.525-.446 1.56-1.088 1.594-.396.022-.531-.452-.66-.743l-1.232-2.802c-.294-.67-.306-.682-.976-.976l-2.802-1.233c-.29-.128-.765-.263-.743-.66.035-.641 1.07-1.095 1.594-1.087.95.013 2.266.274 3.142-.137.374-.176.64-.51 1.172-1.18l1.466-1.844L1.97 4.226c-.503-.316-.522-.64-.133-1.028.73-.73 1.4-.925 2.446-.67l5.245 1.28c.7.17 1.382.356 2.039-.042.86-.52 1.269-1.604 2.049-2.235"/><path class="wind1" d="m.5 3.5 3-3"/><path class="wind2" d="m.5 3.5 3-3"/></svg>',
      paw: '<svg class="itshover-svg itshover-paw" viewBox="0 0 24 24"><g class="paw-inner"><circle cx="11" cy="4" r="1.8"/><circle cx="18" cy="8" r="1.8"/><circle cx="20" cy="16" r="1.8"/><path d="M9 10a5 5 0 0 1 5 5v3.5a3.5 3.5 0 0 1-6.84 1.045Q6.52 17.48 4.46 16.84A3.5 3.5 0 0 1 5.5 10Z"/></g></svg>',
      moon: '<svg class="itshover-svg itshover-moon" viewBox="0 0 24 24"><path class="moon" d="M12 3c.132 0 .263 0 .393 0a7.5 7.5 0 0 0 7.92 12.446a9 9 0 1 1 -8.313 -12.454z"/></svg>',
      sun: '<svg class="itshover-svg itshover-sun" viewBox="0 0 24 24"><path class="sun-center" d="M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0"/><g class="sun-rays"><path d="M12 4v2"/><path d="M17.65 6.35l-1.41 1.41"/><path d="M20 12h-2"/><path d="M17.65 17.65l-1.41-1.41"/><path d="M12 20v-2"/><path d="M6.35 17.65l1.41-1.41"/><path d="M4 12h2"/><path d="M6.35 6.35l1.41 1.41"/></g></svg>',
      expand: '<svg class="itshover-svg itshover-expand" viewBox="0 0 24 24"><path class="arrows-br" d="m15 15 6 6"/><path class="arrows-tr" d="m15 9 6-6"/><path class="corners arrows-br" d="M21 16v5h-5"/><path class="corners arrows-tr" d="M21 8V3h-5"/><path class="corners arrows-bl" d="M3 16v5h5"/><path class="arrows-bl" d="m3 21 6-6"/><path class="corners arrows-tl" d="M3 8V3h5"/><path class="arrows-tl" d="M9 9 3 3"/></svg>',
      terminal: '<svg class="itshover-svg itshover-terminal" viewBox="0 0 24 24"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path class="terminal-chevron" d="M5 7l5 5l-5 5"/><path class="cursor-line" d="M12 19l7 0"/></svg>',
      flame: '<svg class="itshover-svg itshover-flame" viewBox="0 0 24 24"><g class="flame-group"><path d="M12 10.941c2.333 -3.308 .167 -7.823 -1 -8.941c0 3.395 -2.235 5.299 -3.667 6.706c-1.43 1.408 -2.333 3.621 -2.333 5.588c0 3.704 3.134 6.706 7 6.706s7 -3.002 7 -6.706c0 -1.712 -1.232 -4.403 -2.333 -5.588c-2.084 3.353 -3.257 3.353 -4.667 2.235"/></g></svg>',
      volume2: '<svg class="itshover-svg itshover-volume" viewBox="0 0 24 24"><path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"/><path class="wave-inner" d="M16 9a5 5 0 0 1 0 6"/><path class="wave-outer" d="M19.364 18.364a9 9 0 0 0 0-12.728"/></svg>',
      volumeX: '<svg class="itshover-svg itshover-volume-x" viewBox="0 0 24 24"><path class="speaker" d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"/><g class="x-mark"><line x1="22" x2="16" y1="9" y2="15"/><line x1="16" x2="22" y1="9" y2="15"/></g></svg>',
      refresh: '<svg class="itshover-svg itshover-refresh" viewBox="0 0 24 24"><path d="M20 11a8.1 8.1 0 0 0 -15.5 -2m-.5 -4v4h4"/><path d="M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4"/></svg>',
      oran: '<svg class="itshover-svg itshover-oran" viewBox="0 0 24 24"><path class="berry-leaf" d="M12 7c-2-3-5-3-7-1s-1 5 1 7c2 2 4 1 6-6Z"/><path class="berry-stem" d="M12 7c1-2 3-3 5-3"/><circle class="berry-body" cx="12" cy="15" r="6"/></svg>',
      sitrus: '<svg class="itshover-svg itshover-sitrus" viewBox="0 0 24 24"><path class="heart" d="M19.5 12.572l-7.5 7.428l-7.5 -7.428a5 5 0 1 1 7.5 -6.566a5 5 0 1 1 7.5 6.572"/></svg>',
      candy: '<svg class="itshover-svg itshover-sparkle" viewBox="0 0 24 24"><path class="sparkle-bottom" d="M16 18a2 2 0 0 1 2 2a2 2 0 0 1 2 -2a2 2 0 0 1 -2 -2a2 2 0 0 1 -2 2z"/><path class="sparkle-top" d="M16 6a2 2 0 0 1 2 2a2 2 0 0 1 2 -2a2 2 0 0 1 -2 -2a2 2 0 0 1 -2 2z"/><path class="sparkle-main" d="M9 18a6 6 0 0 1 6 -6a6 6 0 0 1 -6 -6a6 6 0 0 1 -6 6a6 6 0 0 1 6 6z"/></svg>',
      wing: '<svg class="itshover-svg itshover-wing" viewBox="0 0 24 24"><path d="M12 4C7.5 4 3.5 7 2 11c3 1.5 6 1 8.5-.5M12 4c3.5 0 7 2 9 6-2 1.5-5 1.8-8 .5M12 4v16M8 12c-2.5 1-4.5 3-5.5 5.5M16 12c2.5 1 4.5 3 5.5 5.5" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    };

    const SPRITES_BASE_URI = "${spritesBaseUri}";
    const SPRITE_PNG_URI = "${spritePngUri}";
    let currentState = INITIAL_STATE;
    let currentRoster = INITIAL_ROSTER;
    let spriteCoordsMap = INITIAL_COORDS;
    let audioCtx = null;
    let isMuted = !INITIAL_STATE.soundEnabled;

    // Movement Physics & Anti-Gravity Engine
    let posX = 120;
    let posY = 24; // distance from ground
    let vx = 0.95;
    let vy = 0.0;
    let facingDirection = 1; // 1: right, -1: left
    let wallPerimeterProgress = 0; // for anti-gravity wall traversal (0 to 1 perimeter)
    let behaviorMode = INITIAL_STATE.isEggHatched ? 'walking' : 'idle'; // walking, flying, idle, sleeping, celebrating, joyHop
    let isDragging = false;
    let dragStartX = 0;
    let dragStartY = 0;

    // 1. Dynamic Multi-Layer Falling Snow & Wind Gust Engine
    const ctx = snowCanvas.getContext('2d');
    let flakes = [];
    let windGust = 0;
    let targetGust = 0;
    let gustCounter = 0;
    let snowTime = 0;

    function resizeSnowCanvas() {
      snowCanvas.width = viewportCard.clientWidth || 300;
      snowCanvas.height = viewportCard.clientHeight || 220;
      initFlakes();
    }

    function initFlakes() {
      flakes = [];
      const count = Math.max(38, Math.floor(snowCanvas.width / 5.4));
      for (let i = 0; i < count; i++) {
        const layer = Math.random();
        let radius, speedY, speedX, alpha, blur;

        if (layer < 0.45) {
          // Far background flakes (tiny, soft drift)
          radius = 0.8 + Math.random() * 0.7;
          speedY = 0.45 + Math.random() * 0.55;
          speedX = -0.2 + Math.random() * 0.4;
          alpha = 0.28 + Math.random() * 0.25;
          blur = 0;
        } else if (layer < 0.82) {
          // Midground flakes (medium, graceful sway)
          radius = 1.5 + Math.random() * 0.9;
          speedY = 0.75 + Math.random() * 0.85;
          speedX = -0.4 + Math.random() * 0.8;
          alpha = 0.52 + Math.random() * 0.32;
          blur = 0;
        } else {
          // Foreground fluffy flakes (prominent, soft glowing)
          radius = 2.4 + Math.random() * 1.5;
          speedY = 1.25 + Math.random() * 1.25;
          speedX = -0.5 + Math.random() * 1.0;
          alpha = 0.78 + Math.random() * 0.22;
          blur = 1;
        }

        flakes.push({
          x: Math.random() * snowCanvas.width,
          y: Math.random() * snowCanvas.height,
          swayOffset: Math.random() * Math.PI * 2,
          swaySpeed: 0.025 + Math.random() * 0.035,
          swayAmp: 0.5 + Math.random() * 1.0,
          radius,
          speedY,
          speedX,
          alpha,
          blur
        });
      }
    }

    function updateWind() {
      gustCounter++;
      if (gustCounter % 220 === 0) {
        targetGust = (Math.random() - 0.4) * 1.6;
      }
      windGust += (targetGust - windGust) * 0.025;
    }

    function drawSnow() {
      updateWind();
      snowTime += 0.03;
      ctx.clearRect(0, 0, snowCanvas.width, snowCanvas.height);

      for (let f of flakes) {
        ctx.beginPath();
        const sway = Math.sin(snowTime * f.swaySpeed * 60 + f.swayOffset) * f.swayAmp;
        ctx.arc(f.x + sway, f.y, f.radius, 0, Math.PI * 2);

        if (f.blur > 0) {
          ctx.shadowBlur = 4;
          ctx.shadowColor = 'rgba(255, 255, 255, 0.85)';
        } else {
          ctx.shadowBlur = 0;
        }

        ctx.fillStyle = 'rgba(255, 255, 255, ' + f.alpha + ')';
        ctx.fill();

        f.y += f.speedY;
        f.x += f.speedX + windGust;

        if (f.y > snowCanvas.height) {
          f.y = -4;
          f.x = Math.random() * snowCanvas.width;
        }
        if (f.x > snowCanvas.width + 12) f.x = -10;
        if (f.x < -12) f.x = snowCanvas.width + 10;
      }
      requestAnimationFrame(drawSnow);
    }

    function initSkyStars() {
      const container = document.getElementById('starsLayer');
      if (!container) return;
      container.innerHTML = '';
      const starCount = 20;
      for (let i = 0; i < starCount; i++) {
        const star = document.createElement('div');
        star.className = 'star-twinkle';
        star.style.left = (Math.random() * 92 + 4).toFixed(1) + '%';
        star.style.top = (Math.random() * 80 + 8).toFixed(1) + '%';
        star.style.animationDelay = (Math.random() * 3).toFixed(2) + 's';
        star.style.animationDuration = (1.8 + Math.random() * 2.2).toFixed(2) + 's';
        const size = Math.random() > 0.65 ? 2.5 : 1.5;
        star.style.width = size + 'px';
        star.style.height = size + 'px';
        container.appendChild(star);
      }
    }

    window.addEventListener('resize', resizeSnowCanvas);
    initSkyStars();
    resizeSnowCanvas();
    drawSnow();

    // 2. 8-Bit Web Audio Synthesizer
    function playChime(type) {
      if (isMuted) return;
      try {
        if (!audioCtx) {
          audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (audioCtx.state === 'suspended') {
          audioCtx.resume();
        }

        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        const now = audioCtx.currentTime;

        if (type === 'click') {
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(540, now);
          osc.frequency.exponentialRampToValueAtTime(720, now + 0.04);
          gain.gain.setValueAtTime(0.08, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
          osc.start(now);
          osc.stop(now + 0.05);
        } else if (type === 'hop') {
          osc.type = 'sine';
          osc.frequency.setValueAtTime(440, now);
          osc.frequency.exponentialRampToValueAtTime(880, now + 0.12);
          gain.gain.setValueAtTime(0.12, now);
          gain.gain.exponentialRampToValueAtTime(0.01, now + 0.12);
          osc.start(now);
          osc.stop(now + 0.13);
        } else if (type === 'eat') {
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(320, now);
          osc.frequency.exponentialRampToValueAtTime(640, now + 0.08);
          gain.gain.setValueAtTime(0.15, now);
          gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
          osc.start(now);
          osc.stop(now + 0.16);
        } else if (type === 'levelUp') {
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(523.25, now);
          osc.frequency.setValueAtTime(659.25, now + 0.1);
          osc.frequency.setValueAtTime(783.99, now + 0.2);
          osc.frequency.setValueAtTime(1046.50, now + 0.3);
          gain.gain.setValueAtTime(0.15, now);
          gain.gain.exponentialRampToValueAtTime(0.01, now + 0.55);
          osc.start(now);
          osc.stop(now + 0.56);
        } else if (type === 'evolve') {
          const notes = [440, 554, 659, 880, 1108, 1318, 1760];
          notes.forEach((f, i) => {
            const o = audioCtx.createOscillator();
            const g = audioCtx.createGain();
            o.connect(g);
            g.connect(audioCtx.destination);
            o.type = 'triangle';
            o.frequency.setValueAtTime(f, now + i * 0.1);
            g.gain.setValueAtTime(0.14, now + i * 0.1);
            g.gain.exponentialRampToValueAtTime(0.01, now + i * 0.1 + 0.2);
            o.start(now + i * 0.1);
            o.stop(now + i * 0.1 + 0.22);
          });
        }
      } catch (e) {
        console.warn('Audio play error:', e);
      }
    }

    // Authentic Pokémon Game Skill Sound Synthesizer
    function playSkillSound(soundType) {
      if (isMuted) return;
      try {
        if (!audioCtx) {
          audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (audioCtx.state === 'suspended') {
          audioCtx.resume();
        }
        const now = audioCtx.currentTime;

        if (soundType === 'thunder') {
          // Authentic retro electric zap / thunder
          const osc1 = audioCtx.createOscillator();
          const osc2 = audioCtx.createOscillator();
          const gainNode = audioCtx.createGain();
          osc1.type = 'sawtooth';
          osc2.type = 'square';
          osc1.frequency.setValueAtTime(1400, now);
          osc1.frequency.exponentialRampToValueAtTime(320, now + 0.18);
          osc2.frequency.setValueAtTime(820, now);
          osc2.frequency.exponentialRampToValueAtTime(160, now + 0.25);
          osc1.connect(gainNode);
          osc2.connect(gainNode);
          gainNode.connect(audioCtx.destination);
          gainNode.gain.setValueAtTime(0.16, now);
          gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.32);
          osc1.start(now);
          osc2.start(now);
          osc1.stop(now + 0.32);
          osc2.stop(now + 0.32);
        } else if (soundType === 'fire') {
          // Rushing fire roar / flame burst
          const osc = audioCtx.createOscillator();
          const filter = audioCtx.createBiquadFilter();
          const gain = audioCtx.createGain();
          osc.type = 'sawtooth';
          filter.type = 'lowpass';
          filter.frequency.setValueAtTime(650, now);
          filter.frequency.exponentialRampToValueAtTime(120, now + 0.35);
          osc.frequency.setValueAtTime(180, now);
          osc.frequency.exponentialRampToValueAtTime(65, now + 0.35);
          osc.connect(filter);
          filter.connect(gain);
          gain.connect(audioCtx.destination);
          gain.gain.setValueAtTime(0.18, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.38);
          osc.start(now);
          osc.stop(now + 0.38);
        } else if (soundType === 'water') {
          // Cascading water bubbles
          const freqs = [380, 520, 680, 840];
          freqs.forEach((f, idx) => {
            const o = audioCtx.createOscillator();
            const g = audioCtx.createGain();
            o.type = 'sine';
            const t = now + idx * 0.055;
            o.frequency.setValueAtTime(f * 0.7, t);
            o.frequency.exponentialRampToValueAtTime(f * 1.3, t + 0.06);
            g.gain.setValueAtTime(0.12, t);
            g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
            o.connect(g);
            g.connect(audioCtx.destination);
            o.start(t);
            o.stop(t + 0.09);
          });
        } else if (soundType === 'grass') {
          // Razor sharp slicing whoosh
          const osc = audioCtx.createOscillator();
          const gain = audioCtx.createGain();
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(1600, now);
          osc.frequency.exponentialRampToValueAtTime(260, now + 0.16);
          gain.gain.setValueAtTime(0.15, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
          osc.connect(gain);
          gain.connect(audioCtx.destination);
          osc.start(now);
          osc.stop(now + 0.19);
        } else if (soundType === 'psychic') {
          // Mystical twin oscillating harmonic sweep
          const osc1 = audioCtx.createOscillator();
          const osc2 = audioCtx.createOscillator();
          const gain = audioCtx.createGain();
          osc1.type = 'sine';
          osc2.type = 'triangle';
          osc1.frequency.setValueAtTime(580, now);
          osc1.frequency.exponentialRampToValueAtTime(1160, now + 0.28);
          osc2.frequency.setValueAtTime(586, now);
          osc2.frequency.exponentialRampToValueAtTime(1172, now + 0.28);
          gain.gain.setValueAtTime(0.14, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.32);
          osc1.connect(gain);
          osc2.connect(gain);
          gain.connect(audioCtx.destination);
          osc1.start(now);
          osc2.start(now);
          osc1.stop(now + 0.33);
          osc2.stop(now + 0.33);
        } else if (soundType === 'dark' || soundType === 'ghost') {
          // Eerie frequency drop & warble
          const osc = audioCtx.createOscillator();
          const gain = audioCtx.createGain();
          osc.type = 'sawtooth';
          osc.frequency.setValueAtTime(440, now);
          osc.frequency.exponentialRampToValueAtTime(110, now + 0.32);
          gain.gain.setValueAtTime(0.14, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
          osc.connect(gain);
          gain.connect(audioCtx.destination);
          osc.start(now);
          osc.stop(now + 0.36);
        } else if (soundType === 'swift' || soundType === 'star') {
          // Dazzling pentatonic star chime
          const notes = [1046.5, 1318.5, 1568.0, 1975.5, 2093.0];
          notes.forEach((f, idx) => {
            const o = audioCtx.createOscillator();
            const g = audioCtx.createGain();
            o.type = 'triangle';
            const t = now + idx * 0.045;
            o.frequency.setValueAtTime(f, t);
            g.gain.setValueAtTime(0.12, t);
            g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
            o.connect(g);
            g.connect(audioCtx.destination);
            o.start(t);
            o.stop(t + 0.15);
          });
        } else if (soundType === 'aura') {
          // Energy sphere punch / impact
          const osc = audioCtx.createOscillator();
          const gain = audioCtx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(140, now);
          osc.frequency.exponentialRampToValueAtTime(360, now + 0.08);
          osc.frequency.exponentialRampToValueAtTime(75, now + 0.24);
          gain.gain.setValueAtTime(0.2, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
          osc.connect(gain);
          gain.connect(audioCtx.destination);
          osc.start(now);
          osc.stop(now + 0.29);
        } else {
          playChime('hop');
        }
      } catch (e) {
        console.warn('Skill sound error:', e);
      }
    }

    // Instant Button Press Tactile Helper
    function triggerButtonFeedback(btn, chime = 'click') {
      if (!btn) return;
      playChime(chime);
      btn.classList.remove('btn-pressed');
      void btn.offsetWidth;
      btn.classList.add('btn-pressed');
      setTimeout(() => btn.classList.remove('btn-pressed'), 250);
    }

    // 3. Crisp Pixel Art Mystery Egg Renderer
    function renderEggSVG(progress, required) {
      const isCracking = progress >= 1;
      const crackClass = isCracking ? 'egg-cracking' : 'egg-wobble';
      const crackSvg = isCracking
        ? '<path d="M 16 5 L 14 12 L 18 18 L 13 24 L 17 30" stroke="#f59e0b" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round" filter="drop-shadow(0 0 3px #fbbf24)"/>'
        : '';
      return '<div class="pokemon-egg-container ' + crackClass + '">' +
        '<svg viewBox="0 0 32 38" class="pokemon-egg-svg" width="40" height="46">' +
          '<path d="M 16 3 C 8 3, 3 14, 3 24 C 3 32, 9 36, 16 36 C 23 36, 29 32, 29 24 C 29 14, 24 3, 16 3 Z" fill="#fef3c7" stroke="#0f172a" stroke-width="2.2" stroke-linejoin="round"/>' +
          '<ellipse cx="11" cy="18" rx="4.5" ry="5.5" fill="#10b981" stroke="#047857" stroke-width="1.2"/>' +
          '<ellipse cx="22" cy="25" rx="3.5" ry="4.5" fill="#10b981" stroke="#047857" stroke-width="1.2"/>' +
          '<ellipse cx="19" cy="11" rx="3" ry="3.5" fill="#10b981" stroke="#047857" stroke-width="1.2"/>' +
          '<path d="M 8 10 Q 12 6 16 8" stroke="#ffffff" stroke-width="1.8" fill="none" stroke-linecap="round"/>' +
          crackSvg +
        '</svg>' +
      '</div>';
    }

    const SPRITE_FRAME_SIZES = {
      bayleef: 48,
      charizard: 48,
      'charizard-shiny': 48,
      samurott: 48,
      torterra: 48,
      zoroark: 48,
      zoroark_hisui: 48,
      dragonite: 48,
      mewtwo: 48,
      rayquaza: 48
    };

    function getFrameSize(slug) {
      return SPRITE_FRAME_SIZES[slug] || 32;
    }

    let activeWalkers = [];

    class Walker {
      constructor(slug, posX, facingDirection, isPrimary) {
        this.slug = slug;
        this.isPrimary = isPrimary;
        this.frameSize = getFrameSize(slug);
        this.posX = posX;
        this.facingDirection = facingDirection;
        this.vx = 0.52 + Math.random() * 0.3;
        this.animTick = Math.floor(Math.random() * 20);
        this.walkFrame = 0;
        this.idleFrame = 0;
        this.specialFrame = 0;
        this.behaviorMode = 'walking';
        this.idleTimer = 0;
        this.isDragging = false;

        const lane = getLane(viewportCard.clientHeight || 220);
        this.laneY = lane.min + Math.random() * (lane.max - lane.min);
        this.targetLaneY = this.laneY;

        const flyingSlugs = ['charizard', 'charizard-shiny', 'togekiss', 'togetic', 'aerodactyl', 'lugia'];
        this.hasWings = flyingSlugs.includes(slug) || (isPrimary && currentState && currentState.flyMode && currentState.hasWings);
        this.flyAltitude = (this.hasWings && (Math.random() > 0.45 || (isPrimary && currentState && currentState.flyMode))) ? (22 + Math.random() * 20) : 0;
        this.posY = this.laneY + this.flyAltitude;

        this.createElement();
      }

      createElement() {
        this.wrapper = document.createElement('div');
        this.wrapper.className = 'walker-wrapper';
        this.wrapper.style.width = this.frameSize + 'px';
        this.wrapper.style.height = this.frameSize + 'px';
        this.wrapper.title = 'Click for ' + this.slug + ' signature move! Drag to move!';

        this.spriteEl = document.createElement('div');
        this.spriteEl.className = 'walker-sprite';
        this.spriteEl.style.width = this.frameSize + 'px';
        this.spriteEl.style.height = this.frameSize + 'px';
        const spriteUrl = SPRITES_BASE_URI + '/' + this.slug + '.png';
        this.spriteEl.style.backgroundImage = 'url("' + spriteUrl + '")';
        this.spriteEl.style.backgroundRepeat = 'no-repeat';
        this.spriteEl.style.backgroundSize = (this.frameSize * 4) + 'px ' + (this.frameSize * 12) + 'px';
        this.spriteEl.style.imageRendering = 'pixelated';

        // Robust fallback: if sprite fails to load, gracefully fall back so companion never disappears!
        const testImg = new Image();
        testImg.onerror = () => {
          this.spriteEl.style.backgroundImage = 'url("' + SPRITES_BASE_URI + '/pikachu.png")';
          this.frameSize = 32;
          this.wrapper.style.width = '32px';
          this.wrapper.style.height = '32px';
          this.spriteEl.style.width = '32px';
          this.spriteEl.style.height = '32px';
          this.spriteEl.style.backgroundSize = '128px 384px';
        };
        testImg.src = spriteUrl;

        this.shadowEl = document.createElement('div');
        this.shadowEl.className = 'walker-shadow';
        this.shadowEl.style.width = Math.min(32, Math.round(this.frameSize * 0.72)) + 'px';

        this.wrapper.appendChild(this.spriteEl);
        petStage.appendChild(this.shadowEl);
        petStage.appendChild(this.wrapper);

        // Set initial positions immediately
        this.wrapper.style.left = Math.round(this.posX) + 'px';
        this.wrapper.style.bottom = Math.round(this.posY) + 'px';
        this.shadowEl.style.left = Math.round(this.posX + (this.frameSize - 28) / 2) + 'px';
        this.shadowEl.style.bottom = Math.round(this.laneY - 2) + 'px';

        this.wrapper.addEventListener('click', (e) => {
          if (this.isDragging) return;
          e.stopPropagation();
          this.triggerSkill();
        });

        this.wrapper.addEventListener('mousedown', (e) => {
          this.isDragging = true;
          this.dragStartX = e.clientX;
          this.dragStartY = e.clientY;
          this.initialX = this.posX;
          this.initialY = this.posY;
        });

        window.addEventListener('mousemove', (e) => {
          if (!this.isDragging) return;
          const dx = e.clientX - this.dragStartX;
          const dy = e.clientY - this.dragStartY;
          this.posX = this.initialX + dx;
          this.posY = Math.max(0, this.initialY - dy);
          this.wrapper.style.left = Math.round(this.posX) + 'px';
          this.wrapper.style.bottom = Math.round(this.posY) + 'px';
        });

        window.addEventListener('mouseup', () => {
          if (this.isDragging) {
            this.isDragging = false;
            const lane = getLane(viewportCard.clientHeight || 220);
            this.laneY = this.targetLaneY = Math.min(Math.max(this.posY, lane.min), lane.max);
          }
        });
      }

      update(stageW, lane) {
        if (this.isDragging) return;

        this.animTick++;

        // Wander up/down the lane
        if (this.animTick % 180 === 0 && Math.random() < 0.5) {
          this.targetLaneY = lane.min + Math.random() * (lane.max - lane.min);
        }
        this.laneY += (this.targetLaneY - this.laneY) * 0.02;
        const pathBaseY = this.laneY;

        let row = 8;
        let col = 0;

        if (currentState && currentState.isSleeping) {
          row = 11;
          if (this.animTick % 32 === 0) {
            this.walkFrame = (this.walkFrame + 1) % 2;
          }
          col = this.walkFrame;
          this.posY = pathBaseY;
        } else if (this.behaviorMode === 'skill') {
          row = 9;
          if (this.animTick % 6 === 0) {
            this.specialFrame = (this.specialFrame + 1) % 4;
          }
          col = this.specialFrame;
        } else if (this.behaviorMode === 'idle') {
          row = 8;
          if (this.animTick % 16 === 0) {
            this.idleFrame = (this.idleFrame + 1) % 4;
          }
          col = this.idleFrame;
          this.idleTimer--;
          if (this.idleTimer <= 0) {
            this.behaviorMode = 'walking';
          }
        } else if (this.flyAltitude > 0) {
          row = this.facingDirection === 1 ? 2 : 6;
          if (this.animTick % 6 === 0) {
            this.walkFrame = (this.walkFrame + 1) % 4;
          }
          col = this.walkFrame;
          this.posX += this.vx * this.facingDirection * 0.72;
          this.posY = pathBaseY + this.flyAltitude + Math.sin(this.animTick * 0.08) * 3;
        } else {
          // Ground walk: Row 2 (right), Row 6 (left) - Genuine authentic 4-frame walk cycle
          row = this.facingDirection === 1 ? 2 : 6;
          if (this.animTick % 8 === 0) {
            this.walkFrame = (this.walkFrame + 1) % 4;
          }
          col = this.walkFrame;

          this.posX += this.vx * this.facingDirection * 0.68;
          this.posY = pathBaseY;

          // Gentle snow footstep puffs
          if (this.animTick % 16 === 0 && typeof spawnSnowPuff === 'function') {
            spawnSnowPuff(this.posX + (this.facingDirection === 1 ? 12 : this.frameSize - 12), pathBaseY + 2);
          }

          // Random idle pause
          if (Math.random() < 0.002) {
            this.behaviorMode = 'idle';
            this.idleTimer = 40 + Math.floor(Math.random() * 50);
          }
        }

        // Boundary turning
        const rightLimit = stageW - this.frameSize - 6;
        if (this.posX > rightLimit) {
          this.posX = rightLimit;
          this.facingDirection = -1;
          if (typeof triggerTreeRustle === 'function') triggerTreeRustle('right');
        }
        if (this.posX < 8) {
          this.posX = 8;
          this.facingDirection = 1;
          if (typeof triggerTreeRustle === 'function') triggerTreeRustle('left');
        }

        // Apply styles, snap to whole pixels so sprites stay crisp:
        this.spriteEl.style.backgroundPosition = -(col * this.frameSize) + 'px ' + -(row * this.frameSize) + 'px';
        this.wrapper.style.left = Math.round(this.posX) + 'px';
        this.wrapper.style.bottom = Math.round(this.posY) + 'px';
        this.wrapper.style.zIndex = String(10 + Math.round(1000 - this.posY));    // lower on screen = in front

        // Shadow
        this.shadowEl.style.left = Math.round(this.posX + (this.frameSize - 28) / 2) + 'px';
        this.shadowEl.style.bottom = Math.round(pathBaseY - 2) + 'px';
        this.shadowEl.style.zIndex = String(9 + Math.round(1000 - this.posY));
        if (this.flyAltitude > 0) {
          this.shadowEl.style.opacity = '0.35';
          this.shadowEl.style.transform = 'scale(0.85)';
        } else {
          this.shadowEl.style.opacity = '0.55';
          this.shadowEl.style.transform = 'scale(1)';
        }
      }

      triggerSkill() {
        const skill = POKEMON_SKILLS[this.slug] || getSkillForPokemon(this.slug, this.slug);
        playSkillSound(skill.sound);
        this.behaviorMode = 'skill';
        this.specialFrame = 0;
        showSkillBanner(skill.icon + ' ' + skill.moveName, skill.badgeClass);
        showSpeechBubble(skill.cry, this.posX + this.frameSize / 2, this.posY + this.frameSize + 8);
        spawnSkillFX(skill.type, this.posX + this.frameSize / 2, this.posY + this.frameSize / 2, this.facingDirection);

        setTimeout(() => {
          this.behaviorMode = 'walking';
        }, 950);
      }

      cheer() {
        this.behaviorMode = 'skill';
        this.specialFrame = 0;
        this.facingDirection *= -1;
        spawnParticle('✨', this.posX + this.frameSize / 2, this.posY + this.frameSize + 4);
        setTimeout(() => {
          this.behaviorMode = 'walking';
        }, 800);
      }

      destroy() {
        if (this.wrapper) this.wrapper.remove();
        if (this.shadowEl) this.shadowEl.remove();
      }
    }

    function syncWalkers() {
      if (!currentState) return;

      activeWalkers.forEach(w => w.destroy());
      activeWalkers = [];

      const petWrapperEl = document.getElementById('petWrapper');

      if (!currentState.isEggHatched) {
        if (petWrapperEl) petWrapperEl.style.display = 'flex';
        updatePetSpriteView();
        return;
      }

      if (petWrapperEl) {
        petWrapperEl.style.display = 'none';
        if (petSpriteContainer) petSpriteContainer.innerHTML = '';
      }

      let party = (currentState.walkingParty || []).filter(Boolean);
      const activeSlug = currentState.activePokemonSlug || (currentState.isEggHatched ? 'pikachu' : 'egg');
      if (party.length === 0 || !party.includes(activeSlug)) {
        party = [activeSlug];
      }
      party = party.slice(0, 6);

      const stageW = viewportCard.clientWidth || 400;
      const count = party.length;
      const spacing = Math.max(36, Math.min(90, (stageW - 100) / Math.max(1, count)));

      party.forEach((slug, idx) => {
        const isPrimary = (slug === currentState.activePokemonSlug);
        const startX = 24 + idx * spacing;
        const dir = (idx % 2 === 0) ? 1 : -1;
        const walker = new Walker(slug, startX, dir, isPrimary);
        activeWalkers.push(walker);
      });
    }

    // 4. Dedicated Multi-Frame Sprite Frame Cycle & View
    let animTick = 0;
    let walkFrame = 0;
    let idleFrame = 0;
    let sleepFrame = 0;
    let specialFrame = 0;

    function updateSpriteFrame() {
      const spriteEl = document.getElementById('petSprite');
      if (!spriteEl || !currentState || !currentState.isEggHatched) return;

      animTick++;
      let row = 8;
      let col = 0;

      if (currentState.isSleeping) {
        row = 11; // Sleep loop row (2 frames: curled/resting)
        if (animTick % 32 === 0) {
          sleepFrame = (sleepFrame + 1) % 2;
        }
        col = sleepFrame;
      } else if (behaviorMode === 'celebrating' || behaviorMode === 'joyHop' || behaviorMode === 'skill') {
        row = 9; // Special celebration cheer & skill attack animation row (4 frames)
        if (animTick % 6 === 0) {
          specialFrame = (specialFrame + 1) % 4;
        }
        col = specialFrame;
      } else if (currentState.flyMode && currentState.hasWings) {
        // Flight mode: uses row 2 (right) or row 6 (left) with energetic wing-beat cadence
        row = facingDirection === 1 ? 2 : 6;
        if (animTick % 6 === 0) {
          walkFrame = (walkFrame + 1) % 4;
        }
        col = walkFrame;
      } else if (behaviorMode === 'walking') {
        // Genuine 4-frame walk cycle stepping across snow: row 2 (right) or row 6 (left)
        row = facingDirection === 1 ? 2 : 6;
        if (animTick % 8 === 0) {
          walkFrame = (walkFrame + 1) % 4;
        }
        col = walkFrame;
      } else {
        // Natural idle breathing & looking around: row 8 (4 frames)
        row = 8;
        if (animTick % 16 === 0) {
          idleFrame = (idleFrame + 1) % 4;
        }
        col = idleFrame;
      }

      const activeFSize = getFrameSize(currentState.activePokemonSlug);
      spriteEl.style.backgroundPosition = -(col * activeFSize) + 'px ' + -(row * activeFSize) + 'px';
    }

    function updatePetSpriteView() {
      if (!currentState) return;

      const slug = currentState.activePokemonSlug;
      const isEgg = !currentState.isEggHatched || slug === 'egg';

      petSpriteContainer.innerHTML = '';
      petWrapper.className = '';

      if (isEgg) {
        petWrapper.style.display = 'flex';
        petSpriteContainer.innerHTML = renderEggSVG(currentState.eggProgress, currentState.eggRequiredCommits);
        if (currentState.isSleeping) {
          petWrapper.classList.add('sleeping');
        } else {
          petWrapper.classList.add('egg-wobble');
        }
      } else {
        // When hatched, all companions walk via Walker instances.
        petWrapper.style.display = 'none';
        petSpriteContainer.innerHTML = '';
      }

      if (currentState.antiGravity) {
        viewportCard.classList.add('anti-gravity-active');
      } else {
        viewportCard.classList.remove('anti-gravity-active');
      }
    }

    // 5. Physics & Movement Loop (Handles Both Pokémon and Egg in All Modes)
    function animatePhysics() {
      if (!currentState) {
        requestAnimationFrame(animatePhysics);
        return;
      }

      updateSpriteFrame();

      const stageW = viewportCard.clientWidth || 300;
      const stageH = viewportCard.clientHeight || 220;
      const lane = getLane(stageH);

      if (currentState.isEggHatched) {
        if (activeWalkers.length === 0) {
          syncWalkers();
        }
        if (activeWalkers.length > 0) {
          activeWalkers.forEach(w => w.update(stageW, lane));
          requestAnimationFrame(animatePhysics);
          return;
        }
      }

      if (isDragging) {
        // Handled by pointer events
      } else if (currentState.isSleeping) {
        // Sleeping - egg rests peacefully in the lane
        if (!currentState.isEggHatched) {
          posX = (stageW / 2) - 24;
          posY = Math.round((lane.min + lane.max) / 2);
          petWrapper.style.left = Math.round(posX) + 'px';
          petWrapper.style.bottom = Math.round(posY) + 'px';
          petWrapper.style.transform = 'rotate(14deg) scale(0.95)';
        } else {
          petWrapper.style.left = posX + 'px';
          petWrapper.style.bottom = '24px';
          petWrapper.style.transform = 'none';
        }
      } else if (currentState.antiGravity) {
        // === ANTI-GRAVITY MODE: Float, tumble, or walk walls! ===
        if (currentState.flyMode || !currentState.isEggHatched) {
          // Zero-G Free Drift!
          posX += vx * 1.5;
          posY += vy * 1.5;

          // Bounce off boundary walls
          if (posX < 10) { posX = 10; vx = Math.abs(vx); facingDirection = 1; }
          if (posX > stageW - 54) { posX = stageW - 54; vx = -Math.abs(vx); facingDirection = -1; }
          if (posY < 10) { posY = 10; vy = Math.abs(vy); }
          if (posY > stageH - 54) { posY = stageH - 54; vy = -Math.abs(vy); }

          if (!currentState.isEggHatched) {
            // Egg drifts and gently rotates in zero gravity!
            const spin = (Date.now() / 28) % 360;
            petWrapper.style.left = posX + 'px';
            petWrapper.style.bottom = posY + 'px';
            petWrapper.style.transform = 'rotate(' + (spin * facingDirection) + 'deg)';
          } else {
            petWrapper.style.left = posX + 'px';
            petWrapper.style.bottom = posY + 'px';
            petWrapper.style.transform = 'none';
          }
        } else {
          // Sideways Wall-Walking
          const perimeter = 2 * (stageW - 50) + 2 * (stageH - 50);
          wallPerimeterProgress = (wallPerimeterProgress + 0.0018) % 1.0;
          const dist = wallPerimeterProgress * perimeter;

          const bottomSpan = stageW - 50;
          const rightSpan = stageH - 50;
          const topSpan = stageW - 50;
          const leftSpan = stageH - 50;

          let angle = 0;
          if (dist < bottomSpan) {
            posX = 20 + dist;
            posY = 24;
            angle = 0;
            facingDirection = 1;
          } else if (dist < bottomSpan + rightSpan) {
            posX = stageW - 46;
            posY = 24 + (dist - bottomSpan);
            angle = -90;
            facingDirection = 1;
          } else if (dist < bottomSpan + rightSpan + topSpan) {
            posX = (stageW - 46) - (dist - bottomSpan - rightSpan);
            posY = stageH - 46;
            angle = 180;
            facingDirection = -1;
          } else {
            posX = 20;
            posY = (stageH - 46) - (dist - bottomSpan - rightSpan - topSpan);
            angle = 90;
            facingDirection = -1;
          }

          petWrapper.style.left = posX + 'px';
          petWrapper.style.bottom = posY + 'px';
          petWrapper.style.transform = 'rotate(' + angle + 'deg)';
        }
      } else {
        // === STANDARD GRAVITY MODE (Grounded walk on snowy path & winged sky soaring) ===
        const pathBaseY = Math.round((lane.min + lane.max) / 2);

        if (!currentState.isEggHatched) {
          // Mystery Egg sits stably in the center of the lane wobbling gently
          posX = (stageW / 2) - 24;
          posY = pathBaseY;
          petWrapper.style.left = Math.round(posX) + 'px';
          petWrapper.style.bottom = Math.round(posY) + 'px';
          petWrapper.style.transform = 'rotate(0deg)';
          petShadow.style.bottom = '-2px';
          petShadow.style.transform = 'scale(1)';
          petShadow.style.opacity = '0.55';
        } else if (currentState.flyMode && currentState.hasWings) {
          // === WINGED FLIGHT PHYSICS (Only Pokémon with wings can fly!) ===
          // Dynamic wing flap power stroke & glide descent
          const flapRate = 18; // wing flap cycle ticks
          const flapPhase = (animTick % flapRate) / flapRate;
          let flapLift = 0;
          let flapPitch = 0;
          if (flapPhase < 0.35) {
            // Power downstroke: sharp upward lift impulse!
            const t = flapPhase / 0.35;
            flapLift = Math.sin(t * Math.PI * 0.5) * 11;
            flapPitch = -5 * facingDirection;
          } else {
            // Upstroke glide: graceful glide with slight gravity descent
            const t = (flapPhase - 0.35) / 0.65;
            flapLift = (1 - Math.sin(t * Math.PI * 0.5)) * 11;
            flapPitch = 4 * facingDirection;
          }

          const thermalWave = Math.sin(animTick / 36) * 18;
          const baseFlightY = Math.min(stageH - 58, Math.max(76, stageH * 0.44));
          posY = baseFlightY + thermalWave + flapLift;

          const flightSpeed = 1.35 + (flapPhase < 0.35 ? 0.3 : -0.15);
          posX += vx * facingDirection * flightSpeed;

          // Banking tilt in flight direction and into turns
          const bankAngle = facingDirection * 6 + flapPitch;
          petWrapper.style.transform = 'rotate(' + bankAngle + 'deg)';
          petWrapper.style.left = posX + 'px';
          petWrapper.style.bottom = posY + 'px';

          // Flight boundaries: graceful banking turns
          if (posX > stageW - 38) {
            posX = stageW - 38;
            facingDirection = -1;
          }
          if (posX < 8) {
            posX = 8;
            facingDirection = 1;
          }

          // Ground shadow stays down on snow trail, scaling realistically with altitude!
          const altitude = posY - pathBaseY;
          petShadow.style.bottom = (-altitude - 2) + 'px';
          const shadowScale = Math.max(0.26, 1 - altitude * 0.007);
          const shadowOp = Math.max(0.10, 0.52 - altitude * 0.0045);
          petShadow.style.transform = 'scale(' + shadowScale + ')';
          petShadow.style.opacity = '' + shadowOp;

          // Wing wind trail curl
          if (animTick % 10 === 0) {
            spawnWindTrail(posX + (facingDirection === 1 ? 6 : 30), posY + 16, -facingDirection * 12);
          }
        } else {
          // === GROUNDED WALKING (Authentic 4-frame walk cycle, ultra-smooth movement, NO BOUNCING) ===
          const stepCadence = 16;

          if (behaviorMode === 'walking') {
            // Smooth, steady horizontal stride along the snowy trail - zero vertical jitter or bobbing
            posX += vx * facingDirection * 0.65;
            posY = pathBaseY;

            // Ground shadow is steady and naturally anchored under Pokémon feet
            petShadow.style.bottom = '-2px';
            petShadow.style.transform = 'scale(1)';
            petShadow.style.opacity = '0.55';

            // Gentle snow footstep puff when foot strikes the snow
            if (animTick % stepCadence === 0) {
              spawnSnowPuff(posX + (facingDirection === 1 ? 14 : 26), pathBaseY + 2);
            }

            // Patrol boundaries with deep entry behind foreground trees!
            if (posX > stageW - 36) {
              posX = stageW - 36;
              facingDirection = -1;
              triggerTreeRustle('right');
            }
            if (posX < 8) {
              posX = 8;
              facingDirection = 1;
              triggerTreeRustle('left');
            }
          } else if (behaviorMode === 'skill') {
            // Casting skill move: firmly planted on the ground
            posY = pathBaseY;
            petShadow.style.bottom = '-2px';
            petShadow.style.transform = 'scale(1.1)';
            petShadow.style.opacity = '0.62';
          } else {
            // Natural idle standing on the snowy trail
            posY = pathBaseY;
            petShadow.style.bottom = '-2px';
            petShadow.style.transform = 'scale(1)';
            petShadow.style.opacity = '0.55';
          }

          petWrapper.style.left = posX + 'px';
          petWrapper.style.bottom = posY + 'px';
          petWrapper.style.transform = 'none';
        }
      }

      requestAnimationFrame(animatePhysics);
    }
    requestAnimationFrame(animatePhysics);

    // Autonomous idle pauses & cute personality actions for Pikachu & companions
    setInterval(() => {
      if (!currentState || currentState.isSleeping || currentState.antiGravity || currentState.flyMode || !currentState.isEggHatched) return;
      if (behaviorMode === 'walking' && Math.random() > 0.4) {
        behaviorMode = 'idle';
        updatePetSpriteView();

        const emotes = ['✨', '❄️', '🎵', '⚡', '💛'];
        const chosen = emotes[Math.floor(Math.random() * emotes.length)];
        spawnParticle(chosen, posX + 16, posY + 28);

        setTimeout(() => {
          if (behaviorMode === 'idle') {
            if (Math.random() > 0.6) facingDirection *= -1;
            behaviorMode = 'walking';
            updatePetSpriteView();
          }
        }, 1800 + Math.random() * 1200);
      }
    }, 5500);

    // Autonomous steering timer in flight / zero-g
    setInterval(() => {
      if (!currentState || currentState.isSleeping) return;
      if (currentState.antiGravity || (currentState.flyMode && currentState.isEggHatched)) {
        vx = (Math.random() - 0.5) * 2.8;
        vy = (Math.random() - 0.5) * 2.8;
        if (Math.abs(vx) < 0.5) vx = vx >= 0 ? 0.8 : -0.8;
        if (Math.abs(vy) < 0.5) vy = vy >= 0 ? 0.8 : -0.8;
        facingDirection = vx >= 0 ? 1 : -1;
      }
    }, 2800);

    // Floating Sleep Zzz particles
    setInterval(() => {
      if (currentState && currentState.isSleeping) {
        spawnParticle('💤', posX + 16, posY + 26);
      }
    }, 2000);

    // Floating Effect Generator
    function spawnParticle(text, x, y) {
      const p = document.createElement('div');
      p.className = 'particle';
      p.innerText = text;
      p.style.left = (x !== undefined ? x : posX + 16) + 'px';
      p.style.bottom = (y !== undefined ? y : posY + 20) + 'px';
      p.style.setProperty('--tx', (Math.random() * 24 - 12) + 'px');
      p.style.setProperty('--ty', (-20 - Math.random() * 20) + 'px');
      petStage.appendChild(p);
      setTimeout(() => p.remove(), 1200);
    }

    // Interactive Tree Rustle Stub
    function triggerTreeRustle(side) {
      // Empty stub - background trees are drawn on back canvas
    }

    function spawnSnowPuff(x, y, isDrop = false) {
      const p = document.createElement('div');
      p.className = 'snow-step-puff';
      p.style.left = x + 'px';
      p.style.bottom = y + 'px';
      p.style.setProperty('--dx', (Math.random() * 10 - 5) + 'px');
      p.style.setProperty('--dy', isDrop ? (-12 - Math.random() * 8) + 'px' : (-4 - Math.random() * 4) + 'px');
      petStage.appendChild(p);
      setTimeout(() => p.remove(), 450);
    }

    function spawnWindTrail(x, y, dx) {
      const w = document.createElement('div');
      w.className = 'wind-trail-curl';
      w.style.left = x + 'px';
      w.style.bottom = y + 'px';
      w.style.setProperty('--wdx', dx + 'px');
      w.style.setProperty('--wdy', (Math.random() * 6 - 3) + 'px');
      petStage.appendChild(w);
      setTimeout(() => w.remove(), 550);
    }

    // === POKÉMON SKILL MOVES & BATTLE CRIES (GAME-AUTHENTIC SKILLS) ===
    const POKEMON_SKILLS = {
      pikachu: { moveName: 'Thunderbolt', type: 'electric', icon: '⚡', badgeClass: 'skill-electric', cry: 'Pika... CHUUU! ⚡', sound: 'thunder' },
      raichu: { moveName: 'Volt Tackle', type: 'electric', icon: '⚡', badgeClass: 'skill-electric', cry: 'Rai... CHUUU! ⚡', sound: 'thunder' },
      pichu: { moveName: 'Thunder Shock', type: 'electric', icon: '⚡', badgeClass: 'skill-electric', cry: 'Pi-chuuu! ⚡', sound: 'thunder' },
      charmander: { moveName: 'Flamethrower', type: 'fire', icon: '🔥', badgeClass: 'skill-fire', cry: 'Char-char! 🔥', sound: 'fire' },
      charmeleon: { moveName: 'Flame Burst', type: 'fire', icon: '🔥', badgeClass: 'skill-fire', cry: 'Char-meleon! 🔥', sound: 'fire' },
      charizard: { moveName: 'Fire Blast', type: 'fire', icon: '🔥', badgeClass: 'skill-fire', cry: 'ROAAARRR! 🔥', sound: 'fire' },
      'charizard-shiny': { moveName: 'Dragon Breath', type: 'dragon', icon: '🐉', badgeClass: 'skill-dragon', cry: 'ROAAARRR! 🐉', sound: 'fire' },
      dragonite: { moveName: 'Dragon Rush', type: 'dragon', icon: '🐉', badgeClass: 'skill-dragon', cry: 'Dra-gon-ite! 🐉', sound: 'fire' },
      mew: { moveName: 'Psychic', type: 'psychic', icon: '✨', badgeClass: 'skill-psychic', cry: 'Mewww! ✨', sound: 'psychic' },
      mewtwo: { moveName: 'Psystrike', type: 'psychic', icon: '🔮', badgeClass: 'skill-psychic', cry: 'MEW-TWO! 🔮', sound: 'psychic' },
      rayquaza: { moveName: 'Dragon Ascent', type: 'dragon', icon: '🐲', badgeClass: 'skill-dragon', cry: 'SKREEE-OARRR! 🐲', sound: 'thunder' },
      squirtle: { moveName: 'Water Gun', type: 'water', icon: '💧', badgeClass: 'skill-water', cry: 'Squirtle-squirt! 💧', sound: 'water' },
      wartortle: { moveName: 'Aqua Tail', type: 'water', icon: '💧', badgeClass: 'skill-water', cry: 'War-tortle! 💧', sound: 'water' },
      blastoise: { moveName: 'Hydro Pump', type: 'water', icon: '💧', badgeClass: 'skill-water', cry: 'BLAST-OISE! 💧', sound: 'water' },
      bulbasaur: { moveName: 'Vine Whip', type: 'grass', icon: '🍃', badgeClass: 'skill-grass', cry: 'Bulba-saur! 🍃', sound: 'grass' },
      ivysaur: { moveName: 'Razor Leaf', type: 'grass', icon: '🍃', badgeClass: 'skill-grass', cry: 'Ivy-saur! 🍃', sound: 'grass' },
      venusaur: { moveName: 'Solar Beam', type: 'grass', icon: '🍃', badgeClass: 'skill-grass', cry: 'VENU-SAUR! 🍃', sound: 'grass' },
      eevee: { moveName: 'Swift', type: 'normal', icon: '⭐', badgeClass: 'skill-normal', cry: 'Eev-ee! ⭐', sound: 'swift' },
      vaporeon: { moveName: 'Hydro Pulse', type: 'water', icon: '🌊', badgeClass: 'skill-water', cry: 'Vapor-eon! 🌊', sound: 'water' },
      jolteon: { moveName: 'Thunder Shock', type: 'electric', icon: '⚡', badgeClass: 'skill-electric', cry: 'Jolt-eon! ⚡', sound: 'thunder' },
      flareon: { moveName: 'Lava Plume', type: 'fire', icon: '🔥', badgeClass: 'skill-fire', cry: 'Flare-on! 🔥', sound: 'fire' },
      espeon: { moveName: 'Psybeam', type: 'psychic', icon: '🔮', badgeClass: 'skill-psychic', cry: 'Esp-eon! 🔮', sound: 'psychic' },
      umbreon: { moveName: 'Dark Pulse', type: 'dark', icon: '🌙', badgeClass: 'skill-dark', cry: 'Umbr-eon! 🌙', sound: 'dark' },
      leafeon: { moveName: 'Leaf Blade', type: 'grass', icon: '🍃', badgeClass: 'skill-grass', cry: 'Leaf-eon! 🍃', sound: 'grass' },
      glaceon: { moveName: 'Ice Beam', type: 'ice', icon: '❄️', badgeClass: 'skill-water', cry: 'Gla-ceon! ❄️', sound: 'water' },
      sylveon: { moveName: 'Moonblast', type: 'fairy', icon: '✨', badgeClass: 'skill-fairy', cry: 'Sylv-eon! ✨', sound: 'swift' },
      gastly: { moveName: 'Lick', type: 'ghost', icon: '👻', badgeClass: 'skill-ghost', cry: 'Gast-ly! 👻', sound: 'ghost' },
      haunter: { moveName: 'Shadow Punch', type: 'ghost', icon: '👻', badgeClass: 'skill-ghost', cry: 'Haunt-er! 👻', sound: 'ghost' },
      gengar: { moveName: 'Shadow Ball', type: 'ghost', icon: '👻', badgeClass: 'skill-ghost', cry: 'GEN-GAR! 👻', sound: 'ghost' },
      lucario: { moveName: 'Aura Sphere', type: 'fighting', icon: '💥', badgeClass: 'skill-fighting', cry: 'Lu-car-io! 💥', sound: 'aura' },
      riolu: { moveName: 'Force Palm', type: 'fighting', icon: '💥', badgeClass: 'skill-fighting', cry: 'Rio-lu! 💥', sound: 'aura' },
      togepi: { moveName: 'Metronome', type: 'fairy', icon: '✨', badgeClass: 'skill-fairy', cry: 'Toge-pi! ✨', sound: 'swift' },
      togetic: { moveName: 'Fairy Wind', type: 'fairy', icon: '✨', badgeClass: 'skill-fairy', cry: 'Toge-tic! ✨', sound: 'swift' },
      togekiss: { moveName: 'Air Slash', type: 'flying', icon: '✨', badgeClass: 'skill-fairy', cry: 'Toge-kiss! ✨', sound: 'grass' },
      chikorita: { moveName: 'Razor Leaf', type: 'grass', icon: '🍃', badgeClass: 'skill-grass', cry: 'Chiko-rita! 🍃', sound: 'grass' },
      bayleef: { moveName: 'Magical Leaf', type: 'grass', icon: '🍃', badgeClass: 'skill-grass', cry: 'Bay-leef! 🍃', sound: 'grass' },
      meganium: { moveName: 'Petal Dance', type: 'grass', icon: '🌸', badgeClass: 'skill-grass', cry: 'Mega-nium! 🌸', sound: 'grass' },
      cyndaquil: { moveName: 'Flame Wheel', type: 'fire', icon: '🔥', badgeClass: 'skill-fire', cry: 'Cynda-quil! 🔥', sound: 'fire' },
      quilava: { moveName: 'Lava Plume', type: 'fire', icon: '🔥', badgeClass: 'skill-fire', cry: 'Qui-lava! 🔥', sound: 'fire' },
      typhlosion: { moveName: 'Eruption', type: 'fire', icon: '🔥', badgeClass: 'skill-fire', cry: 'Typhlo-sion! 🔥', sound: 'fire' },
      totodile: { moveName: 'Water Gun', type: 'water', icon: '💧', badgeClass: 'skill-water', cry: 'Toto-dile! 💧', sound: 'water' },
      croconaw: { moveName: 'Aqua Jet', type: 'water', icon: '💧', badgeClass: 'skill-water', cry: 'Croco-naw! 💧', sound: 'water' },
      feraligatr: { moveName: 'Hydro Pump', type: 'water', icon: '💧', badgeClass: 'skill-water', cry: 'Ferali-gatr! 💧', sound: 'water' },
      treecko: { moveName: 'Mega Drain', type: 'grass', icon: '🍃', badgeClass: 'skill-grass', cry: 'Treec-ko! 🍃', sound: 'grass' },
      grovyle: { moveName: 'Leaf Blade', type: 'grass', icon: '🍃', badgeClass: 'skill-grass', cry: 'Gro-vyle! 🍃', sound: 'grass' },
      sceptile: { moveName: 'Leaf Blade', type: 'grass', icon: '🍃', badgeClass: 'skill-grass', cry: 'Scep-tile! 🍃', sound: 'grass' },
      torchic: { moveName: 'Ember', type: 'fire', icon: '🔥', badgeClass: 'skill-fire', cry: 'Tor-chic! 🔥', sound: 'fire' },
      combusken: { moveName: 'Double Kick', type: 'fighting', icon: '🔥', badgeClass: 'skill-fire', cry: 'Com-busken! 🔥', sound: 'aura' },
      blaziken: { moveName: 'Blaze Kick', type: 'fire', icon: '🔥', badgeClass: 'skill-fire', cry: 'Blazi-ken! 🔥', sound: 'fire' },
      mudkip: { moveName: 'Water Gun', type: 'water', icon: '💧', badgeClass: 'skill-water', cry: 'Mud-kip! 💧', sound: 'water' },
      marshtomp: { moveName: 'Mud Bomb', type: 'water', icon: '💧', badgeClass: 'skill-water', cry: 'Marsh-tomp! 💧', sound: 'water' },
      swampert: { moveName: 'Hydro Pump', type: 'water', icon: '💧', badgeClass: 'skill-water', cry: 'Swam-pert! 💧', sound: 'water' },
      shinx: { moveName: 'Spark', type: 'electric', icon: '⚡', badgeClass: 'skill-electric', cry: 'Shin-x! ⚡', sound: 'thunder' },
      luxio: { moveName: 'Spark', type: 'electric', icon: '⚡', badgeClass: 'skill-electric', cry: 'Lux-io! ⚡', sound: 'thunder' },
      luxray: { moveName: 'Thunder', type: 'electric', icon: '⚡', badgeClass: 'skill-electric', cry: 'Lux-ray! ⚡', sound: 'thunder' }
    };

    function getSkillForPokemon(slug, name) {
      return {
        moveName: 'Tackle',
        type: 'normal',
        icon: '⭐',
        badgeClass: 'skill-normal',
        cry: (name || 'Pokémon') + '! ⭐',
        sound: 'swift'
      };
    }

    function showSkillBanner(text, badgeClass) {
      const existing = petStage.querySelector('.skill-banner');
      if (existing) existing.remove();
      const banner = document.createElement('div');
      banner.className = 'skill-banner ' + badgeClass;
      banner.innerHTML = text;
      petStage.appendChild(banner);
      setTimeout(() => banner.remove(), 1150);
    }

    function showSpeechBubble(text, customX, customY) {
      const existing = document.querySelector('.pokemon-speech-bubble');
      if (existing) existing.remove();
      const bubble = document.createElement('div');
      bubble.className = 'pokemon-speech-bubble';
      bubble.innerText = text;
      if (customX !== undefined && customY !== undefined) {
        bubble.style.position = 'absolute';
        bubble.style.left = customX + 'px';
        bubble.style.bottom = customY + 'px';
        petStage.appendChild(bubble);
      } else {
        petWrapper.appendChild(bubble);
      }
      setTimeout(() => bubble.remove(), 1250);
    }

    function spawnSkillFX(type, customX, customY, customDir) {
      const centerX = customX !== undefined ? customX : posX + 24;
      const centerY = customY !== undefined ? customY : posY + 20;
      const dir = customDir !== undefined ? customDir : dir;

      if (type === 'electric') {
        for (let i = 0; i < 4; i++) {
          setTimeout(() => {
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('viewBox', '0 0 100 100');
            svg.classList.add('skill-fx-lightning');
            svg.style.left = (centerX + (Math.random() * 40 - 20) - 50) + 'px';
            svg.style.bottom = (centerY + (Math.random() * 30 - 15) - 30) + 'px';
            svg.style.width = (45 + Math.random() * 35) + 'px';
            svg.style.height = (45 + Math.random() * 35) + 'px';
            svg.innerHTML = '<polyline points="20,10 50,45 35,50 80,90" fill="none" stroke="#fef08a" stroke-width="3" stroke-linecap="round"/>';
            petStage.appendChild(svg);
            setTimeout(() => svg.remove(), 450);
          }, i * 65);
        }
        for (let i = 0; i < 6; i++) {
          spawnParticle('⚡', centerX + (Math.random() * 36 - 18), centerY + (Math.random() * 26 - 13));
        }
      } else if (type === 'fire') {
        for (let i = 0; i < 7; i++) {
          const flame = document.createElement('div');
          flame.className = 'skill-fx-flame';
          flame.style.left = centerX + 'px';
          flame.style.bottom = centerY + 'px';
          flame.style.width = (14 + Math.random() * 12) + 'px';
          flame.style.height = (14 + Math.random() * 12) + 'px';
          flame.style.setProperty('--fx-dx', (dir * (30 + Math.random() * 45)) + 'px');
          flame.style.setProperty('--fx-dy', (Math.random() * 30 - 10) + 'px');
          petStage.appendChild(flame);
          setTimeout(() => flame.remove(), 600);
        }
        spawnParticle('🔥', centerX + dir * 18, centerY + 10);
      } else if (type === 'water') {
        for (let i = 0; i < 8; i++) {
          const bubble = document.createElement('div');
          bubble.className = 'skill-fx-bubble';
          bubble.style.left = (centerX + (Math.random() * 36 - 18)) + 'px';
          bubble.style.bottom = (centerY + (Math.random() * 20 - 10)) + 'px';
          const size = 10 + Math.random() * 14;
          bubble.style.width = size + 'px';
          bubble.style.height = size + 'px';
          bubble.style.setProperty('--bx', (dir * (10 + Math.random() * 25)) + 'px');
          petStage.appendChild(bubble);
          setTimeout(() => bubble.remove(), 700);
        }
        spawnParticle('💧', centerX + dir * 15, centerY + 12);
      } else if (type === 'grass') {
        for (let i = 0; i < 7; i++) {
          const leaf = document.createElement('div');
          leaf.className = 'skill-fx-leaf';
          leaf.innerText = '🍃';
          leaf.style.left = centerX + 'px';
          leaf.style.bottom = centerY + 'px';
          leaf.style.setProperty('--lx', (Math.random() * 40 - 20) + 'px');
          leaf.style.setProperty('--lx2', (Math.random() * 70 - 35) + 'px');
          leaf.style.setProperty('--ly2', (Math.random() * 50 - 25) + 'px');
          petStage.appendChild(leaf);
          setTimeout(() => leaf.remove(), 750);
        }
      } else if (type === 'psychic' || type === 'ghost' || type === 'dark') {
        const ring = document.createElement('div');
        ring.className = 'skill-fx-ring';
        ring.style.setProperty('--ring-color', type === 'psychic' ? '#e879f9' : (type === 'ghost' ? '#a855f7' : '#94a3b8'));
        ring.style.left = centerX + 'px';
        ring.style.bottom = centerY + 'px';
        petStage.appendChild(ring);
        setTimeout(() => ring.remove(), 700);
        spawnParticle(type === 'psychic' ? '🔮' : (type === 'ghost' ? '👻' : '🌙'), centerX, centerY + 14);
      } else {
        // Swift / starburst
        for (let i = 0; i < 8; i++) {
          const star = document.createElement('div');
          star.className = 'skill-fx-star';
          star.innerText = '⭐';
          star.style.left = centerX + 'px';
          star.style.bottom = centerY + 'px';
          const angle = (i / 8) * Math.PI * 2;
          const dist = 32 + Math.random() * 22;
          star.style.setProperty('--sx', (Math.cos(angle) * dist) + 'px');
          star.style.setProperty('--sy', (Math.sin(angle) * dist) + 'px');
          petStage.appendChild(star);
          setTimeout(() => star.remove(), 650);
        }
      }
    }

    let isCastingSkill = false;

    function activatePokemonSkill() {
      if (!currentState) return;

      if (currentState.isSleeping) {
        vscode.postMessage({ type: 'TOGGLE_SLEEP' });
        spawnParticle('☀️');
        playChime('click');
        return;
      }

      if (!currentState.isEggHatched) {
        // Mystery Egg interactive wobble & progress
        playChime('hop');
        petWrapper.classList.remove('egg-click-hop');
        void petWrapper.offsetWidth;
        petWrapper.classList.add('egg-click-hop');
        setTimeout(() => petWrapper.classList.remove('egg-click-hop'), 700);

        spawnParticle('💛', posX + 16, posY + 28);
        spawnParticle('✨', posX + 8, posY + 20);
        showSkillBanner('🥚 WARM WOBBLE', 'skill-electric');
        showSpeechBubble('Warm & cozy! 🥚');
        return;
      }

      if (isCastingSkill) return;
      isCastingSkill = true;

      const slug = currentState.activePokemonSlug;
      const skill = POKEMON_SKILLS[slug] || getSkillForPokemon(slug, currentState.activePokemonName);

      // Play authentic sound
      playSkillSound(skill.sound);

      // Switch to attack animation row 9
      behaviorMode = 'skill';
      specialFrame = 0;
      updatePetSpriteView();

      // Show Move Banner
      showSkillBanner(skill.icon + ' ' + skill.moveName, skill.badgeClass);

      // Show Speech Bubble / Cry
      showSpeechBubble(skill.cry);

      // Trigger Visual FX
      spawnSkillFX(skill.type);

      // Subtle screen shake for impact
      viewportCard.classList.remove('stage-impact-shake');
      void viewportCard.offsetWidth;
      viewportCard.classList.add('stage-impact-shake');
      setTimeout(() => viewportCard.classList.remove('stage-impact-shake'), 240);

      if (currentState.antiGravity) {
        vx *= -1.2;
        vy *= -1.2;
      }

      // Return to walking / flying after skill cast
      setTimeout(() => {
        isCastingSkill = false;
        behaviorMode = (currentState.flyMode && currentState.hasWings) ? 'flying' : 'walking';
        updatePetSpriteView();
      }, 950);
    }

    // Click on Pet / Egg - Triggers signature move skill & sound!
    petWrapper.addEventListener('click', (e) => {
      if (isDragging) return;
      e.stopPropagation();
      activatePokemonSkill();
    });

    // Interactive Drag & Toss in Anti-Gravity
    petWrapper.addEventListener('mousedown', (e) => {
      isDragging = true;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
    });

    window.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const rect = viewportCard.getBoundingClientRect();
      posX = e.clientX - rect.left - 24;
      posY = rect.bottom - e.clientY - 24;
      petWrapper.style.left = posX + 'px';
      petWrapper.style.bottom = posY + 'px';
    });

    window.addEventListener('mouseup', (e) => {
      if (!isDragging) return;
      isDragging = false;
      const dx = e.clientX - dragStartX;
      const dy = -(e.clientY - dragStartY);
      if (currentState && currentState.antiGravity) {
        vx = Math.max(-4, Math.min(4, dx * 0.15));
        vy = Math.max(-4, Math.min(4, dy * 0.15));
        playChime('hop');
        spawnParticle('🌀');
      }
    });

    // Temporary Banner
    function showBanner(title, sub, duration = 3000) {
      bannerTitle.innerText = title;
      bannerSub.innerText = sub;
      bannerOverlay.classList.add('show');
      setTimeout(() => {
        bannerOverlay.classList.remove('show');
      }, duration);
    }

    // Evolution Cutscene
    function triggerEvolutionSequence(fromName, toName, targetSlug) {
      playChime('evolve');
      evoText.innerText = 'What? ' + fromName + ' is evolving!';
      evolutionOverlay.classList.add('active');

      evoSpriteTarget.style.backgroundImage = 'url("' + SPRITES_BASE_URI + '/' + targetSlug + '.png")';
      evoSpriteTarget.style.backgroundPosition = '0px -288px';
      evoSpriteTarget.style.width = '32px';
      evoSpriteTarget.style.height = '32px';
      evoSpriteTarget.style.imageRendering = 'pixelated';

      for (let i = 0; i < 12; i++) {
        setTimeout(() => {
          spawnParticle('🌟', Math.random() * viewportCard.clientWidth, Math.random() * viewportCard.clientHeight);
          spawnParticle('✨', Math.random() * viewportCard.clientWidth, Math.random() * viewportCard.clientHeight);
        }, i * 250);
      }

      setTimeout(() => {
        evoText.innerText = 'Congratulations! ' + fromName + ' evolved into ' + toName + '! 🎉';
        playChime('levelUp');
      }, 2500);

      setTimeout(() => {
        evolutionOverlay.classList.remove('active');
        showBanner('EVOLUTION COMPLETE!', toName + ' joined your team! 🌟', 3500);
      }, 4500);
    }

    // Render Pokédex Grid
    function renderPokedex() {
      if (!currentState || !currentRoster) return;
      pokedexGrid.innerHTML = '';

      let caughtCount = 0;
      currentRoster.forEach(species => {
        const isUnlocked = currentState.unlockedIds.includes(species.id);
        const isActive = currentState.activePokemonId === species.id;
        if (isUnlocked) caughtCount++;

        const slot = document.createElement('div');
        slot.className = 'dex-slot' + (isActive ? ' active-pet' : '') + (!isUnlocked ? ' locked' : '');
        slot.title = isUnlocked
          ? species.name + ' (' + species.type + ')\\n' + species.description + '\\nClick to set companion!'
          : 'Locked: Unlocks at ' + species.milestoneCommits + ' commits!';

        const iconDiv = document.createElement('div');
        iconDiv.className = 'dex-icon';
        const fSize = getFrameSize(species.slug);
        iconDiv.style.backgroundImage = 'url("' + SPRITES_BASE_URI + '/' + species.slug + '.png")';
        iconDiv.style.backgroundPosition = '0px -' + (fSize * 8) + 'px';
        iconDiv.style.width = fSize + 'px';
        iconDiv.style.height = fSize + 'px';
        iconDiv.style.imageRendering = 'pixelated';
        if (fSize > 32) {
          iconDiv.style.transform = 'scale(' + (32 / fSize) + ')';
          iconDiv.style.transformOrigin = 'center center';
        }
        if (species.color === 'shiny') {
          iconDiv.style.filter = 'hue-rotate(90deg) saturate(1.5)';
        }

        // Resilient fallback to pokesprite.png if direct sprite sheet ever fails
        const testImg = new Image();
        testImg.onerror = () => {
          const coords = spriteCoordsMap[species.slug] || spriteCoordsMap[species.id];
          if (coords) {
            iconDiv.style.backgroundImage = 'url("' + SPRITE_PNG_URI + '")';
            iconDiv.style.backgroundPosition = '-' + coords.x + 'px -' + coords.y + 'px';
            iconDiv.style.width = '40px';
            iconDiv.style.height = '30px';
            iconDiv.style.transform = 'scale(0.8)';
            iconDiv.style.transformOrigin = 'center center';
          }
        };
        testImg.src = SPRITES_BASE_URI + '/' + species.slug + '.png';

        slot.appendChild(iconDiv);

        slot.addEventListener('mouseenter', () => {
          if (isUnlocked) {
            iconDiv.style.backgroundPosition = '-' + fSize + 'px -' + (fSize * 8) + 'px';
          }
        });
        slot.addEventListener('mouseleave', () => {
          if (isUnlocked) {
            iconDiv.style.backgroundPosition = '0px -' + (fSize * 8) + 'px';
          }
        });

        if (!isUnlocked) {
          const lockBadge = document.createElement('span');
          lockBadge.className = 'lock-badge';
          lockBadge.innerText = species.milestoneCommits + 'c';
          slot.appendChild(lockBadge);
        }

        slot.addEventListener('click', (e) => {
          if (isUnlocked) {
            triggerButtonFeedback(slot, 'hop');
            spawnParticle('⭐', e.clientX, viewportCard.clientHeight - 40);
            vscode.postMessage({ type: 'SELECT_POKEMON', pokemonId: species.id });
          } else {
            triggerButtonFeedback(slot, 'click');
            slot.classList.add('slot-locked-shake');
            setTimeout(() => slot.classList.remove('slot-locked-shake'), 400);
            showBanner('LOCKED POKÉMON', species.name + ' unlocks at ' + species.milestoneCommits + ' commits!', 2500);
          }
        });

        pokedexGrid.appendChild(slot);
      });

      pokedexRatio.innerText = caughtCount + ' / ' + currentRoster.length + ' Caught';
    }

    // Apply State to DOM
    function applyState(state) {
      currentState = state;
      const panelBadge = document.getElementById('panelCompanionBadge');
      if (panelBadge) {
        panelBadge.innerText = state.isEggHatched ? ('Lv. ' + state.level + ' ' + state.activePokemonName) : '🥚 Mystery Egg';
      }
      if (petNameLabel) petNameLabel.innerText = state.activePokemonName;
      if (levelLabel) levelLabel.innerText = state.isEggHatched ? 'Lv. ' + state.level : 'Egg Stage';
      if (commitCountLabel) commitCountLabel.innerText = state.totalCommits;
      syncWalkers();

      if (!state.isEggHatched) {
        expLabel.innerText = 'HATCH PROGRESS';
        expRatioLabel.innerText = state.eggProgress + ' / ' + state.eggRequiredCommits + ' commits';
        const pct = Math.min(100, Math.round((state.eggProgress / state.eggRequiredCommits) * 100));
        expFill.style.width = pct + '%';
      } else {
        expLabel.innerText = 'EXP';
        expRatioLabel.innerText = state.exp + ' / ' + state.expToNextLevel;
        const pct = Math.min(100, Math.round((state.exp / state.expToNextLevel) * 100));
        expFill.style.width = pct + '%';
      }

      if (state.antiGravity) {
        btnAntiGravity.classList.add('active-mode');
        agText.innerText = 'Zero-G ON';
      } else {
        btnAntiGravity.classList.remove('active-mode');
        agText.innerText = 'Anti-G';
      }

      if (!state.isEggHatched) {
        btnFlyMode.classList.remove('active-mode');
        btnFlyMode.classList.add('disabled-mode');
        flyText.innerText = 'Egg Stage';
        flyIcon.innerHTML = '🥚';
        btnFlyMode.title = 'Mystery eggs cannot fly! Hatch your egg first.';
      } else if (!state.hasWings) {
        btnFlyMode.classList.remove('active-mode');
        btnFlyMode.classList.add('disabled-mode');
        flyText.innerText = 'Needs Wings';
        flyIcon.innerHTML = '🪽';
        btnFlyMode.title = (state.activePokemonName || 'This Pokémon') + ' has no wings to fly! Only winged Pokémon (like Charizard 🪽) can fly.';
      } else {
        btnFlyMode.classList.remove('disabled-mode');
        if (state.flyMode) {
          btnFlyMode.classList.add('active-mode');
          flyText.innerText = 'Soaring 🪽';
          flyIcon.innerHTML = ITSHOVER_ICONS.wing || ITSHOVER_ICONS.airplane;
          btnFlyMode.title = 'Soaring in the skies! Click to land on snowy trail.';
        } else {
          btnFlyMode.classList.remove('active-mode');
          flyText.innerText = 'Take Flight';
          flyIcon.innerHTML = ITSHOVER_ICONS.paw;
          btnFlyMode.title = 'Click to take off and soar through the mountain sky!';
        }
      }

      if (state.isSleeping) {
        btnSleep.classList.add('active-mode');
        sleepIcon.innerHTML = ITSHOVER_ICONS.sun;
        sleepText.innerText = 'Wake Up';
      } else {
        btnSleep.classList.remove('active-mode');
        sleepIcon.innerHTML = ITSHOVER_ICONS.moon;
        sleepText.innerText = 'Sleep';
      }

      if (state.soundEnabled !== undefined) {
        isMuted = !state.soundEnabled;
        soundIcon.innerHTML = isMuted ? ITSHOVER_ICONS.volumeX : ITSHOVER_ICONS.volume2;
        soundLabel.innerText = isMuted ? 'Sound: OFF' : 'Sound: ON';
      }

      updatePetSpriteView();
      renderPokedex();
    }

    // Message Listener
    window.addEventListener('message', event => {
      const msg = event.data;
      switch (msg.type) {
        case 'STATE_UPDATE': {
          currentRoster = msg.roster;
          spriteCoordsMap = msg.coords || {};
          applyState(msg.state);
          break;
        }
        case 'CELEBRATE_COMMIT': {
          applyState(msg.state);
          behaviorMode = 'celebrating';
          playChime('hop');

          spawnParticle('⭐');
          spawnParticle('🎉');

          if (msg.hatched) {
            playChime('levelUp');
            showBanner('EGG HATCHED!', 'A wild ' + msg.state.activePokemonName + ' emerged! 🎉', 4000);
          } else if (msg.evolved) {
            triggerEvolutionSequence(msg.evolvedFrom, msg.evolvedTo, msg.state.activePokemonSlug);
          } else if (msg.leveledUp) {
            playChime('levelUp');
            showBanner('LEVEL UP!', msg.state.activePokemonName + ' reached Lv. ' + msg.state.level + '!', 3000);
          } else if (msg.newUnlocks && msg.newUnlocks.length > 0) {
            showBanner('NEW POKÉMON CAUGHT!', msg.newUnlocks.join(', ') + ' added to Pokédex!', 3500);
          } else if (!msg.state.isEggHatched) {
            showBanner('COMMIT TRACKED!', 'Egg incubated (' + msg.state.eggProgress + '/' + msg.state.eggRequiredCommits + ')! 🥚', 2500);
          } else {
            showBanner('COMMIT TRACKED!', '+50 EXP for ' + msg.state.activePokemonName + '!', 2000);
          }

          setTimeout(() => { behaviorMode = 'walking'; updatePetSpriteView(); }, 3500);
          break;
        }
        case 'CELEBRATE_PUSH': {
          applyState(msg.state);
          behaviorMode = 'celebrating';
          playChime('levelUp');
          spawnParticle('🚀');
          spawnParticle('🔥');

          if (msg.hatched) {
            showBanner('EGG HATCHED!', 'Git push incubated the egg into ' + msg.state.activePokemonName + '! 🎉', 4000);
          } else if (msg.evolved) {
            triggerEvolutionSequence(msg.evolvedFrom, msg.evolvedTo, msg.state.activePokemonSlug);
          } else if (!msg.state.isEggHatched) {
            showBanner('PUSH TRACKED!', 'Egg incubated (' + msg.state.eggProgress + '/' + msg.state.eggRequiredCommits + ')! 🥚🔥', 3000);
          } else {
            showBanner('PUSH CELEBRATION!', 'Code pushed to remote! +80 EXP bonus! 🚀', 3500);
          }

          setTimeout(() => { behaviorMode = 'walking'; updatePetSpriteView(); }, 3500);
          break;
        }
        case 'BERRY_FED': {
          applyState(msg.state);
          playChime('eat');
          spawnParticle('😋');
          spawnParticle('❤️');

          if (msg.isEgg) {
            if (msg.hatched) {
              playChime('levelUp');
              showBanner('EGG HATCHED!', 'Your berries incubated the egg into ' + msg.state.activePokemonName + '! 🎉', 4500);
            } else {
              showBanner('EGG INCUBATED!', 'Easter Egg: Berry warmth warmed the egg! (+1 Progress) 🥚', 3000);
            }
          } else if (msg.evolved) {
            triggerEvolutionSequence(msg.evolvedFrom, msg.evolvedTo, msg.state.activePokemonSlug);
          } else if (msg.leveledUp) {
            playChime('levelUp');
            showBanner('LEVEL UP!', msg.state.activePokemonName + ' reached Lv. ' + msg.state.level + '!', 3000);
          }
          break;
        }
      }
    });

    // Treat Feeding Button Listeners with Instant Haptic Feedback
    document.getElementById('btnOran').addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      triggerButtonFeedback(document.getElementById('btnOran'), 'eat');
      spawnParticle('🫐');
      vscode.postMessage({ type: 'FEED_TREAT', treatType: 'oran' });
    });
    document.getElementById('btnSitrus').addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      triggerButtonFeedback(document.getElementById('btnSitrus'), 'eat');
      spawnParticle('🍓');
      vscode.postMessage({ type: 'FEED_TREAT', treatType: 'sitrus' });
    });
    document.getElementById('btnCandy').addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      triggerButtonFeedback(document.getElementById('btnCandy'), 'eat');
      spawnParticle('🍬');
      vscode.postMessage({ type: 'FEED_TREAT', treatType: 'candy' });
    });

    // Action Mode Buttons with Instant Haptic Feedback
    btnAntiGravity.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      triggerButtonFeedback(btnAntiGravity, 'click');
      spawnParticle('🚀');
      vscode.postMessage({ type: 'TOGGLE_ANTI_GRAVITY' });
    });
    btnFlyMode.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      triggerButtonFeedback(btnFlyMode, 'click');
      if (!currentState.isEggHatched) {
        spawnParticle('🥚');
        showBanner('MYSTERY EGG', 'Mystery eggs cannot fly! Hatch your egg first with git commits.');
        playChime('click');
        return;
      }
      if (!currentState.hasWings) {
        spawnParticle('🪽');
        showBanner('NEEDS WINGS', (currentState.activePokemonName || 'Pokémon') + ' does not have wings to fly! Only winged Pokémon (like Charizard 🪽) can fly.', 3500);
        playChime('click');
        return;
      }
      spawnParticle(currentState.flyMode ? '🐾' : '🪽');
      vscode.postMessage({ type: 'TOGGLE_FLY_MODE' });
    });

    const fgTreeLeft = document.getElementById('fgTreeLeft');
    const fgTreeRight = document.getElementById('fgTreeRight');
    if (fgTreeLeft) fgTreeLeft.addEventListener('click', () => { triggerTreeRustle('left'); playChime('click'); });
    if (fgTreeRight) fgTreeRight.addEventListener('click', () => { triggerTreeRustle('right'); playChime('click'); });
    document.getElementById('btnSleep').addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      triggerButtonFeedback(document.getElementById('btnSleep'), 'click');
      spawnParticle('💤');
      vscode.postMessage({ type: 'TOGGLE_SLEEP' });
    });
    document.getElementById('btnArena').addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      triggerButtonFeedback(document.getElementById('btnArena'), 'click');
      spawnParticle('🌌');
      vscode.postMessage({ type: 'OPEN_ARENA' });
    });
    document.getElementById('btnTestCommit').addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      triggerButtonFeedback(document.getElementById('btnTestCommit'), 'click');
      spawnParticle('💻');
      vscode.postMessage({ type: 'SIMULATE_COMMIT' });
    });
    document.getElementById('btnTestPush').addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      triggerButtonFeedback(document.getElementById('btnTestPush'), 'click');
      spawnParticle('🔥');
      vscode.postMessage({ type: 'SIMULATE_PUSH' });
    });

    // Footer Tool Buttons with Feedback
    toggleSoundBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      isMuted = !isMuted;
      triggerButtonFeedback(toggleSoundBtn, isMuted ? 'click' : 'hop');
      soundIcon.innerHTML = isMuted ? ITSHOVER_ICONS.volumeX : ITSHOVER_ICONS.volume2;
      soundLabel.innerText = isMuted ? 'Sound: OFF' : 'Sound: ON';
      showBanner(isMuted ? 'SOUND MUTED' : 'SOUND ON', isMuted ? 'Audio effects disabled' : '8-bit chimes enabled! 🎵', 1800);
      vscode.postMessage({ type: 'TOGGLE_SOUND', enabled: !isMuted });
    });

    resetBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      triggerButtonFeedback(resetBtn, 'click');
      showBanner('RESET PROGRESS', 'Please confirm reset in the VS Code prompt above', 3000);
      vscode.postMessage({ type: 'RESET_PROGRESS' });
    });

    // Party Picker Modal & Panel Squad Controls
    const POPULAR_WALKERS = [
      { slug: 'dragonite', name: 'Dragonite' },
      { slug: 'mew', name: 'Mew' },
      { slug: 'mewtwo', name: 'Mewtwo' },
      { slug: 'rayquaza', name: 'Rayquaza' },
      { slug: 'charizard', name: 'Charizard' },
      { slug: 'blastoise', name: 'Blastoise' },
      { slug: 'swampert', name: 'Swampert' },
      { slug: 'pikachu', name: 'Pikachu' },
      { slug: 'eevee', name: 'Eevee' },
      { slug: 'lucario', name: 'Lucario' },
      { slug: 'gengar', name: 'Gengar' },
      { slug: 'infernape', name: 'Infernape' },
      { slug: 'sceptile', name: 'Sceptile' },
      { slug: 'blaziken', name: 'Blaziken' },
      { slug: 'togekiss', name: 'Togekiss' },
      { slug: 'typhlosion', name: 'Typhlosion' },
      { slug: 'torterra', name: 'Torterra' },
      { slug: 'empoleon', name: 'Empoleon' },
      { slug: 'vaporeon', name: 'Vaporeon' },
      { slug: 'jolteon', name: 'Jolteon' },
      { slug: 'flareon', name: 'Flareon' },
      { slug: 'espeon', name: 'Espeon' },
      { slug: 'umbreon', name: 'Umbreon' },
      { slug: 'mudkip', name: 'Mudkip' },
      { slug: 'torchic', name: 'Torchic' },
      { slug: 'treecko', name: 'Treecko' },
      { slug: 'squirtle', name: 'Squirtle' },
      { slug: 'charmander', name: 'Charmander' },
      { slug: 'bulbasaur', name: 'Bulbasaur' },
      { slug: 'riolu', name: 'Riolu' },
      { slug: 'shinx', name: 'Shinx' }
    ];

    const partyModal = document.getElementById('partyModal');
    const partyModalGrid = document.getElementById('partyModalGrid');
    const btnPartyAdd = document.getElementById('btnPartyAdd');
    const btnClosePartyModal = document.getElementById('btnClosePartyModal');
    const btnPartyReset = document.getElementById('btnPartyReset');
    const btnPartyShuffle = document.getElementById('btnPartyShuffle');
    const btnPanelSound = document.getElementById('btnPanelSound');

    function renderPartyModal() {
      if (!partyModalGrid) return;
      partyModalGrid.innerHTML = '';

      const availableSlugs = new Set();
      if (currentState && currentState.unlockedIds) {
        currentState.unlockedIds.forEach(id => availableSlugs.add(id));
      }
      POPULAR_WALKERS.forEach(p => availableSlugs.add(p.slug));

      availableSlugs.forEach(slug => {
        const item = document.createElement('div');
        item.className = 'party-picker-item';
        const fSize = getFrameSize(slug);

        const thumb = document.createElement('div');
        thumb.className = 'party-picker-thumb';
        thumb.style.backgroundImage = 'url("' + SPRITES_BASE_URI + '/' + slug + '.png")';
        thumb.style.backgroundPosition = '0px -' + (fSize * 8) + 'px';
        thumb.style.width = fSize + 'px';
        thumb.style.height = fSize + 'px';
        thumb.style.backgroundSize = (fSize * 4) + 'px ' + (fSize * 12) + 'px';

        const name = document.createElement('div');
        name.className = 'party-picker-name';
        name.innerText = slug.charAt(0).toUpperCase() + slug.slice(1);

        item.appendChild(thumb);
        item.appendChild(name);

        item.addEventListener('click', () => {
          const currentParty = (currentState && currentState.walkingParty) || [];
          if (currentParty.length >= 6) {
            showBanner('PARTY FULL', 'Max 6 Pokémon can walk at once!', 2000);
            return;
          }
          vscode.postMessage({ type: 'ADD_TO_WALKING_PARTY', pokemonSlug: slug });
          partyModal.style.display = 'none';
          showBanner('POKÉMON JOINED!', name.innerText + ' joined the squad! 🐾', 2000);
        });

        partyModalGrid.appendChild(item);
      });
    }

    if (btnPartyAdd) {
      btnPartyAdd.addEventListener('click', () => {
        renderPartyModal();
        partyModal.style.display = 'flex';
      });
    }

    if (btnClosePartyModal) {
      btnClosePartyModal.addEventListener('click', () => {
        partyModal.style.display = 'none';
      });
    }

    if (btnPartyReset) {
      btnPartyReset.addEventListener('click', () => {
        vscode.postMessage({ type: 'RESET_WALKING_PARTY' });
        showBanner('SQUAD RESET', 'Walking squad reset to ' + (currentState ? currentState.activePokemonName : 'active companion'), 2000);
      });
    }

    if (btnPartyShuffle) {
      btnPartyShuffle.addEventListener('click', () => {
        activeWalkers.forEach(w => w.cheer());
      });
    }

    if (btnPanelSound) {
      btnPanelSound.addEventListener('click', () => {
        isMuted = !isMuted;
        btnPanelSound.innerText = isMuted ? '🔇' : '🔊';
        vscode.postMessage({ type: 'TOGGLE_SOUND', enabled: !isMuted });
      });
    }

    const btnToggleDeck = document.getElementById('btnToggleDeck');
    if (btnToggleDeck) {
      btnToggleDeck.addEventListener('click', () => {
        document.body.classList.toggle('show-controls');
        const isShowing = document.body.classList.contains('show-controls');
        btnToggleDeck.classList.toggle('active', isShowing);
        if (isShowing) {
          viewportCard.style.height = '240px';
        } else {
          viewportCard.style.height = 'calc(100vh - 36px)';
        }
        redrawBg();
      });
    }

    // Apply Initial State Immediately
    applyState(INITIAL_STATE);

    // Notify Extension Host
    vscode.postMessage({ type: 'INIT_STATE' });
  </script>
</body>
</html>`;
  }
}

