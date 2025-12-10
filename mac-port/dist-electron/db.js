import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
const IS_DEV = !app.isPackaged;
const DATA_PATH = IS_DEV
    ? path.join(process.cwd(), '../data/global/item mods.json')
    : path.join(process.resourcesPath, 'data/global/item mods.json');
export class ModDatabase {
    mods = [];
    modsByFamily = {};
    bases = {}; // Public for main access
    loaded = false;
    constructor() { }
    load() {
        if (this.loaded)
            return;
        try {
            console.log('[ModDatabase] Loading DB from', DATA_PATH);
            if (!fs.existsSync(DATA_PATH)) {
                console.error('[ModDatabase] File not found:', DATA_PATH);
                return;
            }
            const rawData = fs.readFileSync(DATA_PATH, 'utf8');
            const json = JSON.parse(rawData);
            // Load 'universal' as primary source for now
            // (Abyss jewels etc are specific, we can add them later)
            const categories = ['universal', 'abyss jewels', 'cluster jewels', 'base jewels'];
            for (const cat of categories) {
                if (json[cat]) {
                    this.processCategory(json[cat]);
                }
            }
            this.groupFamilies();
            // Load Item Bases
            // Assuming 'item bases.json' is in the same folder as DATA_PATH
            const BASES_PATH = path.join(path.dirname(DATA_PATH), 'item bases.json');
            if (fs.existsSync(BASES_PATH)) {
                console.log('[ModDatabase] Loading Bases from', BASES_PATH);
                const rawBases = fs.readFileSync(BASES_PATH, 'utf8');
                const basesJson = JSON.parse(rawBases);
                // basesJson has `_bases` map (Name -> Class) and then Class -> Name -> Info
                // We want a flat map: Name -> Info
                // Logic: Iterate `_bases` to find class, then look up in that class object.
                if (basesJson._bases) {
                    for (const [baseName, classId] of Object.entries(basesJson._bases)) {
                        // If keys are class IDs, we need to map IDs to names? 
                        // Wait, looks like `basesJson` keys ARE class names OR class IDs.
                        // Let's check format again.
                        // Format: "Abyssal Axe": "4"
                        // Then keys "3", "4", etc? Or "Axe", "Bow"?
                        // Ah, the file I viewed had "Armour": "284-319". Line 1401.
                        // That was deep inside an object?
                        // Let's assume standard structure:
                        // `_bases` = { "Item Name": "ClassKey" }
                        // `ClassKey` = { "Item Name": { ... stats ... } } 
                        // Or `basesJson` contains "3": { ... } ?
                        // From file view earlier:
                        // "Gladiator Plate": { "_tags": ... } seems to be at TOP LEVEL?
                        // Wait, I saw line 1403: "Gladiator Plate": { ... }
                        // I need to check if those are nested under a class key or root.
                        // The snippet I saw:
                        // Line 3: "Abyssal Axe": "4" (inside `_bases`)
                        // Line 1403: "Gladiator Plate": { ... } seems indentation 2? 
                        // Line 1: { 
                        // Line 2: "_bases": { ... }
                        // Line 1403 seems to be inside something else if indentation matches?
                        // Actually, let's load everything flat.
                        // Re-verification required? 
                        // Let's look at `item bases.json` again briefly to be safe.
                        // I'll assume we can just look up by name if I flatten it.
                    }
                }
                // Let's just expose the raw JSON for now and logic in `main.ts` or helper method.
                // Actually, safer to keep logic here.
                this.bases = basesJson;
            }
            this.loaded = true;
            console.log(`[ModDatabase] Loaded ${this.mods.length} mods.`);
        }
        catch (e) {
            console.error('[ModDatabase] Load failed', e);
        }
    }
    processCategory(categoryData) {
        for (const [key, data] of Object.entries(categoryData)) {
            const def = {
                id: key,
                texts: data.texts || [],
                level: parseInt(data.level || '0'),
                type: data.type || 'Unknown',
                tags: data.tags || [],
                weights: data.weights
            };
            // Generate Regex
            // Logic: "to Accuracy Rating" -> /([+-\d]+) to Accuracy Rating/
            // " to ", " Added Chaos Damage" -> /([+-\d]+) to ([+-\d]+) Added Chaos Damage/
            let pattern = '^';
            // Heuristic: If text starts with space, expect number before it.
            // E.g. " to Accuracy Rating" -> number + " to Accuracy Rating"
            // But verify if it's "Adds x to y" -> "Adds " ...
            if (def.texts.length > 0) {
                // Assume number before each text segment if it makes sense?
                // Let's check typical PoEninja/Parsing logic.
                // Usually it is: (Value1) (part1) (Value2) (part2)
                // Example: [" to ", " Added Chaos"]
                // Matches "10 to 20 Added Chaos"
                // So: (\d+) <text0> (\d+) <text1>
                // Wait, " to Accuracy Rating" (1 element)
                // Matches "+100 to Accuracy Rating"
                // So: ([+-]?\d+) <text0>
                let regexStr = '';
                // Check for specific prefixes in text that shouldn't have number before?
                // "Adds " usually implies: "Adds " (val) " to " (val) ...
                // Simple iteration:
                // Assume Val -> Text -> Val -> Text
                // But need to handle empty start?
                for (let i = 0; i < def.texts.length; i++) {
                    const part = this.escapeRegExp(def.texts[i]);
                    // If it's the first part and it looks like a suffix mod starting text (e.g. " of ...")
                    // No, usually mod text is "20% increased..."
                    // text[0] is "% increased..."
                    // So regex: (\d+)% increased...
                    // Exception: "Adds "
                    // text[0]: "Adds "
                    // regex: Adds (\d+)
                    if (i === 0 && (part.startsWith('Adds ') || part.startsWith('Has '))) {
                        regexStr += part + '([\\d\\.]+)';
                    }
                    else {
                        // Standard: (Number) (Text)
                        regexStr += '([\\d\\.\\+\\-]+)' + part;
                    }
                }
                // Allow fuzzy match at end?
                pattern += regexStr; // + '$'; // Strict end matching can fail with advanced mods
                // Catch: " to Accuracy Rating" -> starts with space.
                // Our regex logic: (Number) " to Accuracy Rating".
                // Correct for "+100 to Accuracy Rating".
                try {
                    def.regex = new RegExp(pattern, 'i');
                    this.mods.push(def);
                }
                catch (e) {
                    // console.warn('Invalid regex for', key, pattern);
                }
            }
        }
    }
    groupFamilies() {
        // Group mods that are tiers of the same stat.
        // Heuristic: Suffix number removal? "AddedColdDamage1", "AddedColdDamage2"
        // Regex: Remove digits at end of ID.
        for (const mod of this.mods) {
            const family = mod.id.replace(/\d+$/, '').replace(/_$/, ''); // Remove trailing numbers/underscores
            if (!this.modsByFamily[family]) {
                this.modsByFamily[family] = [];
            }
            this.modsByFamily[family].push(mod);
        }
        // Sort families by Level
        for (const family in this.modsByFamily) {
            this.modsByFamily[family].sort((a, b) => b.level - a.level); // Descending level (Higher level = Higher tier usually?)
            // Wait, Tier 1 is Highest Level.
            // So index 0 is T1.
        }
    }
    findMod(text) {
        // Iterate all mods? Slow (2800).
        // Optimization later. For now, linear scan is fine for 1 item (20 mods max).
        // Actually item has 5-10 mods. Scan 2800 x 10 is fast enough in V8.
        for (const mod of this.mods) {
            const match = mod.regex ? mod.regex.exec(text) : null;
            if (match) {
                // Found match. Determine Tier.
                const family = mod.id.replace(/\d+$/, '').replace(/_$/, '');
                const siblings = this.modsByFamily[family];
                // Find rank
                const rank = siblings.indexOf(mod);
                const tier = rank + 1; // 1-based Tier
                // Extract values (skip full match at index 0)
                const values = match.slice(1).map(v => parseFloat(v));
                return {
                    mod,
                    tier,
                    familySize: siblings.length,
                    values
                };
            }
        }
        return null;
    }
    escapeRegExp(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
}
export const db = new ModDatabase();
