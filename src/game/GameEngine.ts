import * as THREE from 'three';
import { CarConfig, GameStats, CashMission, RoadTheme, GlobalUpgrades } from '../types/game';
import { sound } from '../audio/sound';
import { INITIAL_MISSIONS, INITIAL_ROAD_THEMES, INITIAL_UPGRADES } from '../data/cars';

interface TrafficCar {
  group: THREE.Group;
  lane: number;
  speed: number;
  isPolice: boolean;
  policeLights?: { r: THREE.PointLight; b: THREE.PointLight };
  passed: boolean;
  cycle: number;
  width: number;
  length: number;
}

interface CashPickup {
  group: THREE.Group;
  type: 'cash_bundle' | 'gold_coin' | 'nitro' | 'shield';
  lane: number;
  z: number;
  value: number;
  active: boolean;
  magnetSoundPlayed?: boolean;
}

interface Debris {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  rotVel: THREE.Vector3;
  life: number;
}

export class GameEngine {
  private canvas: HTMLCanvasElement;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private clock: THREE.Clock;
  private reqId: number | null = null;

  // Active Car, Theme & Upgrades
  private activeCar: CarConfig;
  private currentTheme: RoadTheme;
  private upgrades: GlobalUpgrades;

  // Visual Groups
  private playerGroup: THREE.Group | null = null;
  private shieldMesh: THREE.Mesh | null = null;
  private leftExhaust: THREE.Mesh | null = null;
  private rightExhaust: THREE.Mesh | null = null;
  private underglowLight: THREE.PointLight | null = null;

  // Environment Meshes
  private roadMesh: THREE.Mesh | null = null;
  private roadLines: THREE.Mesh[] = [];
  private guardrails: THREE.Mesh[] = [];
  private buildings: THREE.Group[] = [];
  private stars: THREE.Points | null = null;
  private weatherParticles: THREE.Points | null = null;
  private weatherPositions: Float32Array | null = null;

  // Lights
  private ambientLight: THREE.AmbientLight | null = null;
  private dirLightA: THREE.DirectionalLight | null = null;
  private dirLightB: THREE.DirectionalLight | null = null;

  // Gameplay State
  public isRunning = false;
  public isPaused = false;
  public isBoosting = false;

  private lane = 0; // -2, -1, 0, 1, 2
  private targetX = 0;
  private readonly laneWidth = 3.2;

  // Metrics
  public score = 0;
  public distance = 0;
  public speed = 140;
  public maxSpeedAchieved = 140;
  public nitro = 100;
  public shields = 1;
  public maxShields = 1;
  public combo = 1;
  public comboTimer = 0;
  public nearMisses = 0;
  public cashCollectedThisRun = 0;

  // Police & Spawns
  public policeActive = false;
  private policeTimer = 0;
  private spawnTimer = 0;
  private pickupTimer = 0;
  private cameraShake = 0;
  private invulnerableTimer = 0;

  // Mission
  public activeMissionIndex = 0;
  public missions: CashMission[] = [...INITIAL_MISSIONS];

  // Entities
  private traffic: TrafficCar[] = [];
  private pickups: CashPickup[] = [];
  private debrisList: Debris[] = [];

  // Callbacks
  private onStatsUpdate: (stats: GameStats) => void;
  private onCrash: () => void;
  private onCashCollected: (amount: number, label: string) => void;
  private onNearMissOvertake: (combo: number, bonusTaka: number) => void;
  private onMissionComplete: (mission: CashMission) => void;

  constructor(
    canvas: HTMLCanvasElement,
    car: CarConfig,
    theme: RoadTheme = INITIAL_ROAD_THEMES[0],
    upgrades: GlobalUpgrades = INITIAL_UPGRADES,
    callbacks: {
      onStatsUpdate: (stats: GameStats) => void;
      onCrash: () => void;
      onCashCollected: (amount: number, label: string) => void;
      onNearMissOvertake: (combo: number, bonusTaka: number) => void;
      onMissionComplete: (mission: CashMission) => void;
    }
  ) {
    this.canvas = canvas;
    this.activeCar = car;
    this.currentTheme = theme;
    this.upgrades = upgrades;

    this.maxShields = car.maxShields + (this.upgrades.shieldLevel - 1);
    this.shields = this.maxShields;

    this.onStatsUpdate = callbacks.onStatsUpdate;
    this.onCrash = callbacks.onCrash;
    this.onCashCollected = callbacks.onCashCollected;
    this.onNearMissOvertake = callbacks.onNearMissOvertake;
    this.onMissionComplete = callbacks.onMissionComplete;

    this.clock = new THREE.Clock();
    this.scene = new THREE.Scene();

    this.camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 1500);
    this.camera.position.set(0, 4.8, 9.8);
    this.camera.rotation.x = -0.22;

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    this.setupLighting();
    this.buildSky();
    this.buildRoad();
    this.buildCity();
    this.buildWeatherParticles();
    this.buildPlayerCar();

