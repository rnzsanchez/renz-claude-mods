export type ChatCalloutsStyle = 'label' | 'box' | 'bar'

export type ChatCalloutsPrefs = { style: ChatCalloutsStyle; isOn: boolean; width: number; isMineFramed: boolean; isDrafts: boolean }

declare module 'claude-code' {
  interface PluginState {
    'chat-callouts': { seenAt: StateFamily<number> }
  }
}
