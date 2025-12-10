import { app, BrowserWindow, globalShortcut, clipboard, ipcMain, screen, shell } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { ItemParser } from './item-parser.js';
import { db } from './db.js';
import store from './store.js';
import { TradeAPI } from './trade-api.js';
import { LogMonitor } from './log-monitor.js';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Initialize DB
db.load();
let mainWindow = null;
let logMonitor = null;
// Helper for analysis
const analyzeItemText = (text) => {
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
                if (isNaN(min) || isNaN(max))
                    continue;
                sumMin += min;
                sumMax += max;
                if (isNaN(current)) {
                    // Fallback if no current value captured
                }
                else {
                    sumCurrent += current;
                }
            }
            const match = db.findMod(cleanText);
            let type = 'Explicit'; // Default
            let tier = null;
            let value = 0;
            let percentile = null;
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
            const orderA = typeOrder[a.type] || 99;
            const orderB = typeOrder[b.type] || 99;
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
                const calculatePercentile = (statName, itemValue) => {
                    if (!baseData[statName])
                        return null;
                    const rangeStr = baseData[statName]; // "min-max"
                    const [bMinStr, bMaxStr] = rangeStr.split('-');
                    const bMin = parseFloat(bMinStr);
                    const bMax = parseFloat(bMaxStr);
                    if (isNaN(bMin) || isNaN(bMax))
                        return null;
                    let flat = 0;
                    let increased = 0;
                    // Quality
                    let quality = 0;
                    const qualityMatch = item.properties?.find(p => p.name === 'Quality');
                    if (qualityMatch) {
                        const qVal = parseInt(qualityMatch.value.replace(/[^0-9]/g, ''));
                        if (!isNaN(qVal))
                            quality = qVal;
                    }
                    if (item.enrichedMods) {
                        item.enrichedMods.forEach((mod) => {
                            if (mod.text.includes(statName)) {
                                if (mod.text.includes('to ' + statName) || mod.text.match(/\+\d+ to/)) {
                                    if (mod.value)
                                        flat += mod.value;
                                }
                                else if (mod.text.includes('increased ' + statName)) {
                                    if (mod.value)
                                        increased += mod.value;
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
                    if (p !== null)
                        item.basePercentile = p;
                }
                if (item.energyShield) {
                    const p = calculatePercentile('Energy Shield', item.energyShield);
                    if (p !== null)
                        item.basePercentile = p;
                }
                if (item.evasion) {
                    const p = calculatePercentile('Evasion Rating', item.evasion);
                    if (p !== null)
                        item.basePercentile = p;
                }
            }
        }
    }
    return item;
};
// IPC Handlers
ipcMain.handle('analyze-item', async (event, text) => {
    return analyzeItemText(text);
    return analyzeItemText(text);
});
// Settings IPC
ipcMain.handle('get-settings', () => {
    // @ts-ignore - dynamic import or simple require needed for ESM in some electron setups? 
    // actually we imported it.
    return store.store;
});
ipcMain.on('set-setting', (event, { key, value }) => {
    store.set(key, value);
});
import { Automation } from './automation.js';
// ... existing code ...
ipcMain.handle('automation-send-chat', async (event, message) => {
    console.log('[Main] Automation Send Chat:', message);
    await Automation.sendChat(message);
});
ipcMain.handle('open-external', async (event, url) => {
    await shell.openExternal(url);
});
ipcMain.handle('get-leagues', async () => {
    return ['Standard', 'Hardcore', 'Settlers', 'Settlers HC'];
});
ipcMain.handle('price-check', async (event, payload) => {
    // ... existing implementation ...
    const { item, league } = payload;
    console.log('[Main] Price Checking for league:', league);
    const searchResult = await TradeAPI.search(item, league);
    if (!searchResult || !searchResult.result)
        return { error: 'Search failed' };
    const listings = await TradeAPI.fetchResults(searchResult.id, searchResult.result);
    return {
        id: searchResult.id,
        total: searchResult.total,
        listings: listings.map((l) => ({
            priceAmount: l.listing.price.amount,
            priceCurrency: l.listing.price.currency,
            account: l.listing.account.name,
            time: l.listing.indexed
        }))
    };
});
const createWindow = () => {
    const { width, height } = screen.getPrimaryDisplay().workAreaSize;
    mainWindow = new BrowserWindow({
        width: 550,
        height: 850,
        // frame: false, // Replaced with titleBarStyle for macOS native feel
        titleBarStyle: 'hidden', // Hides title bar but keeps traffic lights
        trafficLightPosition: { x: 10, y: 10 }, // Optional: Adjust traffic light position
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
        }
        else {
            win?.setFocusable(false); // Return focus to game
        }
    });
    if (!app.isPackaged) {
        mainWindow.loadURL('http://localhost:5173');
        // mainWindow.webContents.openDevTools(); // Open DevTools
    }
    else {
        mainWindow.loadFile('dist/index.html');
    }
};
app.whenReady().then(() => {
    createWindow();
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0)
            createWindow();
    });
    // Stash Navigation Shortcuts (Cmd+Shift+Left/Right to simulate arrow keys)
    globalShortcut.register('Command+Shift+Left', async () => {
        // Only if PoE is focused? Or always?
        // Safer to just send Left arrow.
        console.log('Stash Nav: Left');
        try {
            await Automation.sendKey('Left');
        }
        catch (e) {
            console.error(e);
        }
    });
    globalShortcut.register('Command+Shift+Right', async () => {
        console.log('Stash Nav: Right');
        try {
            await Automation.sendKey('Right');
        }
        catch (e) {
            console.error(e);
        }
    });
    // Item Analysis Shortcut
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
        if (logMonitor)
            logMonitor.simulate && logMonitor.simulate();
    });
    // Start Log Monitor
    const homeDir = app.getPath('home');
    const logPath = path.join(homeDir, 'Library/Caches/com.GGG.PathOfExile/Logs/Client.txt');
    console.log('[Main] Monitoring Log:', logPath);
    logMonitor = new LogMonitor(logPath); // Fixed: No callback here
    // Forward log events to renderer
    const forwardEvent = (type, data) => {
        if (mainWindow) {
            mainWindow.webContents.send(`log-${type}`, data);
        }
    };
    logMonitor.on('area-changed', (data) => {
        // rudimentary map counting
        if (data.areaId && !data.areaId.includes('Town') && !data.areaId.includes('Hideout')) {
            const stats = store.get('stats');
            if (stats) {
                stats.maps = (stats.maps || 0) + 1;
                store.set('stats', stats);
            }
        }
        forwardEvent('area', data);
    });
    logMonitor.on('login', () => forwardEvent('login'));
    logMonitor.on('level-up', (data) => forwardEvent('level-up', data));
    logMonitor.on('whisper', (data) => forwardEvent('whisper', data));
    logMonitor.on('slain', () => {
        const stats = store.get('stats');
        if (stats) {
            stats.deaths = (stats.deaths || 0) + 1;
            store.set('stats', stats);
        }
        forwardEvent('slain');
    });
    // Simulation IPC forwarding
    ipcMain.on('simulation-jump', (_event, eventType) => {
        if (logMonitor)
            logMonitor.jumpToNext && logMonitor.jumpToNext(eventType);
    });
    ipcMain.on('simulation-reset', () => {
        console.log('[Main] Resetting simulation');
        if (logMonitor)
            logMonitor.resetSimulation && logMonitor.resetSimulation();
    });
    ipcMain.handle('get-stats', async () => {
        const s = store.get('stats');
        // Mix with simulation stats if needed, or just return persistent stats for now
        return {
            totalDeaths: s?.deaths || 0,
            totalMaps: s?.maps || 0,
            // For Top Areas, we might need more complex storage. Skipping for MVP P1.
            topAreas: [],
            levelHistory: [] // Keeping structure compatible with frontend
        };
    });
});
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin')
        app.quit();
});
app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    logMonitor?.stop();
});
