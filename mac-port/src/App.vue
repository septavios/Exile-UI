<script setup lang="ts">
import { ref, onMounted } from 'vue';

interface ParsedItem {
  rarity?: string;
  name?: string;
  baseType?: string;
  itemLevel?: number;
  basePercentile?: number; // Added
  quality?: number;
  sockets?: string;
  class?: string;
  properties?: { name: string; value: string; type: number }[];
  raw: string;
  dps?: {
    phys: number;
    elem: number;
    chaos: number;
    total: number;
    aps: number;
  };
  defenses?: {
    armor: number;
    evasion: number;
    es: number;
  };
  requirements?: {
    level: number;
    str: number;
    dex: number;
    int: number;
  };
  modifiers?: {
    explicit: string[];
    implicit: string[];
  };
  enrichedMods?: {
    text: string;
    tier?: number;
    maxTier?: number;
    type?: string;
    value?: number;
    range?: string | null;
    percentile?: number | null;
  }[];
}

// ... existing code ...



const getTierClass = (tier?: number): string => {
  if (!tier) return '';
  if (tier === 1) return 't1';
  if (tier === 2) return 't2';
  if (tier === 3) return 't3';
  return 't4';
};

const getModType = (text: string): string => {
  const t = text.toLowerCase();
  if (t.includes('fire')) return 'mod-fire';
  if (t.includes('cold') || t.includes('ice')) return 'mod-cold';
  if (t.includes('lightning')) return 'mod-lightning';
  if (t.includes('chaos')) return 'mod-chaos';
  if (t.includes('life')) return 'mod-life';
  if (t.includes('mana')) return 'mod-mana';
  if (t.includes('physical')) return 'mod-phys';
  if (t.includes('speed') || t.includes('attack')) return 'mod-speed';
  if (t.includes('resist')) return 'mod-resist'; // Generic if not caught above
  return 'mod-neutral';
};

interface GameEvent {
  id: number;
  type: 'info' | 'death' | 'level' | 'whisper' | 'area' | 'trade';
  text: string;
  time: string;
}

const item = ref<ParsedItem | null>(null);
const currentArea = ref<string>('Unknown');
const currentTier = ref<number>(0);
const mapTimer = ref<string>('00:00');
let timerInterval: any = null;
const events = ref<GameEvent[]>([]);
let eventIdCounter = 0;

const addEvent = (type: GameEvent['type'], text: string) => {
  const now = new Date();
  const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  events.value.unshift({
    id: eventIdCounter++,
    type,
    text,
    time: timeStr
  });
  if (events.value.length > 50) events.value.pop();
};

const startTimer = (startTime: Date) => {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    const now = new Date();
    const diff = Math.floor((now.getTime() - startTime.getTime()) / 1000);
    const m = Math.floor(diff / 60).toString().padStart(2, '0');
    const s = (diff % 60).toString().padStart(2, '0');
    mapTimer.value = `${m}:${s}`;
  }, 1000);
};

const jumpTo = (eventType: string) => {
  window.electron.send('simulation-jump', eventType);
};

const resetSimulation = () => {
  window.electron.send('simulation-reset', null);
  addEvent('info', 'Simulation Reset');
};

const gameStats = ref<any>(null);

const showStats = async () => {
  try {
    const stats = await window.electron.invoke('get-stats');
    gameStats.value = stats;
  } catch (e) {
    console.error('Failed to get stats', e);
  }
};

onMounted(() => {
  console.log('[Vue] App Mounted');
  if (window.electron) {
    window.electron.on('log-area', (data: any) => {
      currentArea.value = data.areaId;
      currentTier.value = data.tier || 0;
      addEvent('area', `Entered ${data.areaId} (T${data.tier || 0})`);
      if (data.timestamp) {
        startTimer(new Date(data.timestamp));
      }
      showStats(); 
    });
    
    window.electron.on('log-entered', (_data: any) => {
       // addEvent('area', `Entered ${data.areaName}`);
    });

    window.electron.on('log-login', () => addEvent('info', 'Connected to Login Server'));
    window.electron.on('log-level-up', (data: any) => addEvent('level', `Level Up! Now Level ${data.level}`));
    window.electron.on('log-whisper', (data: any) => addEvent('whisper', `@${data.from}: ${data.message}`));
    window.electron.on('log-slain', () => {
      addEvent('death', 'You have died.');
      showStats();
    });
    
    window.electron.on('item-data', (data: ParsedItem) => {
      item.value = data;
    });

    // Initial fetch
    showStats();
  }
});

