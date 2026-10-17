import { PokemonSpecies, EvolutionTarget } from './types';

export const POKEDEX_ROSTER: PokemonSpecies[] = [
  {
    id: 'pikachu',
    name: 'Pikachu',
    slug: 'pikachu',
    milestoneCommits: 2, // Hatches from first egg
    description: 'Electric Mouse Pokémon. Energized by active coding sessions!',
    type: 'Electric',
    canFly: false,
    hasWings: false,
    evolvesTo: {
      level: 16,
      slug: 'raichu',
      name: 'Raichu'
    }
  },
  {
    id: 'raichu',
    name: 'Raichu',
    slug: 'raichu',
    milestoneCommits: 5,
    description: 'Electric Mouse Pokémon. Discharges 100,000 volts of clean syntax!',
    type: 'Electric',
    canFly: false,
    hasWings: false
  },
  {
    id: 'eevee',
    name: 'Eevee',
    slug: 'eevee',
    milestoneCommits: 3,
    description: 'Evolution Pokémon. Adapts flexibly to any tech stack or berry fed!',
    type: 'Normal',
    canFly: false,
    hasWings: false,
    evolvesTo: [
      { level: 15, slug: 'vaporeon', name: 'Vaporeon', variant: 'water', condition: 'Oran Berry (Water)' },
      { level: 15, slug: 'jolteon', name: 'Jolteon', variant: 'electric', condition: 'Sitrus Berry (Electric)' },
      { level: 15, slug: 'flareon', name: 'Flareon', variant: 'fire', condition: 'Spicy Berry (Fire)' },
      { level: 20, slug: 'espeon', name: 'Espeon', variant: 'psychic', condition: 'Rare Candy (Day)' },
      { level: 20, slug: 'umbreon', name: 'Umbreon', variant: 'dark', condition: 'Rare Candy (Night)' }
    ]
  },
  {
    id: 'vaporeon',
    name: 'Vaporeon',
    slug: 'vaporeon',
    milestoneCommits: 8,
    description: 'Bubble Jet Pokémon. Melts seamlessly into asynchronous data streams.',
    type: 'Water',
    canFly: false,
    hasWings: false
  },
  {
    id: 'jolteon',
    name: 'Jolteon',
    slug: 'jolteon',
    milestoneCommits: 8,
    description: 'Lightning Pokémon. Accelerates CI/CD pipeline builds at light speed.',
    type: 'Electric',
    canFly: false,
    hasWings: false
  },
  {
    id: 'flareon',
    name: 'Flareon',
    slug: 'flareon',
    milestoneCommits: 8,
    description: 'Flame Pokémon. Incinerates compiler warnings and dead code.',
    type: 'Fire',
    canFly: false,
    hasWings: false
  },
  {
    id: 'espeon',
    name: 'Espeon',
    slug: 'espeon',
    milestoneCommits: 12,
    description: 'Sun Pokémon. Predicts edge cases and race conditions before they occur.',
    type: 'Psychic',
    canFly: false,
    hasWings: false
  },
  {
    id: 'umbreon',
    name: 'Umbreon',
    slug: 'umbreon',
    milestoneCommits: 12,
    description: 'Moonlight Pokémon. Excels at late-night dark-mode hacking sessions.',
    type: 'Dark',
    canFly: false,
    hasWings: false
  },
  {
    id: 'charmander',
    name: 'Charmander',
    slug: 'charmander',
    milestoneCommits: 6,
    description: 'Lizard Pokémon. Fires up during high-intensity debugging.',
    type: 'Fire',
    canFly: false,
    hasWings: false,
    evolvesTo: {
      level: 16,
      slug: 'charmeleon',
      name: 'Charmeleon'
    }
  },
  {
    id: 'charmeleon',
    name: 'Charmeleon',
    slug: 'charmeleon',
    milestoneCommits: 14,
    description: 'Flame Pokémon. Fiercely refactors legacy bottlenecks.',
    type: 'Fire',
    canFly: false,
    hasWings: false,
    evolvesTo: {
      level: 36,
      slug: 'charizard',
      name: 'Charizard'
    }
  },
  {
    id: 'charizard',
    name: 'Charizard',
    slug: 'charizard',
    milestoneCommits: 28,
    description: 'Flame Dragon Pokémon. Spreads majestic wings and commands the skies!',
    type: 'Fire / Flying',
    canFly: true,
    hasWings: true
  },
  {
    id: 'squirtle',
    name: 'Squirtle',
    slug: 'squirtle',
    milestoneCommits: 10,
    description: 'Tiny Turtle Pokémon. Shields your branches with unit tests.',
    type: 'Water',
    canFly: false,
    hasWings: false,
    evolvesTo: {
      level: 16,
      slug: 'wartortle',
      name: 'Wartortle'
    }
  },
  {
    id: 'wartortle',
    name: 'Wartortle',
    slug: 'wartortle',
    milestoneCommits: 18,
    description: 'Turtle Pokémon. Navigates deep git merge conflicts with ease.',
    type: 'Water',
    canFly: false,
    hasWings: false,
    evolvesTo: {
      level: 36,
      slug: 'blastoise',
      name: 'Blastoise'
    }
  },
  {
    id: 'blastoise',
    name: 'Blastoise',
    slug: 'blastoise',
    milestoneCommits: 30,
    description: 'Shellfish Pokémon. Blasts massive pull requests into production.',
    type: 'Water',
    canFly: false,
    hasWings: false
  },
  {
    id: 'bulbasaur',
    name: 'Bulbasaur',
    slug: 'bulbasaur',
    milestoneCommits: 15,
    description: 'Seed Pokémon. Plants seeds of clean architecture and documentation.',
    type: 'Grass',
    canFly: false,
    hasWings: false,
    evolvesTo: {
      level: 16,
      slug: 'ivysaur',
      name: 'Ivysaur'
    }
  },
  {
    id: 'ivysaur',
    name: 'Ivysaur',
    slug: 'ivysaur',
    milestoneCommits: 22,
    description: 'Seed Pokémon. Cultivates robust automated test suites.',
    type: 'Grass / Poison',
    canFly: false,
    hasWings: false,
    evolvesTo: {
      level: 36,
      slug: 'venusaur',
      name: 'Venusaur'
    }
  },
  {
    id: 'venusaur',
    name: 'Venusaur',
    slug: 'venusaur',
    milestoneCommits: 35,
    description: 'Seed Pokémon. Sunlight powers immense full-stack refactors.',
    type: 'Grass / Poison',
    canFly: false,
    hasWings: false
  },
  {
    id: 'gengar',
    name: 'Gengar',
    slug: 'gengar',
    milestoneCommits: 40,
    description: 'Shadow Pokémon. Haunts legacy codebases and banishes runtime bugs.',
    type: 'Ghost / Poison',
    canFly: false,
    hasWings: false
  },
  {
    id: 'dragonite',
    name: 'Dragonite',
    slug: 'dragonite',
    milestoneCommits: 50,
    description: 'Dragon Pokémon. Flies across multiple repos on powerful wings.',
    type: 'Dragon / Flying',
    canFly: true,
    hasWings: true
  },
  {
    id: 'mew',
    name: 'Mew',
    slug: 'mew',
    milestoneCommits: 65,
    description: 'New Species Pokémon. Possesses the DNA of all programming languages.',
    type: 'Psychic',
    canFly: false,
    hasWings: false
  },
  {
    id: 'mewtwo',
    name: 'Mewtwo',
    slug: 'mewtwo',
    milestoneCommits: 80,
    description: 'Genetic Pokémon. Born with unmatched algorithmic power.',
    type: 'Psychic',
    canFly: false,
    hasWings: false
  },
  {
    id: 'rayquaza',
    name: 'Rayquaza',
    slug: 'rayquaza',
    milestoneCommits: 95,
    description: 'Sky High Pokémon. Slithers across the ozone layer with 99.999% uptime.',
    type: 'Dragon / Flying',
    canFly: true,
    hasWings: false
  },
  {
    id: 'charizard-shiny',
    name: 'Shiny Charizard',
    slug: 'charizard',
    color: 'shiny',
    milestoneCommits: 100,
    description: 'Legendary Black Dragon. Soars with colossal midnight wings!',
    type: 'Fire / Flying',
    canFly: true,
    hasWings: true
  }
];

