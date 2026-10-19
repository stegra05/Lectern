/**
 * PDFs uploaded to a model provider and not yet removed. Gemini deletes
 * uploads after two days on its own; OpenAI and Anthropic keep them in the
 * student's account until someone deletes them. The list is written down so
 * an upload left behind by a crash or a quit is still found and removed on
 * the next launch.
 *
 * Tauri store file in the app data dir, localStorage in plain-browser dev mode.
 */

import { load } from '@tauri-apps/plugin-store'
import type { ProviderId } from '../engine/config'
import type { DocumentRef } from '../engine/llm'
import { IS_TAURI } from './platform'

export interface Upload {
  provider: ProviderId
  document: DocumentRef
}

const STORE_FILE = 'uploads.json'
const STORE_KEY = 'uploads'
const LS_KEY = 'lectern-uploads'

async function read(): Promise<Upload[]> {
  try {
    if (!IS_TAURI) return JSON.parse(localStorage.getItem(LS_KEY) ?? '[]') as Upload[]
    const store = await load(STORE_FILE, { autoSave: false, defaults: {} })
    return (await store.get<Upload[]>(STORE_KEY)) ?? []
  } catch {
    return []
  }
}

async function write(uploads: Upload[]): Promise<void> {
  if (!IS_TAURI) {
    localStorage.setItem(LS_KEY, JSON.stringify(uploads))
    return
  }
  const store = await load(STORE_FILE, { autoSave: false, defaults: {} })
  await store.set(STORE_KEY, uploads)
  await store.save()
}

/** Every change is a read-modify-write of one file, so they run one at a
 *  time: a new run's upload can land while the last one's are removed. */
let queue: Promise<unknown> = Promise.resolve()
function serial<T>(task: () => Promise<T>): Promise<T> {
  const next = queue.then(task, task)
  queue = next.catch(() => undefined)
  return next
}

export const listUploads = (): Promise<Upload[]> => serial(read)

export const rememberUpload = (upload: Upload): Promise<void> =>
  serial(async () => write([...(await read()), upload]))

export const forgetUpload = (upload: Upload): Promise<void> =>
  serial(async () =>
    write(
      (await read()).filter(
        (u) => !(u.provider === upload.provider && u.document.id === upload.document.id),
      ),
    ),
  )
