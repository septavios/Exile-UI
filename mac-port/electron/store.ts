import Store from 'electron-store';

interface StoreSchema {
  league: string;
  stats: {
    deaths: number;
    maps: number;
  }
}

const store = new Store<StoreSchema>({
  defaults: {
    league: 'Settlers',
    stats: { deaths: 0, maps: 0 }
  }
});

export default store;
