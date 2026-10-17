export interface EvolutionTarget {
  level: number;
  slug: string;
  name: string;
  variant?: string;
  condition?: string; // e.g. 'Feed Oran Berry', 'Water Stone', etc.
}

export interface PokemonSpecies {
  id: string; // e.g. 'pikachu'
  name: string;
  slug: string;
  color?: 'shiny' | null;
  milestoneCommits: number;
  description: string;
  type: string;
  skillName?: string;
  skillType?: string;
  canFly?: boolean;
  hasWings?: boolean;
  evolvesTo?: EvolutionTarget | EvolutionTarget[];
}

export interface CompanionState {
  totalCommits: number;
  todayCommits: number;
  activePokemonId: string;
  activePokemonName: string;
  activePokemonSlug: string;
  activePokemonColor?: 'shiny' | null;
  level: number;
  exp: number;
  expToNextLevel: number;
  isEggHatched: boolean;
  eggProgress: number; // commits out of eggRequiredCommits
  eggRequiredCommits: number;
  unlockedIds: string[];
  soundEnabled: boolean;
  isSleeping: boolean;
  antiGravity: boolean;
  flyMode: boolean;
  hasWings?: boolean;
  happiness: number;
  variant?: string;
  walkingParty?: string[];
  lastCommitHash?: string;
  lastCommitMessage?: string;
}

