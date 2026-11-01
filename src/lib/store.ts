// 録画チャンクを受け取るたび IndexedDB へ保存する。
// 1秒ごとを要求しているが、実際に渡される間隔はブラウザ次第。
// Chrome では9秒の録画で約1KBしか届かず、強制終了時はほとんど残らなかった。Safari は実機で要確認。
// Safari は IndexedDB 内の Blob が読めなくなる事例があるので ArrayBuffer で持つ。

export type Clip = {
  id: string
  name: string
  createdAt: number
  durationMs: number
  bytes: number
  mime: string
  status: 'recording' | 'done' | 'recovered'
  good: boolean
  width: number
  height: number
  fps: number
}

const DB_NAME = 'rushes'
let dbPromise: Promise<IDBDatabase> | null = null

function db(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      req.result.createObjectStore('clips', { keyPath: 'id' })
      req.result.createObjectStore('chunks')
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

function result<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function putClip(clip: Clip) {
  const tx = (await db()).transaction('clips', 'readwrite')
  tx.objectStore('clips').put(clip)
  await done(tx)
}

export async function listClips(): Promise<Clip[]> {
  const tx = (await db()).transaction('clips')
  const clips = await result(tx.objectStore('clips').getAll() as IDBRequest<Clip[]>)
  return clips.sort((a, b) => b.createdAt - a.createdAt)
}

export async function appendChunk(clipId: string, seq: number, data: ArrayBuffer) {
  const tx = (await db()).transaction('chunks', 'readwrite')
  tx.objectStore('chunks').put(data, [clipId, seq])
  await done(tx)
}

const chunkRange = (clipId: string) =>
  IDBKeyRange.bound([clipId, 0], [clipId, Number.MAX_SAFE_INTEGER])

export async function clipBlob(clip: Clip): Promise<Blob> {
  const tx = (await db()).transaction('chunks')
  const parts = await result(tx.objectStore('chunks').getAll(chunkRange(clip.id)) as IDBRequest<ArrayBuffer[]>)
  return new Blob(parts, { type: clip.mime.split(';')[0] })
}

export async function deleteClip(id: string) {
  const tx = (await db()).transaction(['clips', 'chunks'], 'readwrite')
  tx.objectStore('clips').delete(id)
  tx.objectStore('chunks').delete(chunkRange(id))
  await done(tx)
}

// 前回 'recording' のまま終わったクリップは、保存済みチャンクの範囲で復元扱いにする。
export async function recoverInterrupted(): Promise<number> {
  const clips = await listClips()
  const broken = clips.filter((c) => c.status === 'recording')
  // 最初の保存より前に止まったクリップは中身がないので、一覧に残さない。
  await Promise.all(broken.map((c) => (c.bytes > 0 ? putClip({ ...c, status: 'recovered' }) : deleteClip(c.id))))
  return broken.filter((c) => c.bytes > 0).length
}

export async function storageLeft(): Promise<number | null> {
  try {
    const { quota, usage } = await navigator.storage.estimate()
    if (quota == null || usage == null) return null
    return Math.max(0, quota - usage)
  } catch {
    return null
  }
}