const showControls = ref(false);
const isSimulationMode = ref(false);

// Click-through logic removed for fixed window mode
</script>

<template>
  <div class="map-tracker-panel">
    <!-- Header: Draggable -->
    <div class="header">
      <div class="map-info">
        <span class="tier-badge" v-if="currentTier > 0">T{{ currentTier }}</span>
        <span class="area-name">{{ currentArea }}</span>
      </div>
      <div class="header-controls">
        <span class="timer">{{ mapTimer }}</span>
        <button class="icon-btn" @click="isSimulationMode = !isSimulationMode" :class="{ active: isSimulationMode }" title="Simulation Mode">
          🎮
        </button>
        <button class="icon-btn" @click="showControls = !showControls" :class="{ active: showControls }" title="Stats & Settings">
          📊
        </button>
      </div>
    </div>

    <!-- Quick Stats Row (Always Visible) -->
    <div class="stats-bar" v-if="gameStats">
      <div class="stat-item" title="Deaths">
        <span class="icon">💀</span>
        <span class="value">{{ gameStats.totalDeaths }}</span>
      </div>
      <div class="stat-item" title="Recent Level">
        <span class="icon">✨</span>
        <span class="value" v-if="gameStats.levelHistory.length > 0">
          {{ gameStats.levelHistory[gameStats.levelHistory.length - 1].level }}
        </span>
        <span class="value" v-else>-</span>
      </div>
    </div>

    <!-- Event Feed (Scrollable) -->
    <div class="event-feed">
      <div v-for="event in events" :key="event.id" class="event-item" :class="event.type">
        <span class="time">{{ event.time }}</span>
        <span class="text">{{ event.text }}</span>
      </div>
      <div v-if="events.length === 0" class="empty-feed">
        No events yet...
      </div>
    </div>

    <!-- Simulation Controls (Collapsible) -->
    <div class="controls-panel" v-if="isSimulationMode">
      <div class="panel-header">Simulation</div>
      <div class="btn-grid">
        <button @click="jumpTo('area-changed')">Next Area</button>
        <button @click="jumpTo('slain')">💀 Death</button>
        <button @click="jumpTo('level-up')">✨ Level</button>
        <button @click="jumpTo('whisper')">💬 Whisper</button>
        <button @click="jumpTo('login')">🔌 Login</button>
        <button @click="resetSimulation" class="reset-btn">Reset</button>
      </div>
    </div>
    
    <!-- Expanded Stats (Collapsible) -->
    <div class="details-panel" v-if="showControls && gameStats">
      <div class="panel-header">Top Areas</div>
      <ul>
        <li v-for="area in gameStats.topAreas" :key="area.name">
          <span class="area">{{ area.name }}</span>
          <span class="count">{{ area.count }}x</span>
        </li>
      </ul>
    </div>
  </div>

  <!-- Item Overlay (Separate) -->
  <!-- Item Overlay (Separate) -->
  <!-- Item Overlay (Separate) -->
  <div class="item-overlay" v-if="item">
    <!-- Header -->
    <div class="item-header" :class="item.rarity?.toLowerCase()">
      <div class="header-content">
        <div class="item-class" v-if="item.class">{{ item.class }}</div>
        <h1>{{ item.name }}</h1>
        <h2 v-if="item.name !== item.baseType">{{ item.baseType }}</h2>
        <div class="base-percentile-badge" v-if="item.basePercentile !== undefined">
           Base: {{ item.basePercentile }}%
        </div>
      </div>
    </div>

    <!-- Misc Info (New Section) -->
    <div class="item-misc">
      <div class="misc-row">
        <span v-if="item.itemLevel" class="ilvl">iLvl {{ item.itemLevel }}</span>
        <span v-if="item.quality" class="quality">Qual +{{ item.quality }}%</span>
      </div>
      <div class="misc-row requirements" v-if="item.requirements">
        <span v-if="item.requirements.level">Requires Lvl {{ item.requirements.level }}</span>
        <span v-if="item.requirements.str" class="req-str">{{ item.requirements.str }} Str</span>
        <span v-if="item.requirements.dex" class="req-dex">{{ item.requirements.dex }} Dex</span>
        <span v-if="item.requirements.int" class="req-int">{{ item.requirements.int }} Int</span>
      </div>
      <div class="misc-row sockets" v-if="item.sockets">
        <span>Sockets: {{ item.sockets }}</span>
      </div>
      <!-- Properties Row (e.g. Weapon Range) -->
      <div class="misc-row properties" v-if="item.properties && item.properties.some(p => p.name === 'Weapon Range')">
         <span v-for="prop in item.properties.filter(p => p.name === 'Weapon Range')" :key="prop.name">
            {{ prop.name }}: {{ prop.value }}
         </span>
      </div>
    </div>

    <!-- Stats Grid -->
    <div class="item-stats" v-if="item.dps || item.defenses">
      <!-- DPS Section -->
      <div class="stat-group dps-group" v-if="item.dps">
        <div class="main-stat">
          <span class="label">DPS</span>
          <span class="value">{{ item.dps.total.toFixed(0) }}</span>
        </div>
        <div class="sub-stats">
          <div v-if="item.dps.phys > 0" class="phys">Phys: {{ item.dps.phys.toFixed(0) }}</div>
          <div v-if="item.dps.elem > 0" class="elem">Elem: {{ item.dps.elem.toFixed(0) }}</div>
          <div v-if="item.dps.chaos > 0" class="chaos">Chaos: {{ item.dps.chaos.toFixed(0) }}</div>
          <div class="aps">APS: {{ item.dps.aps.toFixed(2) }}</div>
        </div>
      </div>

      <!-- Defenses Section -->
      <div class="stat-group defensive-group" v-if="item.defenses">
        <div class="def-stat" v-if="item.defenses.armor">
          <span class="label">Armor</span>
          <span class="value">{{ item.defenses.armor }}</span>
        </div>
        <div class="def-stat" v-if="item.defenses.evasion">
          <span class="label">Evasion</span>
          <span class="value">{{ item.defenses.evasion }}</span>
        </div>
        <div class="def-stat" v-if="item.defenses.es">
          <span class="label">ES</span>
          <span class="value">{{ item.defenses.es }}</span>
        </div>
      </div>
    </div>

    <!-- Modifiers Bars -->
    <div class="modifiers-list" v-if="item.enrichedMods && item.enrichedMods.length > 0">
      <div 
        v-for="(mod, index) in item.enrichedMods" 
        :key="index" 
        class="mod-line"
        :class="{'prefix': mod.type === 'Prefix', 'suffix': mod.type === 'Suffix'}"
      >
        <!-- Background Percentile Bar -->
        <div 
          class="mod-percentile" 
          :style="{ width: (mod.percentile || 0) + '%' }"
        ></div>

        <!-- Text Content -->
        <div class="mod-text-container">
           <span class="mod-text">{{ mod.text }}</span>
           <span v-if="mod.value !== undefined" class="mod-value">
             ({{ mod.value }})
           </span>
           <span v-if="mod.range" class="mod-range">{{ mod.range }}</span>
        </div>

        <!-- Right Side: Tier & Badges -->
        <div class="mod-badges">
          <span v-if="mod.tier" class="tier-badge" :class="getTierClass(mod.tier)">T{{ mod.tier }}</span>
          <span v-if="mod.type === 'Prefix'" class="type-badge prefix">P</span>
          <span v-if="mod.type === 'Suffix'" class="type-badge suffix">S</span>
        </div>
      </div>
    </div>
    <!-- Fallback for simple mods -->
    <div class="modifiers-list" v-else-if="item.modifiers && item.modifiers.explicit.length > 0">
      <div 
        v-for="(mod, index) in item.modifiers.explicit" 
        :key="index" 
        class="mod-bar"
        :class="getModType(mod)"
      >
        <span class="mod-text">{{ mod }}</span>
      </div>
    </div>

    <!-- Raw Content (collapsed by default or smaller) -->
    <div class="item-content">
      <!-- <pre>{{ item.raw }}</pre> -->
    </div>
  </div>
