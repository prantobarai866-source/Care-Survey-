export interface CarConfig {
  id: string;
  name: string;
  brand: string;
  topSpeed: number; // Base KM/H
  accel: number; // 0-100
  nitroBoost: number; // extra KM/H
  maxShields: number;
  bodyColor: number;
  accentColor: number;
  underglow: string;
  priceTaka: number;
  unlocked: boolean;
  upgrades?: {
    speedLevel: number;
    nitroLevel: number;
  };
}

export interface RoadTheme {
  id: string;
  name: string;
  tagline: string;
  priceTaka: number;
  unlocked: boolean;
  roadColor: number;
  lineColorA: number;
  lineColorB: number;
  guardrailColorA: number;
  guardrailColorB: number;
  ambientLight: number;
  dirLightA: number;
  dirLightB: number;
  fogColor: number;
  fogDensity: number;
  skyType: 'cyber' | 'tokyo_rain' | 'sahara_sunset' | 'magma' | 'space';
  weather?: 'none' | 'rain' | 'embers' | 'warp_stars';
}

export interface GlobalUpgrades {
  engineLevel: number; // Level 1 to 5 (+15 km/h each)
  nitroLevel: number; // Level 1 to 5 (Boost duration & speed)
  shieldLevel: number; // Level 1 to 5 (+1 max shield point)
  magnetLevel: number; // Level 1 to 5 (Pulls money/cash bundles within 5m-18m)
  multiplierLevel: number; // Level 1 to 5 (+20% to +100% cash earnings bonus)
}

export type PowerupType = 'cash_bundle' | 'gold_coin' | 'nitro' | 'shield' | 'magnet';

export interface CashMission {
  id: string;
  title: string;
  desc: string;
  target: number;
  progress: number;
  rewardTaka: number;
  type: 'distance' | 'near_miss' | 'cash_collect';
}

export interface GameStats {
  score: number;
  distance: number;
  speed: number;
  maxSpeed: number;
  nitro: number;
  shields: number;
  maxShields: number;
  combo: number;
  comboTimer: number;
  policeActive: boolean;
  nearMisses: number;
  cashCollectedThisRun: number;
  activeMission: CashMission;
  magnetActive?: boolean;
  feverActive?: boolean;
}

export interface RunSummary {
  score: number;
  distance: number;
  maxSpeed: number;
  nearMisses: number;
  cashEarned: number;
  isNewRecord: boolean;
}
