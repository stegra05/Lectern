/**
 * The Electron shell: one window, and the channel that carries the engine's commands and
 * events between the interface and the engine, which runs here in the main process.
 *
 * Environment, for tests and development (read only when the app is not packaged, apart from
 * OPENAI_API_KEY):
 *   LECTERN_FAKE=1         run on the offline models and an Anki in memory: no key, no
 *                          network, no cost, and nothing reaches the real Anki
 *   LECTERN_FAKE_DELAY=<ms> how long each call of the offline models takes (default 0)
 *   LECTERN_COURSES=<dir>  where courses live (default: "courses" in the app's data folder)
 *   LECTERN_DATA=<dir>     the app's data folder (settings and the stored key)
 *   OPENAI_API_KEY         a key that wins over the stored one
 *   LECTERN_SHOW=0         keep the window off the screen, for tests
 */

import { app, BrowserWindow, ipcMain, nativeTheme, shell } from 'electron'
import { join } from 'node:path'
import { engineFor } from './engine.ts'
import { settingsStore } from './settings.ts'

// A shipped app ignores the test variables, so a stray one cannot send cards to nowhere.
const env = app.isPackaged ? {} : process.env

if (env.LECTERN_DATA) app.setPath('userData', env.LECTERN_DATA)

const fake = env.LECTERN_FAKE === '1'
const fakeDelayMs = Number(env.LECTERN_FAKE_DELAY ?? 0)
const courses = env.LECTERN_COURSES ?? join(app.getPath('userData'), 'courses')
// The note type files Anki receives. Packaged, they ship as a resource of the app
// (electron-builder.yml); in development they are read from the engine in the repository.
const templates = app.isPackaged
  ? join(process.resourcesPath, 'anki')
  : join(app.getAppPath(), '../engine/anki')
const settings = settingsStore(app.getPath('userData'), fake)
// Rendered from design/icon/master.py by design/icon/export.sh.
const icon = join(app.getAppPath(), 'resources/icon.png')

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 900,
    minHeight: 600,
    useContentSize: true,
    show: false,
    title: 'Lectern',
    icon,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 14, y: 12 },
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1C1C1E' : '#EFEFF2',
    webPreferences: { preload: join(import.meta.dirname, '../preload/index.cjs') },
  })
  // A test drives the window without putting it on the student's screen.
  if (env.LECTERN_SHOW !== '0') window.once('ready-to-show', () => window.show())
  // The interface opens no links of its own. Anything that tries goes to the browser.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  // A PDF dropped outside a drop zone must not replace the interface. Only the dev server's own
  // pages may load.
  const devServer = env.ELECTRON_RENDERER_URL
  window.webContents.on('will-navigate', (navigation, url) => {
    if (!devServer || new URL(url).origin !== new URL(devServer).origin) navigation.preventDefault()
  })
  if (devServer) void window.loadURL(devServer)
  else void window.loadFile(join(import.meta.dirname, '../renderer/index.html'))
}

ipcMain.handle('engine:run', async (event, id: number, command: unknown) => {
  const engine = engineFor({
    courses,
    templates,
    key: fake ? null : await settings.key(),
    fake,
    fakeDelayMs,
    notesFile: join(app.getPath('userData'), 'anki-notes.json'),
  })
  let sent = 0
  await engine.run(command, (engineEvent) => {
    if (event.sender.isDestroyed()) return
    event.sender.send('engine:event', id, engineEvent)
    sent++
  })
  // How many events went out: the interface waits for all of them, see the preload script.
  return sent
})
ipcMain.handle('settings:get', () => settings.get())
ipcMain.handle('key:save', (_, key: string) => settings.saveKey(key))

void app.whenReady().then(() => {
  // Unpackaged, macOS would show Electron's own icon in the Dock.
  if (!app.isPackaged) app.dock?.setIcon(icon)
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