    this.applyTheme();

    window.addEventListener('resize', this.onResize);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);

    this.animate();
  }

  public updateCar(newCar: CarConfig) {
    this.activeCar = newCar;
    this.maxShields = newCar.maxShields + (this.upgrades.shieldLevel - 1);
    this.shields = Math.min(this.shields, this.maxShields);
    this.buildPlayerCar();
  }

  public updateTheme(newTheme: RoadTheme) {
    this.currentTheme = newTheme;
    this.applyTheme();
  }

  public updateUpgrades(newUpgrades: GlobalUpgrades) {
    this.upgrades = newUpgrades;
    this.maxShields = this.activeCar.maxShields + (this.upgrades.shieldLevel - 1);
    this.shields = Math.min(this.shields, this.maxShields);
  }

  public updateUnderglow(colorHex: string) {
    this.activeCar.underglow = colorHex;
    if (this.underglowLight) {
      this.underglowLight.color.set(colorHex);
    }
  }

  private setupLighting() {
    this.ambientLight = new THREE.AmbientLight(this.currentTheme.ambientLight, 1.2);
    this.scene.add(this.ambientLight);

    this.dirLightA = new THREE.DirectionalLight(this.currentTheme.dirLightA, 1.4);
    this.dirLightA.position.set(60, 90, -80);
    this.scene.add(this.dirLightA);

    this.dirLightB = new THREE.DirectionalLight(this.currentTheme.dirLightB, 1.2);
    this.dirLightB.position.set(-60, 70, -60);
    this.scene.add(this.dirLightB);
  }

  private applyTheme() {
    this.scene.background = new THREE.Color(this.currentTheme.fogColor);
    this.scene.fog = new THREE.FogExp2(this.currentTheme.fogColor, this.currentTheme.fogDensity);

    if (this.ambientLight) this.ambientLight.color.setHex(this.currentTheme.ambientLight);
    if (this.dirLightA) this.dirLightA.color.setHex(this.currentTheme.dirLightA);
    if (this.dirLightB) this.dirLightB.color.setHex(this.currentTheme.dirLightB);

    if (this.roadMesh) {
      (this.roadMesh.material as THREE.MeshStandardMaterial).color.setHex(this.currentTheme.roadColor);
    }

    this.guardrails.forEach((rail, idx) => {
      (rail.material as THREE.MeshBasicMaterial).color.setHex(
        idx % 2 === 0 ? this.currentTheme.guardrailColorA : this.currentTheme.guardrailColorB
      );
    });

    this.roadLines.forEach((line, idx) => {
      (line.material as THREE.MeshBasicMaterial).color.setHex(
        idx % 2 === 0 ? this.currentTheme.lineColorA : this.currentTheme.lineColorB
      );
    });

    this.buildWeatherParticles();
  }

  private buildSky() {
    const starCount = 1200;
    const geom = new THREE.BufferGeometry();
    const pos = new Float32Array(starCount * 3);

    for (let i = 0; i < starCount * 3; i += 3) {
      pos[i] = (Math.random() - 0.5) * 1000;
      pos[i + 1] = 20 + Math.random() * 300;
      pos[i + 2] = -150 - Math.random() * 1100;
    }

    geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(
      geom,
      new THREE.PointsMaterial({ color: 0x8ceeff, size: 0.75, transparent: true, opacity: 0.8 })
    );
    this.scene.add(this.stars);

    // Retro Sun / Cyber Orb
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const grad = ctx.createLinearGradient(0, 0, 0, 512);
      grad.addColorStop(0, '#c2f9ff');
      grad.addColorStop(0.3, '#00eaff');
      grad.addColorStop(0.65, '#9d4edd');
      grad.addColorStop(1, '#ff0077');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 1024, 512);

      for (let y = 260; y < 512; y += 18) {
        ctx.fillStyle = 'rgba(2, 5, 15, 0.85)';
        ctx.fillRect(0, y, 1024, 7);
      }
    }

    const moonTex = new THREE.CanvasTexture(canvas);
    const moon = new THREE.Mesh(
      new THREE.CircleGeometry(110, 64),
      new THREE.MeshBasicMaterial({ map: moonTex, transparent: true, opacity: 0.95 })
    );
    moon.position.set(0, 65, -550);
    this.scene.add(moon);
  }

  private buildWeatherParticles() {
    if (this.weatherParticles) {
      this.scene.remove(this.weatherParticles);
      this.weatherParticles = null;
      this.weatherPositions = null;
    }

    const weather = this.currentTheme.weather;
    if (!weather || weather === 'none') return;

    const count = weather === 'rain' ? 800 : weather === 'embers' ? 500 : 700;
    const geom = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);

    for (let i = 0; i < count * 3; i += 3) {
      pos[i] = (Math.random() - 0.5) * 45;
      pos[i + 1] = Math.random() * 25;
      pos[i + 2] = -Math.random() * 220;
    }

    geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.weatherPositions = pos;

    const pColor = weather === 'rain' ? 0x38bdf8 : weather === 'embers' ? 0xf97316 : 0xa855f7;
    const pSize = weather === 'rain' ? 0.35 : weather === 'embers' ? 0.45 : 0.6;

    this.weatherParticles = new THREE.Points(
      geom,
      new THREE.PointsMaterial({
        color: pColor,
        size: pSize,
        transparent: true,
        opacity: 0.75,
      })
    );
    this.scene.add(this.weatherParticles);
  }

  private buildRoad() {
    const length = 1500;
    this.roadMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(30, length),
      new THREE.MeshStandardMaterial({
        color: this.currentTheme.roadColor,
        roughness: 0.35,
        metalness: 0.8,
      })
    );
    this.roadMesh.rotation.x = -Math.PI / 2;
    this.roadMesh.position.set(0, 0, -length / 2 + 100);
    this.scene.add(this.roadMesh);

    // Guardrails
    [-1, 1].forEach((side, idx) => {
      const rail = new THREE.Mesh(
        new THREE.BoxGeometry(0.35, 0.65, length),
        new THREE.MeshBasicMaterial({
          color: idx === 0 ? this.currentTheme.guardrailColorA : this.currentTheme.guardrailColorB,
        })
      );
      rail.position.set(side * 14, 0.35, -length / 2 + 100);
      this.scene.add(rail);
      this.guardrails.push(rail);
    });

    // 5-lane dividers
    const dividers = [-6.4, -3.2, 0, 3.2, 6.4];
    for (let z = -length + 100; z < 100; z += 12) {
      dividers.slice(0, 4).forEach((x, i) => {
        const line = new THREE.Mesh(
          new THREE.BoxGeometry(0.16, 0.04, 5.2),
          new THREE.MeshBasicMaterial({
            color: i % 2 === 0 ? this.currentTheme.lineColorA : this.currentTheme.lineColorB,
          })
        );
        line.position.set(x + 1.6, 0.04, z);
        this.scene.add(line);
        this.roadLines.push(line);
      });
    }

    // Street Lamps
    for (let z = -1200; z < 100; z += 35) {
      [-1, 1].forEach((side, idx) => {
        const color = idx === 0 ? this.currentTheme.lineColorA : this.currentTheme.lineColorB;
        const pole = new THREE.Mesh(
          new THREE.CylinderGeometry(0.08, 0.08, 5.5, 8),
          new THREE.MeshBasicMaterial({ color })
        );
        pole.position.set(side * 15, 2.75, z);
        this.scene.add(pole);

        const lamp = new THREE.Mesh(
          new THREE.SphereGeometry(0.24, 8, 8),
          new THREE.MeshBasicMaterial({ color })
        );
        lamp.position.set(side * 15, 5.5, z);
        this.scene.add(lamp);
      });
    }
  }

  private buildCity() {
    for (let z = -1200; z < 100; z += 30) {
      [-1, 1].forEach((side) => {
        const h = 30 + Math.random() * 120;
        const w = 10 + Math.random() * 18;
        const d = 12 + Math.random() * 20;
        const group = new THREE.Group();

        const b = new THREE.Mesh(
          new THREE.BoxGeometry(w, h, d),
          new THREE.MeshStandardMaterial({
            color: 0x040816,
            emissive: side < 0 ? 0x120018 : 0x001420,
            emissiveIntensity: 0.35,
            roughness: 0.4,
          })
        );
        b.position.y = h / 2;
        group.add(b);

        for (let y = 6; y < h; y += 8) {
          const strip = new THREE.Mesh(
            new THREE.BoxGeometry(w * 0.75, 0.22, 0.1),
            new THREE.MeshBasicMaterial({
              color: Math.random() > 0.5 ? 0x00eaff : 0xff0077,
              transparent: true,
              opacity: 0.65,
            })
          );
          strip.position.set(0, y, -d / 2 - 0.06);
          group.add(strip);
        }

        group.position.set(side * (26 + Math.random() * 30), 0, z + Math.random() * 10);
        this.scene.add(group);
        this.buildings.push(group);
      });
    }
  }

  private buildPlayerCar() {
    if (this.playerGroup) {
      this.scene.remove(this.playerGroup);
    }

    const group = new THREE.Group();

    // Body
    const bodyGeom = new THREE.BoxGeometry(1.7, 0.65, 3.8);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: this.activeCar.bodyColor,
      metalness: 0.85,
      roughness: 0.2,
    });
    const body = new THREE.Mesh(bodyGeom, bodyMat);
    body.position.y = 0.55;
    group.add(body);

    // Cockpit / Canopy
    const cabGeom = new THREE.BoxGeometry(1.25, 0.45, 1.8);
    const cabMat = new THREE.MeshStandardMaterial({
      color: 0x0a1220,
      roughness: 0.1,
      metalness: 0.9,
    });
    const cab = new THREE.Mesh(cabGeom, cabMat);
    cab.position.set(0, 0.98, -0.2);
    group.add(cab);

    // Front Neon Headlights
    [-0.6, 0.6].forEach((x) => {
      const hl = new THREE.Mesh(
        new THREE.BoxGeometry(0.3, 0.12, 0.15),
        new THREE.MeshBasicMaterial({ color: 0x00ffff })
      );
      hl.position.set(x, 0.6, -1.9);
      group.add(hl);
    });

    // Rear Neon Taillights
    const tl = new THREE.Mesh(
      new THREE.BoxGeometry(1.5, 0.1, 0.1),
      new THREE.MeshBasicMaterial({ color: 0xff0044 })
    );
    tl.position.set(0, 0.68, 1.9);
    group.add(tl);

    // 4 Wheels
    const wheelGeom = new THREE.CylinderGeometry(0.36, 0.36, 0.26, 16);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111116, roughness: 0.6 });
    const wheelPositions = [
      [-0.92, 0.36, -1.2],
      [0.92, 0.36, -1.2],
      [-0.92, 0.36, 1.2],
      [0.92, 0.36, 1.2],
    ];

    wheelPositions.forEach(([x, y, z]) => {
      const w = new THREE.Mesh(wheelGeom, wheelMat);
      w.rotation.z = Math.PI / 2;
      w.position.set(x, y, z);
      group.add(w);
    });

    // Underglow Neon Light
    this.underglowLight = new THREE.PointLight(this.activeCar.underglow, 2.5, 6);
    this.underglowLight.position.set(0, 0.15, 0);
    group.add(this.underglowLight);

    // Dual Exhaust Nitro Jets
    const exhGeom = new THREE.CylinderGeometry(0.08, 0.2, 1.2, 8);
    const exhMat = new THREE.MeshBasicMaterial({ color: 0x00ffff });

    this.leftExhaust = new THREE.Mesh(exhGeom, exhMat);
    this.leftExhaust.rotation.x = Math.PI / 2;
    this.leftExhaust.position.set(-0.4, 0.45, 2.4);
    this.leftExhaust.visible = false;
    group.add(this.leftExhaust);

    this.rightExhaust = new THREE.Mesh(exhGeom, exhMat);
    this.rightExhaust.rotation.x = Math.PI / 2;
    this.rightExhaust.position.set(0.4, 0.45, 2.4);
    this.rightExhaust.visible = false;
    group.add(this.rightExhaust);

    // Protective Shield Sphere
    const shieldGeom = new THREE.SphereGeometry(2.3, 24, 24);
    const shieldMat = new THREE.MeshBasicMaterial({
      color: 0x00eaff,
      transparent: true,
      opacity: 0.25,
      wireframe: true,
    });
    this.shieldMesh = new THREE.Mesh(shieldGeom, shieldMat);
    this.shieldMesh.position.y = 0.6;
    this.shieldMesh.visible = this.shields > 0;
    group.add(this.shieldMesh);

    group.position.set(0, 0, 3);
    this.scene.add(group);
    this.playerGroup = group;
  }

  // --- TRAFFIC SPAWNER ---
  private spawnTraffic() {
    const lane = Math.floor(Math.random() * 5) - 2;
    const isPolice = !this.policeActive && Math.random() < 0.18;
    const group = new THREE.Group();

    const color = isPolice ? 0x050508 : Math.random() > 0.5 ? 0xff0055 : 0x00ccff;
    const w = 1.7;
    const h = 0.65;
    const l = 3.6;

    const body = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, l),
      new THREE.MeshStandardMaterial({ color, metalness: 0.8, roughness: 0.3 })
    );
    body.position.y = 0.55;
    group.add(body);

    // Wheels
    const wheelGeom = new THREE.CylinderGeometry(0.34, 0.34, 0.22, 12);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111116 });
    [[-0.9, 0.34, -1.1], [0.9, 0.34, -1.1], [-0.9, 0.34, 1.1], [0.9, 0.34, 1.1]].forEach(([x, y, z]) => {
      const wh = new THREE.Mesh(wheelGeom, wheelMat);
      wh.rotation.z = Math.PI / 2;
      wh.position.set(x, y, z);
      group.add(wh);
    });

    let lights: { r: THREE.PointLight; b: THREE.PointLight } | undefined;
    if (isPolice) {
      const redLight = new THREE.PointLight(0xff0000, 2.5, 10);
      redLight.position.set(-0.35, 1.1, 0);
      group.add(redLight);

      const blueLight = new THREE.PointLight(0x0055ff, 2.5, 10);
      blueLight.position.set(0.35, 1.1, 0);
      group.add(blueLight);

      lights = { r: redLight, b: blueLight };
    }

    group.position.set(lane * this.laneWidth, 0, -260);
    this.scene.add(group);

    this.traffic.push({
      group,
      lane,
      speed: 70 + Math.random() * 45,
      isPolice,
      policeLights: lights,
      passed: false,
      cycle: 0,
      width: w,
      length: l,
    });
  }

  // --- CASH PICKUP SPAWNER ---
  private spawnCashPickup() {
    const lane = Math.floor(Math.random() * 5) - 2;
    const group = new THREE.Group();

    const roll = Math.random();
    let type: CashPickup['type'] = 'cash_bundle';
    let value = 500;

    if (roll < 0.45) {
      // ৳ 500 Bundle
      type = 'cash_bundle';
      value = 500;
      const bundle = new THREE.Mesh(
        new THREE.BoxGeometry(0.85, 0.28, 1.3),
        new THREE.MeshStandardMaterial({ color: 0x00e676, roughness: 0.3, emissive: 0x004d20 })
      );
      group.add(bundle);
    } else if (roll < 0.75) {
      // ৳ 200 Gold Coin
      type = 'gold_coin';
      value = 200;
      const coin = new THREE.Mesh(
        new THREE.CylinderGeometry(0.48, 0.48, 0.16, 20),
        new THREE.MeshStandardMaterial({ color: 0xffd700, metalness: 0.9, roughness: 0.1 })
      );
      coin.rotation.x = Math.PI / 2;
      group.add(coin);
    } else if (roll < 0.90) {
      // Nitro Refill
      type = 'nitro';
      value = 100;
      const canister = new THREE.Mesh(
        new THREE.CylinderGeometry(0.35, 0.35, 1.1, 16),
        new THREE.MeshBasicMaterial({ color: 0x00ffff })
      );
      group.add(canister);
    } else {
      // Shield Battery
      type = 'shield';
      value = 150;
      const shield = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.55),
        new THREE.MeshBasicMaterial({ color: 0x3b82f6, wireframe: true })
      );
      group.add(shield);
    }

    group.position.set(lane * this.laneWidth, 0.9, -240);
    this.scene.add(group);

    this.pickups.push({
      group,
      type,
      lane,
      z: -240,
      value,
      active: true,
    });
  }

  // --- CONTROLS ---
  public moveLeft() {
    if (!this.isRunning || this.isPaused) return;
    if (this.lane > -2) {
      this.lane--;
      this.targetX = this.lane * this.laneWidth;
      sound.playTurn(true);
      sound.vibrate(20);
    }
  }

  public moveRight() {
    if (!this.isRunning || this.isPaused) return;
    if (this.lane < 2) {
      this.lane++;
      this.targetX = this.lane * this.laneWidth;
      sound.playTurn(false);
      sound.vibrate(20);
    }
  }

  public setBoost(boosting: boolean) {
    if (!this.isRunning || this.isPaused) return;
    if (boosting && this.nitro > 10) {
      this.isBoosting = true;
    } else {
      this.isBoosting = false;
    }
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (!e || typeof e.key !== 'string') return;
    const k = e.key.toLowerCase();
    if (e.key === 'ArrowLeft' || k === 'a') {
      this.moveLeft();
    } else if (e.key === 'ArrowRight' || k === 'd') {
      this.moveRight();
    } else if (e.key === 'ArrowUp' || k === 'w' || e.key === 'Shift') {
      this.setBoost(true);
    } else if (e.key === 'Escape' || e.key === ' ') {
      e.preventDefault();
      this.togglePause();
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    if (!e || typeof e.key !== 'string') return;
    const k = e.key.toLowerCase();
    if (e.key === 'ArrowUp' || k === 'w' || e.key === 'Shift') {
      this.setBoost(false);
    }
  };

  public togglePause() {
    if (!this.isRunning) return;
    this.isPaused = !this.isPaused;
    if (this.isPaused) {
      this.isBoosting = false;
      sound.stopEngine();
    } else {
      sound.startEngine();
    }
  }

  // --- MISSION PROGRESS ---
  private checkMissionProgress(type: CashMission['type'], amount: number) {
    const mission = this.missions[this.activeMissionIndex];
    if (mission && mission.type === type) {
      mission.progress += amount;
      if (mission.progress >= mission.target) {
        this.cashCollectedThisRun += mission.rewardTaka;
        this.onMissionComplete(mission);

        this.activeMissionIndex = (this.activeMissionIndex + 1) % this.missions.length;
        this.missions[this.activeMissionIndex].progress = 0;
      }
    }
  }

  // --- START & RESET ---
  public start() {
    this.isRunning = true;
    this.isPaused = false;
    this.isBoosting = false;

    this.score = 0;
    this.distance = 0;
    this.speed = 140;
    this.maxSpeedAchieved = 140;
    this.nitro = 100;
    this.shields = this.activeCar.maxShields + (this.upgrades.shieldLevel - 1);
    this.maxShields = this.shields;
    this.combo = 1;
    this.comboTimer = 0;
    this.nearMisses = 0;
    this.cashCollectedThisRun = 0;

    this.lane = 0;
    this.targetX = 0;
    this.spawnTimer = 0;
    this.pickupTimer = 0;
    this.policeTimer = 0;
    this.policeActive = false;
    this.invulnerableTimer = 0;

    this.traffic.forEach((t) => this.scene.remove(t.group));
    this.traffic = [];
    this.pickups.forEach((p) => this.scene.remove(p.group));
    this.pickups = [];
    this.debrisList.forEach((d) => this.scene.remove(d.mesh));
    this.debrisList = [];

    if (this.playerGroup) {
      this.playerGroup.position.set(0, 0, 3);
      this.playerGroup.rotation.set(0, 0, 0);
      this.playerGroup.visible = true;
    }
    if (this.shieldMesh) this.shieldMesh.visible = this.shields > 0;

    sound.startEngine();
    sound.startMusic();
  }

  public stop() {
    this.isRunning = false;
    this.isPaused = false;
    this.isBoosting = false;
    sound.stopEngine();
    sound.stopMusic();
  }

  private triggerCrash() {
    if (!this.isRunning) return;

    if (this.shields > 0) {
      this.shields--;
      if (this.shieldMesh) this.shieldMesh.visible = this.shields > 0;
      this.cameraShake = 0.85;
      this.invulnerableTimer = 1.0;
      sound.playCrash();
      sound.vibrate(100);
      return;
    }

    // Vehicle Destroyed
    this.isRunning = false;
    this.isBoosting = false;
    this.cameraShake = 1.4;
    sound.playCrash();
    sound.vibrate(260);

    if (this.playerGroup) {
      this.playerGroup.visible = false;
    }

    setTimeout(() => {
      this.onCrash();
    }, 650);
  }

  // --- UPDATE LOOP ---
  private update(dt: number) {
    if (this.invulnerableTimer > 0) {
      this.invulnerableTimer -= dt;
      if (this.playerGroup) {
        this.playerGroup.visible = Math.floor(performance.now() / 80) % 2 === 0;
      }
    } else if (this.playerGroup) {
      this.playerGroup.visible = true;
    }

    // Global Upgrades calculation
    const engineUpgradeBonus = (this.upgrades.engineLevel - 1) * 16;
    const nitroUpgradeBonus = (this.upgrades.nitroLevel - 1) * 18;
    const baseTop = this.activeCar.topSpeed + engineUpgradeBonus;
    const boostPower = this.activeCar.nitroBoost + nitroUpgradeBonus;

    const difficulty = Math.min(2.5, 1 + this.distance / 2800);
    let targetSpeed = baseTop * (0.68 + 0.32 * difficulty);

    if (this.isBoosting && this.nitro > 0) {
      targetSpeed += boostPower;
      const drainRate = Math.max(16, 36 - (this.upgrades.nitroLevel - 1) * 4);
      this.nitro = Math.max(0, this.nitro - dt * drainRate);
      if (this.nitro <= 0) this.isBoosting = false;
    } else {
      const chargeRate = 3.0 + (this.upgrades.nitroLevel - 1) * 0.8;
      this.nitro = Math.min(100, this.nitro + dt * chargeRate);
    }

    this.speed += (targetSpeed - this.speed) * Math.min(1, dt * (this.isBoosting ? 4.8 : 2.2));
    this.maxSpeedAchieved = Math.max(this.maxSpeedAchieved, this.speed);
    sound.updateEngine(this.speed / 380, this.isBoosting);

    if (this.leftExhaust && this.rightExhaust) {
      this.leftExhaust.visible = this.isBoosting;
      this.rightExhaust.visible = this.isBoosting;
    }

    const forward = this.speed * 0.26 * dt;
    this.distance += forward;
    this.checkMissionProgress('distance', forward);

    this.score += this.speed * 0.18 * (this.isBoosting ? 2.4 : 1.0) * dt * this.combo;

    // Combo Timer
    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) this.combo = 1;
    }

    // Police pursuit check
    this.policeTimer += dt;
    if (!this.policeActive && this.policeTimer > 28) {
      this.policeActive = true;
      this.policeTimer = 0;
      sound.playSiren();
    } else if (this.policeActive && this.policeTimer > 22) {
      this.policeActive = false;
      this.policeTimer = 0;
    }

    // Steering
    if (this.playerGroup) {
      const dx = this.targetX - this.playerGroup.position.x;
      this.playerGroup.position.x += dx * Math.min(1, dt * 13.5);
      this.playerGroup.rotation.z = -dx * 0.07;
    }

    // Road scroll
    const roadMovement = (this.speed * 0.065 + 12) * dt;
    this.roadLines.forEach((line) => {
      line.position.z += roadMovement;
      if (line.position.z > 25) line.position.z -= 1400;
    });

    this.buildings.forEach((b) => {
      b.position.z += roadMovement * 0.85;
      if (b.position.z > 60) b.position.z -= 1300;
    });

    // Weather particle animation
    if (this.weatherParticles && this.weatherPositions) {
      const weather = this.currentTheme.weather;
      const count = this.weatherPositions.length / 3;

      for (let i = 0; i < count; i++) {
        const idx = i * 3;
        if (weather === 'rain') {
          this.weatherPositions[idx + 1] -= dt * 160;
          this.weatherPositions[idx + 2] += roadMovement * 0.9;
          if (this.weatherPositions[idx + 1] < 0) {
            this.weatherPositions[idx + 1] = 22 + Math.random() * 5;
            this.weatherPositions[idx + 2] = -Math.random() * 220;
          }
        } else if (weather === 'embers') {
          this.weatherPositions[idx + 1] += dt * 12;
          this.weatherPositions[idx] += Math.sin(performance.now() * 0.002 + i) * dt * 3;
          if (this.weatherPositions[idx + 1] > 25) {
            this.weatherPositions[idx + 1] = 0;
            this.weatherPositions[idx + 2] = -Math.random() * 220;
          }
        } else if (weather === 'warp_stars') {
          this.weatherPositions[idx + 2] += (this.speed * 0.28 + 20) * dt;
          if (this.weatherPositions[idx + 2] > 20) {
            this.weatherPositions[idx + 2] = -240;
            this.weatherPositions[idx] = (Math.random() - 0.5) * 50;
            this.weatherPositions[idx + 1] = Math.random() * 25;
          }
        }
      }
      this.weatherParticles.geometry.attributes.position.needsUpdate = true;
    }

    // Spawners
    this.spawnTimer += dt;
    const spawnInterval = Math.max(0.65, 1.15 - this.distance / 9000);
    if (this.spawnTimer > spawnInterval) {
      this.spawnTraffic();
      this.spawnTimer = 0;
    }

    this.pickupTimer += dt;
    if (this.pickupTimer > 2.6) {
      this.spawnCashPickup();
      this.pickupTimer = 0;
    }

    // Camera follow & shake
    if (this.cameraShake > 0) {
      this.cameraShake -= dt * 2.8;
      const shakeAmt = Math.max(0, this.cameraShake) * 0.45;
      this.camera.position.x = (Math.random() - 0.5) * shakeAmt;
      this.camera.position.y = 4.8 + (Math.random() - 0.5) * shakeAmt;
    } else {
      this.camera.position.x = (this.playerGroup?.position.x || 0) * 0.25;
      this.camera.position.y = 4.8;
    }

    const px = this.playerGroup?.position.x || 0;
    const pz = this.playerGroup?.position.z || 3;

    // Traffic Update
    for (let i = this.traffic.length - 1; i >= 0; i--) {
      const t = this.traffic[i];
      const relSpeed = (this.speed - t.speed) * 0.055 + 9;
      t.group.position.z += relSpeed * dt;

      if (t.isPolice && t.policeLights) {
        t.cycle += dt * 14;
        const phase = Math.sin(t.cycle);
        t.policeLights.r.intensity = phase > 0 ? 3.5 : 0.2;
        t.policeLights.b.intensity = phase <= 0 ? 3.5 : 0.2;
      }

      const cx = Math.abs(px - t.group.position.x);
      const cz = Math.abs(pz - t.group.position.z);

      // Risky Overtake / Near-Miss Bonus (টাকা ইনকাম!)
      if (!t.passed && t.group.position.z > pz - 2.2) {
        t.passed = true;
        if (cx > 1.6 && cx < 3.0) {
          this.combo = Math.min(8, this.combo + 1);
          this.comboTimer = 3.8;
          this.nearMisses++;
          this.nitro = Math.min(100, this.nitro + 16);

          const multiplierBonus = 1 + (this.upgrades.multiplierLevel - 1) * 0.25;
          const bonusTaka = Math.floor(150 * this.combo * multiplierBonus);
          this.cashCollectedThisRun += bonusTaka;
          this.score += 350 * this.combo;

          sound.playNearMiss();
          this.checkMissionProgress('near_miss', 1);
          this.onNearMissOvertake(this.combo, bonusTaka);
        }
      }

      // Collision
      if (this.invulnerableTimer <= 0 && cx < 1.95 && cz < 3.9) {
        this.triggerCrash();
        break;
      }

      if (t.group.position.z > 30) {
        this.scene.remove(t.group);
        this.traffic.splice(i, 1);
      }
    }

    // Cash Magnet range calculation
    const magnetRadius = 3.5 + this.upgrades.magnetLevel * 3.5; // up to 21 meters!

    // Update Cash & Powerups
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
      p.group.position.z += roadMovement;
      p.group.rotation.y += dt * 3.5;

      // Cash Magnet attraction
      if (this.playerGroup && p.active && (p.type === 'cash_bundle' || p.type === 'gold_coin')) {
        const pPos = p.group.position;
        const playerPos = this.playerGroup.position;
        const dist = playerPos.distanceTo(pPos);

        if (dist < magnetRadius) {
          const dir = new THREE.Vector3().subVectors(playerPos, pPos).normalize();
          const pullSpeed = Math.max(16, (magnetRadius - dist) * 7 + 12);
          p.group.position.addScaledVector(dir, pullSpeed * dt);

          if (!p.magnetSoundPlayed) {
            p.magnetSoundPlayed = true;
            sound.playMagnet();
          }
        }
      }

      // Pickup Hit Check
      if (this.playerGroup && p.active && this.playerGroup.position.distanceTo(p.group.position) < 2.5) {
        p.active = false;

        const multiplierBonus = 1 + (this.upgrades.multiplierLevel - 1) * 0.25;
        const finalValue = Math.floor(p.value * multiplierBonus);

        if (p.type === 'cash_bundle' || p.type === 'gold_coin') {
          sound.playCashCollect();
          this.cashCollectedThisRun += finalValue;
          this.score += finalValue * 2;
          this.checkMissionProgress('cash_collect', 1);
          this.onCashCollected(finalValue, p.type === 'cash_bundle' ? 'টাকার বান্ডিল' : 'সোনার কয়েন');
        } else if (p.type === 'nitro') {
          sound.tone(600, 0.1, 'sine', 0.15);
          this.nitro = 100;
          this.score += 200;
        } else if (p.type === 'shield') {
          sound.tone(500, 0.15, 'sine', 0.2);
          this.shields = Math.min(this.maxShields, this.shields + 1);
          if (this.shieldMesh) this.shieldMesh.visible = true;
          this.score += 300;
        }

        this.scene.remove(p.group);
        this.pickups.splice(i, 1);
        continue;
      }

      if (p.group.position.z > 25) {
        this.scene.remove(p.group);
        this.pickups.splice(i, 1);
      }
    }

    // Broadcast stats
    this.onStatsUpdate({
      score: Math.floor(this.score),
      distance: Math.floor(this.distance),
      speed: Math.floor(this.speed),
      maxSpeed: Math.floor(this.maxSpeedAchieved),
      nitro: Math.floor(this.nitro),
      shields: this.shields,
      maxShields: this.maxShields,
      combo: this.combo,
      comboTimer: this.comboTimer,
      policeActive: this.policeActive,
      nearMisses: this.nearMisses,
      cashCollectedThisRun: this.cashCollectedThisRun,
      activeMission: this.missions[this.activeMissionIndex],
      magnetActive: this.upgrades.magnetLevel > 1,
    });
  }

  private animate = () => {
    this.reqId = requestAnimationFrame(this.animate);
    const dt = Math.min(this.clock.getDelta(), 0.05);

    if (this.isRunning && !this.isPaused) {
      this.update(dt);
    }
    this.renderer.render(this.scene, this.camera);
  };

  private onResize = () => {
    if (!this.camera || !this.renderer) return;
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  };

  public destroy() {
    if (this.reqId !== null) cancelAnimationFrame(this.reqId);
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    sound.stopEngine();
    sound.stopMusic();
    this.renderer.dispose();
  }
}
