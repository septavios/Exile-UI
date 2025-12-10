import { app, BrowserWindow, globalShortcut, clipboard, ipcMain, screen } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { ItemParser } from './item-parser.js';
import { LogMonitor } from './log-monitor.js';
import { db } from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize DB
db.load();

let mainWindow: BrowserWindow | null = null;
let logMonitor: LogMonitor | null = null;

// Helper for analysis
const analyzeItemText = (text: string) => {
  const item = ItemParser.parse(text);
  
  if (item.modifiers && item.modifiers.explicit) {
    const rawMods = item.modifiers.explicit.map(modText => {
      // 1. Extract All Ranges from text
      // AHK logic sums up all ranges found in a line (e.g. "Adds 10(9-11) to 20(19-21) Phys Dmg")
      // We look for patterns like `(num-num)` or `num(num-num)`.
      // Standard Advanced Mod Description copy often puts ranges at the end? 
      // Or inline: "Adds 10 (8-12) to 20 (18-22)..."
      // Let's use a global regex.
      const rangeRegexGlobal = /(?:(\d+(?:\.\d+)?)\s*)?\((\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)\)%?/g;
      
      let sumMin = 0;
      let sumMax = 0;
      let sumCurrent = 0;
      let rangeFound = false;

      // Iterate matches
      let matchExec;
      let cleanText = modText;
      
      // We need to keep a clean text for DB lookup. 
      // Strategy: Remove all range patterns from text.
      cleanText = modText.replace(rangeRegexGlobal, '').trim();
      // Also clean up any double spaces left behind
      cleanText = cleanText.replace(/\s+/g, ' ');

      while ((matchExec = rangeRegexGlobal.exec(modText)) !== null) {
        rangeFound = true;
        // match[1] = current value (optional, might be before parens)
        // match[2] = min
        // match[3] = max
        const min = parseFloat(matchExec[2]);
        const max = parseFloat(matchExec[3]);
        let current = parseFloat(matchExec[1]);

        if (isNaN(min) || isNaN(max)) continue;
        
        sumMin += min;
        sumMax += max;
        
        if (isNaN(current)) {
           // Fallback if no current value captured
        } else {
           sumCurrent += current;
        }
      }

      const match = db.findMod(cleanText);
      
      let type = 'Explicit';   // Default
      let tier = null;
      let value = 0;
      let percentile: number | null = null;
      let rangeText = null;   

      if (match) {
        const values = match.values || [];
        value = values.length > 0 ? values[0] : 0;
        tier = match.tier;
        type = match.mod.type || 'Explicit';
        
        // If ranges were found, calculate percentile based on Sums.
        if (rangeFound && sumMax > sumMin) {
           const totalCurrent = sumCurrent > 0 ? sumCurrent : value;
           
           percentile = Math.round(((totalCurrent - sumMin) / (sumMax - sumMin)) * 100);
           rangeText = `(${sumMin}-${sumMax})`;
        }
      }

      return {
        text: cleanText,
        originalText: modText,
        tier: tier,
        type: type,
        value: value,
        range: rangeText,
        percentile: percentile
      };
    });

    // 2. Sort Modifiers: Prefixes first, then Suffixes, then others.
    const sortedMods = rawMods.sort((a, b) => {
       const typeOrder = { 'Prefix': 1, 'Suffix': 2, 'Explicit': 3 };
       const orderA = typeOrder[a.type as keyof typeof typeOrder] || 99;
       const orderB = typeOrder[b.type as keyof typeof typeOrder] || 99;
       return orderA - orderB;
    });

    // @ts-ignore
    item.enrichedMods = sortedMods;
  }

  // 3. Calculate Base Percentile (Defense/Damage Quality)
  // Logic: 
  // - Identify Base Type Name (e.g. "Vaal Regalia")
  // - Lookup Base in `db.bases` to get text-min/max (e.g. "Armour": "284-319")
  // - Extract current Item Quality (defaults to 0 if not present)
  // - Extract current Total Armour/Evasion/ES from parsed `item` properties.
  // - Calculate "Local" Increase from modifiers (e.g. "+100% Increased Armour").
  // - Calculate "Flat" Increase from modifiers (e.g. "+145 to Armour").
  // - Reverse Formula:
  //   Total = (Base + Flat) * (1 + Quality/100 + Increased/100)
  //   Base = (Total / (1 + Q/100 + Inc/100)) - Flat
  
  if (item.baseType && db.bases && db.bases[item.baseType]) {
     // `db.bases` is direct map now based on my fix in db.ts? 
     // Wait, db.ts `this.bases = basesJson`.
     // And `basesJson` has keys like `_bases` etc.
     // So `db.bases[item.baseType]` works IF item.baseType is in root. 
     // But `item bases.json` structure is usually `_bases` -> ClassID, then ClassID -> Item.
     // Let's assume standard lookup via `_bases`.
     
     const basesMap = db.bases._bases;
     const classId = basesMap ? basesMap[item.baseType] : null;

     if (classId) {
        const classData = db.bases[classId];
        const baseData = classData ? classData[item.baseType] : null;
        
        if (baseData) {
           item.baseData = baseData; // Attach for debug/UI
           
           const calculatePercentile = (statName: string, itemValue: number) => {
              if (!baseData[statName]) return null;
              
              const rangeStr = baseData[statName]; // "min-max"
              const [bMinStr, bMaxStr] = rangeStr.split('-');
              const bMin = parseFloat(bMinStr);
              const bMax = parseFloat(bMaxStr);
              
              if (isNaN(bMin) || isNaN(bMax)) return null;

              let flat = 0;
              let increased = 0;
              
              // Quality
              let quality = 0;
              const qualityMatch = item.properties?.find(p => p.name === 'Quality');
              if (qualityMatch) {
                 const qVal = parseInt(qualityMatch.value.replace(/[^0-9]/g, ''));
                 if (!isNaN(qVal)) quality = qVal;
              }
              
              if (item.enrichedMods) {
                  item.enrichedMods.forEach((mod: any) => {
                     if (mod.text.includes(statName)) {
                        if (mod.text.includes('to ' + statName) || mod.text.match(/\+\d+ to/)) {
                           if (mod.value) flat += mod.value;
                        } else if (mod.text.includes('increased ' + statName)) {
                           if (mod.value) increased += mod.value;
                        }
                     }
                  });
              }
              
              const totalMultiplier = 1 + (quality + increased) / 100;
              const impliedBase = (itemValue / totalMultiplier) - flat;
              
              return Math.round(((impliedBase - bMin) / (bMax - bMin)) * 100);
           };

           if (item.armour) {
              const p = calculatePercentile('Armour', item.armour);
              if (p !== null) item.basePercentile = p; 
           }
           if (item.energyShield) {
               const p = calculatePercentile('Energy Shield', item.energyShield);
               if (p !== null) item.basePercentile = p;
           }
           if (item.evasion) {
               const p = calculatePercentile('Evasion Rating', item.evasion);
               if (p !== null) item.basePercentile = p;
           }
        }
     }
  }

  return item;
};

