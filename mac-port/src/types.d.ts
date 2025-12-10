export {};

declare global {
  interface Window {
    electron: {
      send: (channel: string, data: any) => void;
      invoke: (channel: string, data?: any) => Promise<any>;
      invoke(channel: 'get-stats'): Promise<any>;
      invoke(channel: 'get-settings'): Promise<any>;
      invoke(channel: 'get-leagues'): Promise<string[]>;
      invoke(channel: 'price-check', payload: { item: any, league: string }): Promise<any>;
      invoke(channel: 'automation-send-chat', message: string): Promise<void>;
      invoke(channel: 'open-external', url: string): Promise<void>;
      send(channel: 'set-setting', data: { key: string; value: any }): void;
      // ... other IPC ...
      on: (channel: string, func: (...args: any[]) => void) => void;
    };
  }
}