</template>

<style scoped>
/* Main Widget Container */
.map-tracker-panel {
  position: fixed;
  top: 10px;
  right: 10px;
  width: 300px;
  background: rgba(15, 15, 20, 0.95);
  border: 1px solid #333;
  border-radius: 8px;
  color: #eee;
  font-family: 'Fontin', sans-serif; /* PoE Font style */
  font-size: 14px;
  box-shadow: 0 8px 16px rgba(0,0,0,0.6);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  backdrop-filter: blur(5px);
}

/* Header */
.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: linear-gradient(to bottom, #2a2a35, #1f1f25);
  border-bottom: 1px solid #000;
  -webkit-app-region: drag;
  cursor: grab;
}

.header:active {
  cursor: grabbing;
}

.map-info {
  display: flex;
  align-items: center;
  gap: 8px;
  overflow: hidden;
}

.tier-badge {
  background: #eee;
  color: #111;
  font-weight: bold;
  padding: 1px 5px;
  border-radius: 3px;
  font-size: 0.85em;
  box-shadow: 0 0 5px rgba(255, 255, 255, 0.5);
}

.area-name {
  color: #fb8;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: bold;
}

.header-controls {
  display: flex;
  align-items: center;
  gap: 8px;
}

.timer {
  color: #aaa;
  font-family: monospace;
  font-size: 1.1em;
  background: rgba(0,0,0,0.3);
  padding: 1px 5px;
  border-radius: 4px;
}

