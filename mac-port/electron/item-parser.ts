export interface ExtendedItem {
  rarity?: string;
  name?: string;
  baseType?: string;
  class?: string;
  quality?: number;
  sockets?: string;
  
  // Weapon Stats
  dps?: {
    phys: number;
    elem: number;
    chaos: number;
    total: number;
    aps: number;
    crit?: number;
  };
  
  // Defense Stats
  defenses?: {
    armor: number;
    evasion: number;
    es: number;
    block?: number;
  };
  
  requirements?: {
    level: number;
    str: number;
    dex: number;
    int: number;
  };
  
  modifiers: {
    enchant: string[];
    implicit: string[];
    explicit: string[];
    crafted: string[];
    fractured: string[];
  };
  
  // Parsed Properties
  properties?: { name: string; value: string; type: number }[];
  
  // Base Percentile Info
  itemLevel?: number;
  basePercentile?: number;
  baseData?: any; // Raw JSON from DB for debugging
  
  // Modifiers with Range Info
  enrichedMods?: {
    text: string;
    originalText: string;
    tier?: number;
    type?: string;
    value?: number;
    range?: string | null;
    percentile?: number | null;
  }[];

  // Specific Defence Stats (flat nums) for easier calc
  armour?: number;
  evasion?: number;
  energyShield?: number;

  raw: string;
}

export class ItemParser {
  static parse(text: string): ExtendedItem {
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
    const item: ExtendedItem = {
      raw: text,
      modifiers: { enchant: [], implicit: [], explicit: [], crafted: [], fractured: [] }
    };

    let sectionIndex = 0;
    
    // Parse Header (Rarity, Name, BaseType)
    // Common pattern:
    // Rarity: ...
    // Name
    // BaseType
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.startsWith('Item Class: ')) {
            item.class = line.replace('Item Class: ', '').trim();
            continue;
        }

