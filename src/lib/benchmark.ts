import { bitrate, codecName, listLenses, MIME_CANDIDATES, pickMime, readControls, type CameraSettings, type Codec, type Resolution } from './camera'
import { BUILTIN_LUTS } from './lut'
import { Monitor } from './monitor'
import { appendChunk, clipBlob, deleteClip, storageLeft, type Clip } from './store'

export type BenchMode = 'standard' | 'long'
type Config = { resolution: Resolution; fps: CameraSettings['fps']; codec: Codec; seconds: number }

const CONFIGS: Record<BenchMode, Config[]> = {
  standard: [
    { resolution: '1080p', fps: 30, codec: 'hevc', seconds: 6 },
    { resolution: '4K', fps: 30, codec: 'hevc', seconds: 6 },
    { resolution: '4K', fps: 30, codec: 'h264', seconds: 6 },
    { resolution: '4K', fps: 60, codec: 'hevc', seconds: 6 },
  ],
  long: [{ resolution: '4K', fps: 30, codec: 'hevc', seconds: 180 }],
}

export type BenchResult = {
  label: string
  error?: string
  actual?: string
  mime?: string
  targetMbps?: number
  previewFps?: number
  overlayFrameMs?: number
  overlayRafFps?: number
  recordMbps?: number
  fpsWhileRecording?: number[]
  chunks?: number
  firstChunkMs?: number | null
  maxChunkGapMs?: number
  savedBeforeStopPct?: number
  writeMBps?: number
  playableSec?: number | null
}

export type BenchReport = {
  mode: BenchMode
  at: string
  env: Record<string, unknown>
  results: BenchResult[]
}

const round = (n: number, d = 1) => Number(n.toFixed(d))
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

function countFrames(video: HTMLVideoElement, ms: number): Promise<number> {
  return new Promise((resolve) => {
    let frames = 0
    let handle = 0
    const tick = () => {
      frames++
      handle = video.requestVideoFrameCallback(tick)
    }
    handle = video.requestVideoFrameCallback(tick)
    setTimeout(() => {
      video.cancelVideoFrameCallback(handle)
      resolve(round((frames * 1000) / ms))
    }, ms)
  })
}

// 全オーバーレイを有効にして、1フレームの描画コストを測る。
function overlayLoad(video: HTMLVideoElement, ms: number): Promise<{ frameMs: number; rafFps: number }> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas')
    let monitor: Monitor
    try {
      monitor = new Monitor(canvas)
      monitor.setLut(BUILTIN_LUTS[0])
    } catch (e) {
      return reject(e)
    }
    const start = performance.now()
    let n = 0
    let cost = 0
    const loop = (t: number) => {
      const t0 = performance.now()
      monitor.render(video, { lut: true, falseColor: false, zebra: true, zebraLevel: 0.95, peaking: true }, t / 1000)
      cost += performance.now() - t0
      n++
      if (t0 - start < ms) return void requestAnimationFrame(loop)
      canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext()
      resolve({ frameMs: round(cost / n), rafFps: round((n * 1000) / (t0 - start)) })
    }
    requestAnimationFrame(loop)
  })
}

function playableDuration(blob: Blob): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob)
    const video = document.createElement('video')
    const finish = (v: number | null) => {
      clearTimeout(timer)
      URL.revokeObjectURL(url)
      video.removeAttribute('src')
      video.load()
      resolve(v)
    }
    const timer = setTimeout(() => finish(null), 8000)
    video.muted = true
    video.playsInline = true
    video.preload = 'metadata'
    video.onloadedmetadata = () => finish(Number.isFinite(video.duration) ? round(video.duration, 2) : -1)
    video.onerror = () => finish(null)
    video.src = url
    video.load()
  })
}

