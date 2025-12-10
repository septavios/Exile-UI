import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('electron', {
    send: (channel, data) => {
        // whitelist channels
        let validChannels = ['item-data', 'simulation-jump', 'simulation-reset', 'set-ignore-mouse-events'];
        if (validChannels.includes(channel)) {
            ipcRenderer.send(channel, data);
        }
    },
    invoke: (channel, data) => {
        let validChannels = ['get-stats'];
        if (validChannels.includes(channel)) {
            return ipcRenderer.invoke(channel, data);
        }
        return Promise.reject(new Error(`Invalid invoke channel: ${channel}`)); // Or handle as appropriate
    },
    on: (channel, func) => {
        console.log(`[Preload] Registering listener for ${channel}`);
        const subscription = (_event, ...args) => {
            console.log(`[Preload] Received ${channel}`, args);
            func(...args);
        };
        ipcRenderer.on(channel, subscription);
    },
});