// IPC Handlers
ipcMain.handle('analyze-item', async (event, text: string) => {
  return analyzeItemText(text);
});

const createWindow = () => {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  
  mainWindow = new BrowserWindow({
    width: 550,
    height: 850,
    frame: false, // Frameless for overlay
    transparent: true, // Transparent background
    hasShadow: false,
    alwaysOnTop: true,
    focusable: true, // Can accept focus
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false, // Disable sandbox to allow ESM in preload
    },
  });

  // Center the window initially
  mainWindow.center();

  // IPC: Toggle Click-Through (Optional now, but kept for future)
  ipcMain.on('set-ignore-mouse-events', (event, payload) => {
    const { ignore, options } = payload;
    const win = BrowserWindow.fromWebContents(event.sender);
    win?.setIgnoreMouseEvents(ignore, options);
    // If we stop ignoring mouse, we might want to focus?
    if (!ignore) {
       win?.setFocusable(true);
       win?.focus(); // Create focus trap if needed, but simple focus for now
    } else {
       win?.setFocusable(false); // Return focus to game
    }
  });

  if (!app.isPackaged) {
    mainWindow.loadURL('http://localhost:5173');
    // mainWindow.webContents.openDevTools(); // Open DevTools
  } else {
    mainWindow.loadFile('dist/index.html');
  }
};

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
  
  // Register Global Shortcut for item analysis
  globalShortcut.register('CommandOrControl+Shift+C', async () => {
    const text = clipboard.readText();
    if (text) {
       console.log('Clipboard text detected');
       const item = analyzeItemText(text);

       if (mainWindow) {
         mainWindow.webContents.send('item-data', item);
         // Make interactive and focus
         mainWindow.setIgnoreMouseEvents(false);
         mainWindow.show();
         mainWindow.focus();
       }
    }
  });

  // Register Simulation Shortcut (CommandOrControl+Shift+R)
  globalShortcut.register('CommandOrControl+Shift+R', () => {
    console.log('[Main] Triggering Simulation...');
    if (logMonitor) (logMonitor as any).simulate && (logMonitor as any).simulate();
  });

  // Start Log Monitor
  const homeDir = app.getPath('home');
  const logPath = path.join(homeDir, 'Library/Caches/com.GGG.PathOfExile/Logs/Client.txt');
  console.log('[Main] Monitoring Log:', logPath);
  
  logMonitor = new LogMonitor(logPath); // Fixed: No callback here
  
  // Forward log events to renderer
  const forwardEvent = (type: string, data?: any) => {
    if (mainWindow) {
        mainWindow.webContents.send(`log-${type}`, data);
    }
  };

  logMonitor.on('area-changed', (data: any) => forwardEvent('area', data));
  logMonitor.on('login', () => forwardEvent('login'));
  logMonitor.on('level-up', (data: any) => forwardEvent('level-up', data));
  logMonitor.on('whisper', (data: any) => forwardEvent('whisper', data));
  logMonitor.on('slain', () => forwardEvent('slain'));
  
  // Simulation IPC forwarding
  ipcMain.on('simulation-jump', (_event, eventType) => {
    if (logMonitor) (logMonitor as any).jumpToNext && (logMonitor as any).jumpToNext(eventType);
  });

  ipcMain.on('simulation-reset', () => {
    console.log('[Main] Resetting simulation');
    if (logMonitor) (logMonitor as any).resetSimulation && (logMonitor as any).resetSimulation();
  });

  ipcMain.handle('get-stats', async () => {
    console.log('[Main] Getting stats');
    return logMonitor ? (logMonitor as any).calculateStats() : null;
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  logMonitor?.stop();
});