async function recordTest(stream: MediaStream, video: HTMLVideoElement, mime: string, bps: number, seconds: number, onSecond: (s: number) => void) {
  const id = 'bench'
  await deleteClip(id)
  const arrivals: number[] = []
  let bytes = 0
  let writeBytes = 0
  let writeMs = 0
  let chain: Promise<unknown> = Promise.resolve()
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: bps, audioBitsPerSecond: 192_000 })
  const stopped = new Promise<void>((resolve) => (rec.onstop = () => resolve()))
  rec.ondataavailable = (e) => {
    if (!e.data.size) return
    const n = arrivals.length
    arrivals.push(performance.now())
    bytes += e.data.size
    const blob = e.data
    chain = chain.then(async () => {
      const buffer = await blob.arrayBuffer()
      const t0 = performance.now()
      await appendChunk(id, n, buffer)
      writeMs += performance.now() - t0
      writeBytes += buffer.byteLength
    })
  }
  const started = performance.now()
  rec.start(1000)
  const ticker = setInterval(() => onSecond(Math.round((performance.now() - started) / 1000)), 1000)
  const fps: number[] = []
  const segment = Math.min(30, seconds) * 1000
  for (let left = seconds * 1000; left > 0; left -= segment) fps.push(await countFrames(video, Math.min(segment, left)))
  clearInterval(ticker)
  const bytesBeforeStop = bytes
  const elapsed = (performance.now() - started) / 1000
  rec.stop()
  await stopped
  await chain

  const gaps = arrivals.slice(1).map((t, i) => t - arrivals[i])
  const blob = await clipBlob({ id, mime } as Clip)
  const playableSec = await playableDuration(blob)
  await deleteClip(id)
  return {
    recordMbps: round((bytes * 8) / elapsed / 1e6),
    fpsWhileRecording: fps,
    chunks: arrivals.length,
    firstChunkMs: arrivals.length ? Math.round(arrivals[0] - started) : null,
    maxChunkGapMs: gaps.length ? Math.round(Math.max(...gaps)) : 0,
    savedBeforeStopPct: bytes ? Math.round((bytesBeforeStop / bytes) * 100) : 0,
    writeMBps: writeMs ? round(writeBytes / 1e6 / (writeMs / 1000)) : 0,
    playableSec,
  }
}

function environment(stream: MediaStream | null) {
  const canvas = document.createElement('canvas')
  const gl = canvas.getContext('webgl2')
  const debug = gl?.getExtension('WEBGL_debug_renderer_info')
  const info = gl
    ? { renderer: gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER), maxTexture: gl.getParameter(gl.MAX_TEXTURE_SIZE) }
    : null
  gl?.getExtension('WEBGL_lose_context')?.loseContext()
  const track = stream?.getVideoTracks()[0]
  return {
    ua: navigator.userAgent,
    screen: `${screen.width}x${screen.height}@${devicePixelRatio}`,
    cores: navigator.hardwareConcurrency,
    standalone: matchMedia('(display-mode: standalone)').matches,
    webgl2: info,
    mime: MIME_CANDIDATES.filter((m) => MediaRecorder.isTypeSupported(m)),
    capabilities: track ? readControls(track).reported : [],
  }
}

export async function runBenchmark(opts: {
  mode: BenchMode
  video: HTMLVideoElement
  getStream: () => MediaStream | null
  acquire: (s: CameraSettings) => Promise<void>
  base: CameraSettings
  onProgress: (text: string) => void
}): Promise<BenchReport> {
  const { mode, video, getStream, acquire, base, onProgress } = opts
  const configs = CONFIGS[mode]
  const env: Record<string, unknown> = environment(getStream())
  const left = await storageLeft()
  env.storageLeftGB = left == null ? null : round(left / 1e9)
  env.lenses = (await listLenses()).map((l) => l.label)
  const results: BenchResult[] = []

  for (const [i, c] of configs.entries()) {
    const label = `${c.resolution} ${c.fps}fps ${c.codec}`
    const prefix = `${i + 1}/${configs.length} ${label}`
    const result: BenchResult = { label }
    results.push(result)
    try {
      onProgress(`${prefix}: カメラ切り替え`)
      const settings: CameraSettings = { ...base, resolution: c.resolution, fps: c.fps, codec: c.codec, quality: 'high' }
      await acquire(settings)
      await wait(1000)
      const stream = getStream()
      if (!stream) throw new Error('映像を取得できませんでした')
      const actual = stream.getVideoTracks()[0].getSettings()
      result.actual = `${actual.width}x${actual.height}@${actual.frameRate}`
      result.mime = pickMime(c.codec)
      result.targetMbps = bitrate(settings) / 1e6
      onProgress(`${prefix}: プレビュー測定`)
      result.previewFps = await countFrames(video, 3000)
      onProgress(`${prefix}: 表示処理の負荷測定`)
      const load = await overlayLoad(video, 3000)
      result.overlayFrameMs = load.frameMs
      result.overlayRafFps = load.rafFps
      Object.assign(result, await recordTest(stream, video, result.mime, bitrate(settings), c.seconds, (s) => onProgress(`${prefix}: 録画 ${s}/${c.seconds}秒`)))
    } catch (e) {
      result.error = `${(e as Error).name}: ${(e as Error).message}`
    }
  }
  return { mode, at: new Date().toISOString(), env, results }
}

export const summarize = (r: BenchResult) =>
  r.error
    ? `失敗: ${r.error}`
    : `実際 ${r.actual} / ${r.mime ? codecName(r.mime) : '-'} / プレビュー ${r.previewFps}fps / 録画中 ${r.fpsWhileRecording?.join('→')}fps / 描画 ${r.overlayFrameMs}ms / ${r.recordMbps}Mbps / 途中保存 ${r.savedBeforeStopPct}% / 再生確認 ${r.playableSec == null ? 'NG' : r.playableSec === -1 ? '長さ不明' : `${r.playableSec}秒`}`
