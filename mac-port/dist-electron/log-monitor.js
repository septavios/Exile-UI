import fs from 'fs';
import EventEmitter from 'events';
export class LogMonitor extends EventEmitter {
    filePath;
    currentSize = 0;
    isWatching = false;
    constructor(filePath) {
        super();
        this.filePath = filePath;
    }
    start() {
        if (this.isWatching)
            return;
        if (!fs.existsSync(this.filePath)) {
            console.warn(`[LogMonitor] File not found: ${this.filePath}`);
            // Try to create it if it's a dummy file for testing
            if (this.filePath.includes('dummy')) {
                fs.writeFileSync(this.filePath, '');
            }
            else {
                return;
            }
        }
        const stats = fs.statSync(this.filePath);
        this.currentSize = stats.size;
        console.log(`[LogMonitor] Watching ${this.filePath} (starting at bytes: ${this.currentSize})`);
        // Use watchFile (polling) for stability across OS/file systems for log files
        fs.watchFile(this.filePath, { interval: 500 }, (curr, prev) => {
            if (curr.size > prev.size) {
                this.readNewContent(prev.size, curr.size);
            }
            else if (curr.size < prev.size) {
                // File truncated/rotated
                this.currentSize = 0;
                this.readNewContent(0, curr.size);
            }
        });
        this.isWatching = true;
    }
    stop() {
        if (this.isWatching) {
            fs.unwatchFile(this.filePath);
            this.isWatching = false;
        }
    }
    simulationLines = [];
    simulationIndex = 0;
    async loadSimulation() {
        if (!fs.existsSync(this.filePath)) {
            console.warn('[LogMonitor] File not found for simulation');
            return;
        }
        const content = fs.readFileSync(this.filePath, 'utf-8');
        this.simulationLines = content.split(/\r?\n/);
        this.simulationIndex = 0;
        console.log(`[LogMonitor] Loaded ${this.simulationLines.length} lines for simulation`);
    }
    async jumpToNext(eventType) {
        if (this.simulationLines.length === 0) {
            await this.loadSimulation();
        }
        console.log(`[LogMonitor] Jumping to next ${eventType} from index ${this.simulationIndex}`);
        for (let i = this.simulationIndex + 1; i < this.simulationLines.length; i++) {
            const line = this.simulationLines[i];
            if (!line.trim())
                continue;
            let found = false;
            if (eventType === 'area-changed' && (line.includes('Generating level') || line.includes('You have entered')))
                found = true;
            if (eventType === 'slain' && (line.includes('has been slain') || line.includes('You have been slain') || line.includes('has committed suicide')))
                found = true;
            if (eventType === 'level-up' && line.includes('is now level'))
                found = true;
            if (eventType === 'whisper' && line.includes('@From'))
                found = true;
            // Special Login check
            if (eventType === 'login' && ((line.includes(' connected to ') && line.includes('.login.')) ||
                line.includes('*****') ||
                line.includes('Connected to')))
                found = true;
            if (found) {
                this.simulationIndex = i;
                this.parseLines(line);
                return;
            }
        }
        console.log('[LogMonitor] No more events found of type:', eventType);
    }
    resetSimulation() {
        this.simulationIndex = 0;
        console.log('[LogMonitor] Simulation reset to start.');
    }
    async calculateStats() {
        if (this.simulationLines.length === 0) {
            await this.loadSimulation();
        }
        let totalDeaths = 0;
        const levelHistory = [];
        const areaCounts = {};
        let lastLevelTime = null;
        // Regex for timestamp: 2025/11/14 21:53:06
        const timeRegex = /^(\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2})/;
        for (const line of this.simulationLines) {
            if (!line.trim())
                continue;
            const timeMatch = line.match(timeRegex);
            if (!timeMatch)
                continue;
            const timestamp = new Date(timeMatch[1]);
            if (isNaN(timestamp.getTime()))
                continue;
            // Deaths
            if (line.includes('has been slain') || line.includes('You have been slain') || line.includes('has committed suicide')) {
                totalDeaths++;
            }
            // Level Up
            // Format: : CharacterName (Class) is now level X
            if (line.includes('is now level')) {
                const match = line.match(/: (.+?) (?:\(.+?\) )?is now level (\d+)/);
                if (match) {
                    const level = parseInt(match[2]);
                    // Calculate duration since last level
                    let durationStr = 'N/A';
                    if (lastLevelTime) {
                        const diffMs = timestamp.getTime() - lastLevelTime.getTime();
                        const hours = Math.floor(diffMs / 3600000);
                        const minutes = Math.floor((diffMs % 3600000) / 60000);
                        durationStr = `${hours}h ${minutes}m`;
                    }
                    // Avoid duplicate entries for same level (if log has multiple chars or re-reads)
                    // Simple check: if last entry level != this level
                    if (levelHistory.length === 0 || levelHistory[levelHistory.length - 1].level !== level) {
                        levelHistory.push({ level, time: timestamp, duration: durationStr });
                        lastLevelTime = timestamp;
                    }
                }
            }
            // Area Counts
            if (line.includes('Generating level')) {
                const match = line.match(/area "(.+?)"/);
                if (match && match[1]) {
                    const area = match[1];
                    areaCounts[area] = (areaCounts[area] || 0) + 1;
                }
            }
        }
        // Sort area counts
        const topAreas = Object.entries(areaCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5) // Top 5
            .map(([name, count]) => ({ name, count }));
        return {
            totalDeaths,
            levelHistory,
            topAreas
        };
    }
    async simulate() {
        await this.loadSimulation();
    }
    readNewContent(start, end) {
        const stream = fs.createReadStream(this.filePath, {
            start: start,
            end: end,
            encoding: 'utf-8',
        });
        let buffer = '';
        stream.on('data', (chunk) => {
            buffer += chunk;
        });
        stream.on('end', () => {
            this.parseLines(buffer);
            this.currentSize = end;
        });
    }
    parseLines(content) {
        const lines = content.split(/\r?\n/);
        for (const line of lines) {
            if (!line.trim())
                continue;
            // Area Changed
            if (line.includes('Generating level')) {
                // Example: 2025/11/13 12:07:47 ... Generating level 69 area "2_11_endgame_town" ...
                const match = line.match(/Generating level (\d+) area "(.+?)"/);
                const timeMatch = line.match(/^(\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2})/);
                if (match && match[2]) {
                    const areaLevel = parseInt(match[1]);
                    const areaId = match[2];
                    let tier = 0;
                    if (areaLevel > 67) {
                        tier = areaLevel - 67;
                    }
                    this.emit('area-changed', {
                        areaId,
                        areaLevel,
                        tier,
                        timestamp: timeMatch ? new Date(timeMatch[1]) : new Date(),
                        raw: line
                    });
                }
            }
            // Area Entered
            else if (line.includes('You have entered')) {
                const match = line.match(/You have entered (.+)\./);
                if (match) {
                    // We emit as area-changed or a new event? Let's emit a specific 'entered' event
                    this.emit('entered', { areaName: match[1], raw: line });
                }
            }
            // Login
            else if (line.includes('Connected to') || line.includes('*****')) {
                this.emit('login', { raw: line });
            }
            // Level Up
            else if (line.includes('is now level')) {
                // Format: : CharacterName (Class) is now level X
                const match = line.match(/: (.+?) (?:\(.+?\) )?is now level (\d+)/);
                if (match) {
                    this.emit('level-up', { character: match[1], level: match[2], raw: line });
                }
            }
            // Whisper
            else if (line.includes('@From')) {
                const match = line.match(/@From (.+?): (.+)/);
                if (match) {
                    this.emit('whisper', { from: match[1], message: match[2], raw: line });
                }
            }
            // Player Slain / Suicide
            if (line.includes('has been slain') || line.includes('You have been slain') || line.includes('has committed suicide')) {
                this.emit('slain', { raw: line });
            }
        }
    }
}
