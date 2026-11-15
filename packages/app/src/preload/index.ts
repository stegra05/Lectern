/**
 * The bridge the interface sees as `window.lectern`. It forwards engine commands to the main
 * process and hands the events back, and exposes the few things only the shell can do.
 */

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { Bridge, Command, Design, Event } from '../shared/contract.ts'

let nextRun = 0

const bridge: Bridge = {
  async run(command: Command, onEvent: (event: Event) => void) {
    const id = nextRun++
    let received = 0
    let expected = Infinity
    let allHere = () => {}
    const listener = (_: IpcRendererEvent, run: number, event: Event) => {
      if (run !== id) return
      onEvent(event)
      if (++received >= expected) allHere()
    }
    ipcRenderer.on('engine:event', listener)
    try {
      // The answer that the command has finished can overtake its last events: the two travel
      // separately. So the main process says how many events it sent, and this waits for them.
      expected = (await ipcRenderer.invoke('engine:run', id, command)) as number
      if (received < expected) await new Promise<void>((resolve) => (allHere = resolve))
    } finally {
      ipcRenderer.off('engine:event', listener)
    }
  },
  settings: () => ipcRenderer.invoke('settings:get'),
  setDesign: (design: Design) => ipcRenderer.invoke('settings:design', design),
  saveKey: (key: string) => ipcRenderer.invoke('key:save', key),
  platform: process.platform,
}

contextBridge.exposeInMainWorld('lectern', bridge)
