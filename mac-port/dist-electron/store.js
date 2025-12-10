import Store from 'electron-store';
const store = new Store({
    defaults: {
        league: 'Settlers',
        stats: { deaths: 0, maps: 0 }
    }
});
export default store;
