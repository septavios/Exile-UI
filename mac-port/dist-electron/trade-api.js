const USER_AGENT = 'OAuth exile-ui-mac-port/1.0.0 (contact: your@email.com)'; // Update with real info
const API_BASE = 'https://www.pathofexile.com/api/trade';
export class TradeAPI {
    static rateLimits = {};
    // Cache for stats/leagues
    static stats = [];
    static async fetchLeagues() {
        try {
            const response = await fetch(`${API_BASE}/data/leagues`, {
                headers: { 'User-Agent': USER_AGENT }
            });
            if (!response.ok)
                throw new Error('Failed to fetch leagues');
            const data = await response.json();
            return data.result; // [{ "id": "Standard", ... }]
        }
        catch (e) {
            console.error('Fetch Leagues Error', e);
            return [];
        }
    }
    static async search(item, league) {
        if (!item)
            return null;
        // MVP Strategy:
        // 1. Uniques: Search by Name + Type
        // 2. Rares: Search by Type + Pseudo Stats (DPS, Life, Resists)
        const requestBody = {
            query: {
                status: { option: "online" },
                filters: {
                    trade_filters: {
                        filters: {
                            price: { min: 1 } // Filter junk?
                        }
                    }
                }
            },
            sort: { price: "asc" }
        };
        // --- Name/Type ---
        if (item.rarity === 'Unique' && item.name) {
            requestBody.query.name = item.name;
            requestBody.query.type = item.baseType;
        }
        else {
            requestBody.query.type = item.baseType;
            // Add filters for rares
            const stats = [];
            // Pseudo DPS
            if (item.dps) {
                if (item.dps.phys > 0)
                    stats.push({ id: 'pseudo.pseudo_physical_dps', value: { min: Math.floor(item.dps.phys * 0.9) } });
                if (item.dps.elem > 0)
                    stats.push({ id: 'pseudo.pseudo_elemental_dps', value: { min: Math.floor(item.dps.elem * 0.9) } });
            }
            // Add Stats to query
            if (stats.length > 0) {
                requestBody.query.stats = [{
                        type: "and",
                        filters: stats
                    }];
            }
        }
        // Prepare Request
        console.log('[Trade] Searching:', JSON.stringify(requestBody));
        try {
            const response = await fetch(`${API_BASE}/search/${league}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': USER_AGENT
                },
                body: JSON.stringify(requestBody)
            });
            if (!response.ok) {
                console.error('[Trade] Search failed:', response.status, response.statusText);
                return null;
            }
            const data = await response.json();
            // data: { id: "search_id", result: ["item_id_1", "item_id_2"...], total: 100 }
            return data;
        }
        catch (e) {
            console.error('[Trade] Request Error', e);
            return null;
        }
    }
    static async fetchResults(id, itemIds) {
        // Fetch first 10 results
        const ids = itemIds.slice(0, 10).join(',');
        const url = `${API_BASE}/fetch/${ids}?query=${id}`;
        try {
            const response = await fetch(url, {
                headers: { 'User-Agent': USER_AGENT }
            });
            const data = await response.json();
            return data.result; // Array of item listings
        }
        catch (e) {
            console.error('[Trade] Fetch Results Error', e);
            return [];
        }
    }
}
