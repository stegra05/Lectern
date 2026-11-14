/**
 * The Electron shell: one window, and the channel that carries the engine's commands and
 * events between the interface and the engine, which runs here in the main process.
 *
 * Environment, for tests and development:
 *   LECTERN_FAKE=1         run on the offline models: no key, no network, no cost
 *   LECTERN_FAKE_DELAY=<ms> how long each call of the offline models takes (default 0)
 *   LECTERN_COURSES=<dir>  where courses live (default: "courses" in the app's data folder)
 *   LECTERN_DATA=<dir>     the app's data folder (settings and the stored key)
 *   OPENAI_API_KEY         a key that wins over the stored one
 */

import { app, BrowserWindow, ipcMain, nativeTheme, shell } from 'electron'
import { join } from 'node:path'
import type { Design } from '../shared/contract.ts'
import { engineFor } from './engine.ts'
import { settingsStore } from './settings.ts'

if (process.env.LECTERN_DATA) app.setPath('userData', process.env.LECTERN_DATA)

const fake = process.env.LECTERN_FAKE === '1'
const fakeDelayMs = Number(process.env.LECTERN_FAKE_DELAY ?? 0)
const courses = process.env.LECTERN_COURSES ?? join(app.getPath('userData'), 'courses')
const settings = settingsStore(app.getPath('userData'), fake)

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 900,
    minHeight: 600,
    useContentSize: true,
    show: false,
    title: 'Lectern',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 14, y: 12 },
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1C1C1E' : '#EFEFF2',
    webPreferences: { preload: join(import.meta.dirname, '../preload/index.cjs') },
  })
  window.once('ready-to-show', () => window.show())
  // The interface opens no links of its own. Anything that tries goes to the browser.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  if (process.env.ELECTRON_RENDERER_URL) void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void window.loadFile(join(import.meta.dirname, '../renderer/index.html'))
}

ipcMain.handle('engine:run', async (event, id: number, command: unknown) => {
  const engine = engineFor({ courses, key: fake ? null : await settings.key(), fake, fakeDelayMs })
  await engine.run(command, (engineEvent) => {
    if (!event.sender.isDestroyed()) event.sender.send('engine:event', id, engineEvent)
  })
})
ipcMain.handle('settings:get', () => settings.get())
ipcMain.handle('settings:design', (_, design: Design) => settings.setDesign(design))
ipcMain.handle('key:save', (_, key: string) => settings.saveKey(key))

void app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