.icon-btn {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 1.2em;
  padding: 2px;
  opacity: 0.6;
  transition: all 0.2s;
  -webkit-app-region: no-drag;
}

.icon-btn:hover {
  opacity: 1;
  transform: scale(1.1);
}

.icon-btn.active {
  opacity: 1;
  text-shadow: 0 0 8px currentColor;
}

/* Stats Bar */
.stats-bar {
  display: flex;
  gap: 15px;
  padding: 6px 12px;
  background: #15151a;
  border-bottom: 1px solid #2a2a30;
  font-size: 0.9em;
}

.stat-item {
  display: flex;
  align-items: center;
  gap: 5px;
  color: #ccc;
}

.stat-item .icon {
  font-size: 1.1em;
}

.stat-item .value {
  font-weight: bold;
  color: #fff;
}

/* Event Feed */
.event-feed {
  max-height: 150px;
  overflow-y: auto;
  padding: 0;
  background: rgba(0,0,0,0.2);
  display: flex;
  flex-direction: column;
}

.event-feed::-webkit-scrollbar {
  width: 4px;
}
.event-feed::-webkit-scrollbar-thumb {
  background: #444;
  border-radius: 2px;
}

.event-item {
  display: flex;
  gap: 8px;
  padding: 4px 12px;
  font-size: 0.85em;
  border-bottom: 1px solid rgba(255,255,255,0.05);
  animation: fadeIn 0.2s ease-out;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateX(-5px); }
  to { opacity: 1; transform: translateX(0); }
}

.event-item .time {
  color: #666;
  font-family: monospace;
  flex-shrink: 0;
}

.event-item .text {
  word-break: break-word;
}

