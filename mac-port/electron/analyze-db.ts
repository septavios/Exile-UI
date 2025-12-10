
import * as fs from 'fs';
import * as path from 'path';

const dbPath = '/Users/a000/Project3/Exile-UI/data/global/item mods.json';

try {
  const data = fs.readFileSync(dbPath, 'utf8');
  const json = JSON.parse(data);
  const keys = Object.keys(json);
  console.log('Top Level Keys:', keys);
  
  // efficient sampling of sub-keys
  keys.forEach(key => {
    const subKeys = Object.keys(json[key]);
    console.log(`Key: ${key}, Count: ${subKeys.length}, Sample: ${subKeys.slice(0, 3)}`);
  });

} catch (e) {
  console.error('Error:', e);
}