        if (line.startsWith('Rarity: ')) {
            item.rarity = line.replace('Rarity: ', '').trim();
            // Typically next 1-2 lines are Name/Base
            if (lines[i+1] && !lines[i+1].includes('----')) {
              item.name = lines[i+1];
              // Check if the line after name is base type or just a separator
              if (lines[i+2] && !lines[i+2].includes('----')) {
                 item.baseType = lines[i+2];
              } else {
                 item.baseType = item.name; 
              }
            }
            break; // Stop after finding rarity/name
        }
    }

    // Parse Stats (DPS, Defenses)
    let minPhys = 0, maxPhys = 0;
    let minElem = 0, maxElem = 0;
    let minChaos = 0, maxChaos = 0;
    let aps = 0;

    for (const line of lines) {
      // Quality
      if (line.startsWith('Quality: ')) {
        const match = line.match(/\+(\d+)%/);
        if (match) item.quality = parseInt(match[1]);
      }
      
      // Sockets
      if (line.startsWith('Sockets: ')) {
        item.sockets = line.replace('Sockets: ', '').trim();
      }

      // Requirements
      if (line.startsWith('Requirements:')) {
         item.requirements = { level: 0, str: 0, dex: 0, int: 0 };
      }
      if (item.requirements) {
        if (line.includes('Level:')) item.requirements.level = parseInt(line.match(/Level: (\d+)/)?.[1] || '0');
        if (line.includes('Str:')) item.requirements.str = parseInt(line.match(/Str: (\d+)/)?.[1] || '0');
        if (line.includes('Dex:')) item.requirements.dex = parseInt(line.match(/Dex: (\d+)/)?.[1] || '0');
        if (line.includes('Int:')) item.requirements.int = parseInt(line.match(/Int: (\d+)/)?.[1] || '0');
      }

      // Physical Damage
      if (line.startsWith('Physical Damage: ')) {
        const match = line.match(/(\d+)-(\d+)/);
        if (match) {
          minPhys = parseInt(match[1]);
          maxPhys = parseInt(match[2]);
        }
      }

      // Elemental Damage
      if (line.startsWith('Elemental Damage: ')) {
        // Can have multiple segments e.g. 5-10 (Fire), 2-4 (Cold)
        // Actually copy text is usually: "Elemental Damage: 27-52 (aug), 25-45 (aug)"
        const matches = line.matchAll(/(\d+)-(\d+)/g);
        for (const m of matches) {
          minElem += parseInt(m[1]);
          maxElem += parseInt(m[2]);
        }
      }
      
      // Chaos Damage (usually distinct line "Chaos Damage: ...")
      if (line.startsWith('Chaos Damage: ')) {
         const match = line.match(/(\d+)-(\d+)/);
        if (match) {
          minChaos = parseInt(match[1]);
          maxChaos = parseInt(match[2]);
        }
      }

      // APS
      if (line.startsWith('Attacks per Second: ')) {
        aps = parseFloat(line.replace('Attacks per Second: ', ''));
      }

      // Item Level
      if (line.startsWith('Item Level: ')) {
        item.itemLevel = parseInt(line.replace('Item Level: ', ''));
      }

      // Defenses
      if (line.startsWith('Armour: ')) {
         const val = parseInt(line.replace('Armour: ', ''));
         item.defenses = { ...item.defenses, armor: val } as any;
         item.armour = val;
      }
      if (line.startsWith('Evasion Rating: ')) {
         const val = parseInt(line.replace('Evasion Rating: ', ''));
         item.defenses = { ...item.defenses, evasion: val } as any;
         item.evasion = val;
      }
      if (line.startsWith('Energy Shield: ')) {
         const val = parseInt(line.replace('Energy Shield: ', ''));
         item.defenses = { ...item.defenses, es: val } as any;
         item.energyShield = val;
      }
      
      // Store Properties for Quality lookup
      // Basic Property Parser: "Name: Value"
      const propMatch = line.match(/^([^:]+): (.+)$/);
      if (propMatch) {
          if (!item.properties) item.properties = [];
          item.properties.push({ name: propMatch[1], value: propMatch[2], type: 0 });
      }
    }

    // Modifiers Logic
    if (aps > 0) {
      item.dps = {
        phys: (minPhys + maxPhys) / 2 * aps,
        elem: (minElem + maxElem) / 2 * aps,
        chaos: (minChaos + maxChaos) / 2 * aps,
        total: 0,
        aps: aps
      };
      item.dps.total = item.dps.phys + item.dps.elem + item.dps.chaos;
    }

    const allLines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0 && l !== '--------');
    
    // Simple exclusion list of things we already parsed/know are not mods
    const nonModPrefixes = [
      'Rarity:', 'Quality:', 'Sockets:', 'Level:', 'Str:', 'Dex:', 'Int:', 'Physical Damage:', 
      'Elemental Damage:', 'Chaos Damage:', 'Attacks per Second:', 'Critical Strike Chance:',
      'Armour:', 'Evasion Rating:', 'Energy Shield:', 'Requirements:', 'Item Level:', 'Note:', 'Prefix Modifier', 'Suffix Modifier',
      'Item Class:', 'Weapon Range:'
    ];

    const isMod = (line: string) => {
       if (line === item.name || line === item.baseType || line === item.rarity || line === item.class) return false;
       for (const p of nonModPrefixes) if (line.startsWith(p)) return false;
       
       // Filter out Item Class variations (e.g. "Two Handed Sword" vs "Two Hand Swords")
       if (item.class) {
          const normLine = line.replace('Handed', 'Hand').replace(/s$/, '').toLowerCase();
          const normClass = item.class.replace('Handed', 'Hand').replace(/s$/, '').toLowerCase();
          if (normLine === normClass) return false;
       }

       // Exclude "Corrupted" tag for now (or treat as mod?)
       if (line === 'Corrupted') return true; 
       return true;
    };

    item.modifiers.explicit = allLines.filter(isMod);
    
    // Attempt to categorize (very rough)
    // If we want "Implicits" vs "Explicits", we need the separators.
    
    const splitSections = text.split('--------').map(s => s.trim().split(/\r?\n/).map(l => l.trim()).filter(l=>l.length>0));
    // Header is always 0
    // If weapon, Stats is 1
    // If has sockets, Sockets is ?
    
    // Let's try to detect implicit section logic later.
    // For now, put everything in 'explicit' for the visual bar 
    
    return item;
  }
}
