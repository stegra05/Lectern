/** A file the student added, with its path inside the folder it came in, or just its name. */
export interface Picked {
  path: string
  file: File
}

/** The files of a file input, folder inputs included. */
export function fromInput(list: FileList | null): Picked[] {
  return [...(list ?? [])].map((file) => ({ path: file.webkitRelativePath || file.name, file }))
}

/**
 * The files of a drop, with every file inside a dropped folder and its subfolders. The entries
 * are taken before the first wait, since a drop's items are gone once its handler returns.
 */
export async function fromDrop(transfer: DataTransfer): Promise<Picked[]> {
  const items = [...transfer.items].filter((item) => item.kind === 'file')
  const dropped = items.map((item) => ({ entry: item.webkitGetAsEntry(), file: item.getAsFile() }))
  const picked = await Promise.all(
    dropped.map(async ({ entry, file }) =>
      entry ? walk(entry) : file ? [{ path: file.name, file }] : [],
    ),
  )
  return picked.flat()
}

async function walk(entry: FileSystemEntry): Promise<Picked[]> {
  const path = entry.fullPath.replace(/^\//, '')
  if (isFile(entry)) {
    const file = await new Promise<File>((resolve, reject) => entry.file(resolve, reject))
    return [{ path, file }]
  }
  if (!isDirectory(entry)) return []
  const reader = entry.createReader()
  const children: FileSystemEntry[] = []
  // A reader hands a large folder over in batches and ends with an empty one.
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
      reader.readEntries(resolve, reject),
    )
    if (batch.length === 0) break
    children.push(...batch)
  }
  return (await Promise.all(children.map(walk))).flat()
}

const isFile = (entry: FileSystemEntry): entry is FileSystemFileEntry => entry.isFile
const isDirectory = (entry: FileSystemEntry): entry is FileSystemDirectoryEntry => entry.isDirectory