/* Event Types Colors */
.event-item.death { color: #f66; background: rgba(255, 0, 0, 0.05); }
.event-item.whisper { color: #d6f; background: rgba(180, 0, 255, 0.05); }
.event-item.level { color: #fc0; background: rgba(255, 200, 0, 0.05); }
.event-item.area { color: #8af; }
.event-item.info { color: #888; font-style: italic; }

.empty-feed {
  padding: 10px;
  text-align: center;
  color: #555;
  font-style: italic;
  font-size: 0.8em;
}

/* Controls & Details Panels */
.controls-panel, .details-panel {
  padding: 10px;
  background: #1a1a20;
  border-top: 1px solid #333;
}

.panel-header {
  font-size: 0.75em;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: #888;
  margin-bottom: 8px;
  font-weight: bold;
}

.btn-grid {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 6px;
}

button {
  background: #2a2a35;
  border: 1px solid #3a3a45;
  color: #ccc;
  border-radius: 4px;
  padding: 4px;
  font-size: 0.8em;
  cursor: pointer;
  transition: background 0.2s;
}

button:hover {
  background: #3a3a45;
  color: #fff;
  border-color: #555;
}

.reset-btn {
  grid-column: span 3;
  background: #4a2020;
  border-color: #6a3030;
  color: #fca;
}
.reset-btn:hover { background: #6a3030; }

.details-panel ul {
  list-style: none;
  padding: 0;
  margin: 0;
}

.details-panel li {
  display: flex;
  justify-content: space-between;
  padding: 2px 0;
  font-size: 0.85em;
  color: #aaa;
  border-bottom: 1px solid rgba(255,255,255,0.03);
}

.details-panel .area { color: #ddd; }
.details-panel .count { color: #fb8; font-family: monospace; }

/* Item Overlay Updated Styles (Bar Layout) */
/* Item Overlay Updated Styles (Bar Layout) */
.item-overlay {
  /* relative to window now */
  margin: 60px auto 20px;
  background: #000; /* Pitch black for contrast */
  border: 1px solid #333;
  box-shadow: 0 0 30px rgba(0,0,0, 0.9);
  font-family: 'Fontin', sans-serif;
  z-index: 2000;
  display: flex;
  flex-direction: column;
  min-width: 500px; /* Wider window */
  max-width: 530px;
  color: #a38d6d; /* Standard PoE Gold/Beige text */
}

/* Header */
.item-header {
  background: linear-gradient(to bottom, #1a1a1a, #0a0a0a);
  padding: 5px 10px;
  text-align: center;
  border-bottom: 1px solid #333;
  position: relative;
}

.item-header h1 {
  font-size: 1.4em;
  margin: 0;
  font-weight: normal;
  text-shadow: 0 2px 4px #000;
}

.item-header h2 {
  font-size: 1.1em;
  margin: 0;
  font-weight: normal;
  color: #7f7f7f;
}

/* Rarity Headers (PoE colors) */
.item-header.rare { color: #feeb78; border-color: #feeb78; }
.item-header.unique { color: #af6025; border-color: #af6025; }
.item-header.magic { color: #8888ff; border-color: #8888ff; }
.item-header.normal { color: #c8c8c8; border-color: #c8c8c8; }

.base-percentile-badge {
  position: absolute;
  top: 5px;
  right: 10px;
  background: rgba(255, 255, 255, 0.1);
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 0.85em;
  color: #aaa;
  border: 1px solid #333;
}

/* Misc Info Section */
.item-misc {
  background: #111;
  padding: 6px 10px;
  border-bottom: 1px solid #222;
  font-size: 0.9em;
  display: flex;
  flex-direction: column;
  gap: 4px;
  color: #888;
}

.item-class {
  position: absolute;
  top: 5px;
  left: 10px;
  font-size: 0.8em;
  color: #777;
  text-transform: uppercase;
  letter-spacing: 1px;
}

.properties {
  color: #aaa;
  font-style: italic;
}

.misc-row {
  display: flex;
  gap: 12px;
  align-items: center;
  justify-content: center;
}

.ilvl { color: #fff; font-weight: bold; }
.quality { color: #8af; } /* Magic Blue for quality */
.sockets { color: #aaa; }

.requirements {
  font-size: 0.85em; 
  color: #666;
}
.req-str { color: #f66; font-weight: bold; }
.req-dex { color: #6f6; font-weight: bold; }
.req-int { color: #66f; font-weight: bold; }


/* Stats Grid */
.item-stats {
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: #0a0a0a;
}

.dps-group {
  display: flex;
  flex-direction: column;
  align-items: center;
  border-bottom: 1px solid #222;
  padding-bottom: 8px;
}

.main-stat {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.main-stat .label { color: #7f7f7f; font-size: 0.9em; text-transform: uppercase; }
.main-stat .value { color: #fff; font-size: 1.8em; font-weight: bold; }

.sub-stats { display: flex; gap: 12px; font-size: 0.9em; }
.sub-stats .phys { color: #fff; }
.sub-stats .elem { color: #00AAFF; }
.sub-stats .chaos { color: #D02090; }
.sub-stats .aps { color: #aaa; font-style: italic; }

.defensive-group {
  display: flex;
  justify-content: center;
  gap: 20px;
  padding: 4px 0;
}
.def-stat { text-align: center; color: #7f7f7f; }
.def-stat .value { color: #fff; font-weight: bold; margin-left: 4px; }

/* Modifiers List (Bar Layout) */
.modifiers-list {
  padding: 5px;
  display: flex;
  flex-direction: column;
  gap: 2px; /* Tight stacking */
  background: #050505;
}

.mod-line {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between; /* Text Left, Tier Right */
  min-height: 24px; /* Allow expansion */
  border: 1px solid #222;
  background: #080808;
  padding: 2px 0;
}

/* Background Bar (Percentile) */
.mod-percentile {
  position: absolute;
  top: 0;
  left: 0;
  bottom: 0;
  /* width is set inline */
  z-index: 0;
  opacity: 0.25; /* Subtle background */
  pointer-events: none;
}

/* Mod Type Colors for Background Bar */
.mod-line.prefix .mod-percentile { background: linear-gradient(to right, #4af, #258); }
.mod-line.suffix .mod-percentile { background: linear-gradient(to right, #f44, #822); }
/* Custom fallbacks if we added class logic later, currently handled by Prefix/Suffix */

/* Text Overlay */
.mod-text-container {
  position: relative;
  z-index: 1;
  padding-left: 8px;
  display: flex;
  align-items: baseline;
  gap: 6px;
  width: 100%;
  pointer-events: none;
  font-size: 1em;
  white-space: pre-wrap; /* Allow wrapping */
}

.mod-text {
  color: #bfbfe6; /* Light Blue-ish White aka 'Magic' */
  text-shadow: 1px 1px 2px #000;
}

.mod-value {
  color: #fff;
  font-weight: bold;
  text-shadow: 0 0 2px #000;
}

.mod-range {
  font-size: 0.8em;
  color: #777;
}

/* Right Side: Tier & Badges */
.mod-badges {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: stretch;
  height: 100%;
  border-left: 1px solid #222;
}

/* Tier Box (colored square) */
.tier-badge {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  font-weight: bold;
  font-size: 0.9em;
  color: #000; /* Contrast text */
  text-shadow: none;
}

.tier-badge.t1 { background: #5f5; /* Bright Green */ }
.tier-badge.t2 { background: #ff5; /* Yellow */ }
.tier-badge.t3 { background: #fa5; /* Orange */ }
.tier-badge.t4 { background: #f55; /* Red */ }

/* Type Badge (P/S) */
.type-badge {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  font-size: 0.8em;
  color: #aaa;
  background: #111;
  border-left: 1px solid #222;
}

/* Requirements */
.requirements {
  text-align: center;
  font-size: 0.9em;
  color: #666;
  padding: 5px;
  background: #0a0a0a;
}

/* Raw Content */
.item-content pre { display: none; }
</style>