export const EVOLUTION_CHAIN: Record<string, EvolutionTarget | EvolutionTarget[]> = {
  pikachu: { level: 16, slug: 'raichu', name: 'Raichu' },
  eevee: [
    { level: 15, slug: 'vaporeon', name: 'Vaporeon', variant: 'water' },
    { level: 15, slug: 'jolteon', name: 'Jolteon', variant: 'electric' },
    { level: 15, slug: 'flareon', name: 'Flareon', variant: 'fire' },
    { level: 20, slug: 'espeon', name: 'Espeon', variant: 'psychic' },
    { level: 20, slug: 'umbreon', name: 'Umbreon', variant: 'dark' }
  ],
  charmander: { level: 16, slug: 'charmeleon', name: 'Charmeleon' },
  charmeleon: { level: 36, slug: 'charizard', name: 'Charizard' },
  squirtle: { level: 16, slug: 'wartortle', name: 'Wartortle' },
  wartortle: { level: 36, slug: 'blastoise', name: 'Blastoise' },
  bulbasaur: { level: 16, slug: 'ivysaur', name: 'Ivysaur' },
  ivysaur: { level: 36, slug: 'venusaur', name: 'Venusaur' }
};

/**
 * Direct coordinate lookup table into media/pokesprite.png.
 * Bypasses fragile minified scripts so every Pokémon and the Egg ALWAYS renders cleanly!
 */
export const POKEMON_SPRITE_COORDS: Record<string, { x: number; y: number }> = {
  egg: { x: 165, y: 2264 },
  bulbasaur: { x: 1, y: 1 },
  ivysaur: { x: 83, y: 1 },
  venusaur: { x: 165, y: 1 },
  charmander: { x: 329, y: 1 },
  charmeleon: { x: 411, y: 1 },
  charizard: { x: 493, y: 1 },
  squirtle: { x: 739, y: 1 },
  wartortle: { x: 821, y: 1 },
  blastoise: { x: 903, y: 1 },
  pikachu: { x: 1, y: 63 },
  raichu: { x: 165, y: 94 },
  gengar: { x: 985, y: 249 },
  eevee: { x: 821, y: 342 },
  vaporeon: { x: 903, y: 342 },
  jolteon: { x: 985, y: 342 },
  flareon: { x: 1067, y: 342 },
  espeon: { x: 165, y: 497 },
  umbreon: { x: 247, y: 497 },
  dragonite: { x: 903, y: 373 },
  mew: { x: 1231, y: 373 },
  mewtwo: { x: 985, y: 373 },
  rayquaza: { x: 247, y: 1024 }
};

export function getEvolutionTarget(
  slug: string,
  level: number,
  preferredVariant?: string
): EvolutionTarget | undefined {
  const evo = EVOLUTION_CHAIN[slug];
  if (!evo) return undefined;

  if (Array.isArray(evo)) {
    if (preferredVariant) {
      const match = evo.find(e => e.variant === preferredVariant && level >= e.level);
      if (match) return match;
    }
    return evo.find(e => level >= e.level);
  } else {
    if (level >= evo.level) {
      return evo;
    }
  }

  return undefined;
}

