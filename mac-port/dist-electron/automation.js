import { exec } from 'child_process';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { keyboard, Key } = require('@nut-tree/nut-js');
export class Automation {
    static async focusPoE() {
        return new Promise((resolve) => {
            // macOS specific focus
            // Note: "Path of Exile" name might vary (e.g. "Path of Exile Client"?)
            // Standard Mac standalone is "Path of Exile". Steam might be different?
            // Usually "Path of Exile".
            const script = `tell application "Path of Exile" to activate`;
            exec(`osascript -e '${script}'`, (err) => {
                if (err) {
                    // Fallback for Steam? "Path of Exile" usually works for both if running.
                    // Or try "wine" if using crossover? Assuming Native/Rosetta.
                    console.warn('[Automation] Focus failed:', err.message);
                }
                setTimeout(resolve, 200); // Wait for focus switch
            });
        });
    }
    static async sendChat(message) {
        await this.focusPoE();
        // Safety delay
        await new Promise(r => setTimeout(r, 100));
        // Open Chat
        await keyboard.tap(Key.Enter);
        await new Promise(r => setTimeout(r, 50));
        // Delete any existing text (optional, but good safety: Ctrl+A, Backspace)
        // Mac: Cmd+A is typical, but PoE is weird. Ctrl+A often works in game text inputs?
        // Or just assume mostly empty if not typing.
        // Let's just type.
        // Paste data if long? Typing simulate is safer for "slash commands".
        await keyboard.type(message);
        await new Promise(r => setTimeout(r, 50));
        await keyboard.tap(Key.Enter);
    }
    static async sendKey(keyName) {
        // Basic mapping
        const k = Key[keyName] || keyName;
        await keyboard.tap(k);
    }
}
