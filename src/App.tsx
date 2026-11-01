import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Clapperboard, Grid3x3, Settings2, SlidersHorizontal, Upload } from 'lucide-react'
import { AudioMeter, Histogram } from './components/Scopes'
import { Benchmark } from './components/Benchmark'
import { ClipList } from './components/Clips'
import { Guides, type GuideAspect } from './components/Guides'
import { Segmented, Sheet, Toggle } from './components/ui'
import {
  applyControl, bitrate, codecName, listLenses, openStream, pickMime, readControls, setAuto, setTorch,
  type CameraSettings, type Lens, type RangeControl,
} from './lib/camera'
import { runBenchmark, type BenchMode, type BenchReport } from './lib/benchmark'
import { BUILTIN_LUTS, parseCube, type Lut } from './lib/lut'
import { Monitor } from './lib/monitor'
import { appendChunk, listClips, putClip, recoverInterrupted, storageLeft, type Clip } from './lib/store'

type Saved = CameraSettings & {
  pro: boolean
  thirds: boolean
  aspect: GuideAspect
  zebraLevel: number
  reel: number
  scene: number
  take: number
}

const DEFAULTS: Saved = {
  deviceId: null, resolution: '4K', fps: 30, codec: 'hevc', quality: 'medium',
  pro: false, thirds: false, aspect: 'off', zebraLevel: 95, reel: 1, scene: 1, take: 1,
}

function loadSaved(): Saved {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('rushes') ?? '{}') }
  } catch {
    return DEFAULTS
  }
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0')
const timecode = (ms: number, fps: number) => {
  const s = Math.floor(ms / 1000)
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}:${pad(Math.floor(((ms % 1000) / 1000) * fps))}`
}
const stamp = (d: Date) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`

function ToolButton({ label, active, onClick, children }: { label: string; active: boolean; onClick: () => void; children?: React.ReactNode }) {
  return (
    <button
      aria-pressed={active}
      onClick={onClick}
      className={`flex h-11 min-w-0 flex-1 items-center justify-center gap-1 rounded-lg px-1 font-mono text-[12px] transition-colors duration-200 ${active ? 'bg-lamp text-ink' : 'bg-raised text-fg'}`}
    >
      {children}
      {label}
    </button>
  )
}

export default function App() {
  const [phase, setPhase] = useState<'intro' | 'starting' | 'live'>('intro')
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<Saved>(loadSaved)
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [lenses, setLenses] = useState<Lens[]>([])
  const [ranges, setRanges] = useState<RangeControl[]>([])
  const [torchAvailable, setTorchAvailable] = useState(false)
  const [torch, setTorchOn] = useState(false)
  const [reported, setReported] = useState<string[]>([])
  const [dims, setDims] = useState({ w: 16, h: 9 })
  const [box, setBox] = useState({ w: 0, h: 0 })
  const [sheet, setSheet] = useState<'none' | 'settings' | 'controls' | 'clips' | 'bench'>('none')
  const [recording, setRecording] = useState(false)
  const [clips, setClips] = useState<Clip[]>([])
  const [left, setLeft] = useState<number | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [measuredFps, setMeasuredFps] = useState<number | null>(null)
  const [falseColor, setFalseColor] = useState(false)
  const [zebra, setZebra] = useState(false)
  const [peaking, setPeaking] = useState(false)
  const [lut, setLut] = useState<Lut | null>(null)
  const [customLuts, setCustomLuts] = useState<Lut[]>([])
  const [benchRunning, setBenchRunning] = useState(false)
  const [benchProgress, setBenchProgress] = useState('')
  const [benchReport, setBenchReport] = useState<BenchReport | null>(null)

  const videoRef = useRef<HTMLVideoElement>(null)
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const monitorRef = useRef<Monitor | null>(null)
  const stageBox = useRef<HTMLDivElement>(null)
  const tcRef = useRef<HTMLSpanElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const clipRef = useRef<Clip | null>(null)
  const writesRef = useRef<Promise<unknown>>(Promise.resolve())
  const startedAt = useRef(0)
  const wakeLock = useRef<WakeLockSentinel | null>(null)
  const toastTimer = useRef<number>(0)

  const attachVideo = useCallback((el: HTMLVideoElement | null) => {
    videoRef.current = el
    setVideoEl(el)
  }, [])
  const update = useCallback((patch: Partial<Saved>) => setSaved((s) => ({ ...s, ...patch })), [])
  const say = useCallback((m: string) => {
    setToast(m)
    clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 4000)
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem('rushes', JSON.stringify(saved))
    } catch { /* 保存できなくても撮影は続行できる */ }
  }, [saved])

  const refreshClips = useCallback(async () => {
    setClips(await listClips())
    setLeft(await storageLeft())
  }, [])

  const mime = useMemo(() => {
    try {
      return pickMime(saved.codec)
    } catch {
      return null
    }
  }, [saved.codec])

  const rate = bitrate(saved)
  const minutesLeft = left == null ? null : Math.floor((left * 8) / (rate + 192_000) / 60)
  const overlays = falseColor || zebra || peaking || lut != null
  const clipName = `A${pad(saved.reel, 3)}_S${pad(saved.scene)}_T${pad(saved.take)}`

  const acquire = useCallback(async (settings: CameraSettings) => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    const next = await openStream(settings)
    streamRef.current = next
    setStream(next)
    setTorchOn(false)
    const video = videoRef.current
    if (video) {
      video.srcObject = next
      await video.play().catch(() => undefined)
    }
    const track = next.getVideoTracks()[0]
    const controls = readControls(track)
    setRanges(controls.ranges)
    setTorchAvailable(controls.torch)
    setReported(controls.reported)
    setLenses(await listLenses())
  }, [])

  const start = async () => {
    setPhase('starting')
    setError(null)
    try {
      if (!window.isSecureContext || !navigator.mediaDevices) {
        throw new Error('この接続ではカメラを使えません。https で始まるアドレスで開いてください。')
      }
      setPhase('live')
      await new Promise((r) => setTimeout(r, 0))
      await acquire(saved)
      const recovered = await recoverInterrupted()
      await refreshClips()
      if (recovered) say(`中断された ${recovered} 本のクリップを復元しました`)
      await navigator.storage?.persist?.().catch(() => false)
      wakeLock.current = await navigator.wakeLock?.request('screen').catch(() => null)
    } catch (e) {
      setPhase('intro')
      const err = e as Error
      setError(
        err.name === 'NotAllowedError'
          ? 'カメラかマイクが許可されていません。設定アプリの Safari → カメラ/マイク で「確認」か「許可」にして、再読み込みしてください。'
          : err.name === 'NotFoundError'
            ? 'カメラが見つかりませんでした。'
            : err.message || 'カメラを起動できませんでした。',
      )
    }
  }

  const restart = (patch: Partial<CameraSettings>) => {
    const next = { ...saved, ...patch }
    update(patch)
    acquire(next).catch(() => say('この設定には切り替えられませんでした'))
  }

  // ---- 記録 ----
  const stopRecording = useCallback(() => {
    const rec = recorderRef.current
    if (rec && rec.state !== 'inactive') rec.stop()
  }, [])

  const startRecording = async () => {
    const s = streamRef.current
    if (!s || !mime) return say('録画できる形式が見つかりませんでした')
    if (minutesLeft != null && minutesLeft < 1) return say('保存できる容量が足りません。クリップを書き出して削除してください')
    const settings = s.getVideoTracks()[0].getSettings()
    const clip: Clip = {
      id: crypto.randomUUID(), name: `${clipName}_${stamp(new Date())}`, createdAt: Date.now(), durationMs: 0, bytes: 0,
      mime, status: 'recording', good: false, width: settings.width ?? 0, height: settings.height ?? 0, fps: settings.frameRate ?? saved.fps,
    }
    let rec: MediaRecorder
    try {
      rec = new MediaRecorder(s, { mimeType: mime, videoBitsPerSecond: rate, audioBitsPerSecond: 192_000 })
    } catch {
      return say('この設定では録画を始められませんでした。画質か解像度を下げてください')
    }
    try {
      await putClip(clip)
    } catch {
      return say('保存領域を使えません。プライベートブラウズでは録画できません')
    }
    let seq = 0
    clipRef.current = clip
    rec.ondataavailable = (e) => {
      if (!e.data.size) return
      const n = seq++
      const current = clipRef.current!
      current.bytes += e.data.size
      current.durationMs = performance.now() - startedAt.current
      const blob = e.data
      // 到着順を守るため1本の鎖で書き込む。失敗は記録を止める側で扱う。
      writesRef.current = writesRef.current
        .then(async () => {
          await appendChunk(current.id, n, await blob.arrayBuffer())
          await putClip({ ...current })
        })
        .catch(() => {
          say('保存に失敗したので記録を止めました。ここまでの分は残っています')
          stopRecording()
        })
    }
    rec.onstop = () => {
      const current = clipRef.current
      recorderRef.current = null
      clipRef.current = null
      setRecording(false)
      writesRef.current = writesRef.current
        .then(async () => {
          if (current) await putClip({ ...current, status: 'done' })
          await refreshClips()
        })
        .catch(() => undefined)
    }
    rec.onerror = () => {
      say('記録中にエラーが起きました。ここまでの分は保存しています')
      stopRecording()
    }
    startedAt.current = performance.now()
    rec.start(1000)
    recorderRef.current = rec
    setRecording(true)
    update({ take: saved.take + 1 })
  }

  // カメラが奪われた、またはアプリが裏に回ったら記録を閉じる。
  useEffect(() => {
    const track = stream?.getVideoTracks()[0]
    if (!track) return
    const onEnd = () => {
      if (recorderRef.current) {
        stopRecording()
        say('カメラが停止したので記録を閉じました')
      }
    }
    track.addEventListener('ended', onEnd)
    return () => track.removeEventListener('ended', onEnd)
  }, [stream, stopRecording, say])

  useEffect(() => {
    const onVisible = () => {
      if (document.hidden) {
        if (recorderRef.current) {
          stopRecording()
          say('アプリが裏に回ったので記録を閉じました')
        }
        return
      }
      if (phase !== 'live') return
      navigator.wakeLock?.request('screen').then((w) => (wakeLock.current = w)).catch(() => undefined)
      const track = streamRef.current?.getVideoTracks()[0]
      if (!track || track.readyState === 'ended') acquire(saved).catch(() => say('カメラを再開できませんでした'))
      else void videoRef.current?.play().catch(() => undefined)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [phase, saved, acquire, stopRecording, say])

  // ---- 表示 ----
  useEffect(() => {
    const el = stageBox.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setBox({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [phase])

  useEffect(() => {
    const video = videoEl
    if (!video) return
    const onSize = () => video.videoWidth && setDims({ w: video.videoWidth, h: video.videoHeight })
    video.addEventListener('resize', onSize)
    video.addEventListener('loadedmetadata', onSize)
    let frames = 0
    let handle = 0
    const tick = () => {
      frames++
      handle = video.requestVideoFrameCallback(tick)
    }
    if ('requestVideoFrameCallback' in video) handle = video.requestVideoFrameCallback(tick)
    const id = setInterval(() => {
      setMeasuredFps(frames)
      frames = 0
    }, 1000)
    return () => {
      clearInterval(id)
      video.removeEventListener('resize', onSize)
      video.removeEventListener('loadedmetadata', onSize)
      if ('cancelVideoFrameCallback' in video) video.cancelVideoFrameCallback(handle)
    }
  }, [videoEl])

  useEffect(() => {
    if (!overlays || !videoEl || !canvasRef.current) return
    if (!monitorRef.current) {
      try {
        monitorRef.current = new Monitor(canvasRef.current)
      } catch {
        say('この端末ではモニタリング表示を使えません')
        return
      }
    }
    const monitor = monitorRef.current
    if (lut) monitor.setLut(lut)
    let raf = 0
    const loop = (t: number) => {
      monitor.render(videoEl, { lut: lut != null, falseColor, zebra, zebraLevel: saved.zebraLevel / 100, peaking }, t / 1000)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [overlays, videoEl, lut, falseColor, zebra, peaking, saved.zebraLevel, say])

  useEffect(() => {
    if (!recording) {
      if (tcRef.current) tcRef.current.textContent = timecode(0, saved.fps)
      return
    }
    let raf = 0
    const loop = () => {
      if (tcRef.current) tcRef.current.textContent = timecode(performance.now() - startedAt.current, saved.fps)
      raf = requestAnimationFrame(loop)
    }
    loop()
    return () => cancelAnimationFrame(raf)
  }, [recording, saved.fps])

  const runBench = async (mode: BenchMode) => {
    if (!videoRef.current || benchRunning) return
    setBenchRunning(true)
    setBenchReport(null)
    try {
      setBenchReport(await runBenchmark({
        mode, video: videoRef.current, getStream: () => streamRef.current, acquire, base: saved, onProgress: setBenchProgress,
      }))
    } catch (e) {
      say(`テストを完了できませんでした: ${(e as Error).message}`)
    }
    await acquire(saved).catch(() => say('カメラを再開できませんでした'))
    await refreshClips()
    setBenchRunning(false)
  }

  const importLut = async (file: File) => {
    try {
      const parsed = parseCube(await file.text(), file.name.replace(/\.cube$/i, ''))
      setCustomLuts((l) => [...l, parsed])
      setLut(parsed)
      say(`${parsed.name} を読み込みました(${parsed.size} ポイント)`)
    } catch (e) {
      say((e as Error).message)
    }
  }

  const scale = box.w && box.h ? Math.min(box.w / dims.w, box.h / dims.h) : 0
  const stage = { w: dims.w * scale, h: dims.h * scale }
  const lowFps = recording && measuredFps != null && measuredFps > 0 && measuredFps < saved.fps * 0.75
  const lowSpace = minutesLeft != null && minutesLeft < 5
  const track = stream?.getVideoTracks()[0]

  if (phase !== 'live') {
    return (
      <main className="flex h-full flex-col justify-end gap-6 px-6 pt-[env(safe-area-inset-top)] pb-[max(32px,env(safe-area-inset-bottom))]">
        <div className="flex flex-col gap-3">
          <h1 className="font-mono text-4xl font-semibold tracking-tight">Rushes</h1>
          <p className="max-w-md text-[15px] leading-relaxed text-dim">
            iPhone のカメラを、ピーキングやゼブラなどのモニタリング付きで使えます。録画はこの中に保存され、写真アプリへ書き出せます。
          </p>
          {error && <p role="alert" className="max-w-md text-[15px] leading-relaxed text-tally">{error}</p>}
        </div>
        <motion.button
          whileTap={{ scale: 0.97 }}
          disabled={phase === 'starting'}
          onClick={() => void start()}
          className="h-14 w-full max-w-md rounded-xl bg-fg text-[17px] font-semibold text-ink disabled:opacity-50"
        >
          {phase === 'starting' ? '起動しています…' : 'カメラを起動'}
        </motion.button>
      </main>
    )
  }

  return (
    <main className="relative grid h-full grid-rows-[auto_minmax(0,1fr)_auto] pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] landscape:grid-cols-[minmax(0,1fr)_minmax(150px,220px)] landscape:grid-rows-[auto_minmax(0,1fr)] landscape:pr-[env(safe-area-inset-right)] landscape:pl-[env(safe-area-inset-left)]">
      {/* 状態表示 */}
      <header className="flex items-center gap-3 px-3 py-1.5 font-mono text-[12px] tabular-nums landscape:col-span-2">
        <motion.span
          className="size-2.5 rounded-full bg-tally"
          animate={{ opacity: recording ? 1 : 0.25 }}
          transition={{ duration: 0.2 }}
          aria-hidden
        />
        <span ref={tcRef} className={`text-[15px] font-medium ${recording ? 'text-tally' : 'text-fg'}`}>00:00:00:00</span>
        <span className="min-w-0 flex-1 truncate text-dim">
          {Math.min(dims.w, dims.h)}p {saved.fps} {mime ? codecName(mime) : ''} {(rate / 1e6).toFixed(0)}M
        </span>
        <span className={`shrink-0 ${lowSpace ? 'text-tally' : 'text-dim'}`}>
          {minutesLeft == null ? '残量 --' : `残り ${minutesLeft > 999 ? '999+' : minutesLeft} 分`}
        </span>
      </header>

      {/* 映像 */}
      <div ref={stageBox} className="relative min-h-0 min-w-0 overflow-hidden landscape:col-start-1 landscape:row-start-2">
        <div
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 overflow-hidden bg-black"
          style={{ width: stage.w, height: stage.h }}
        >
          <motion.span
            className="pointer-events-none absolute inset-0 z-10 border-2 border-tally"
            animate={{ opacity: recording ? 1 : 0 }}
            transition={{ duration: 0.2 }}
            aria-hidden
          />
          <video
            ref={attachVideo}
            autoPlay
            muted
            playsInline
            className="absolute inset-0 size-full"
          />
          <canvas ref={canvasRef} className={`absolute inset-0 size-full ${overlays ? '' : 'invisible'}`} />
          <Guides thirds={saved.thirds} aspect={saved.aspect} width={stage.w} height={stage.h} />
          <AnimatePresence>
            {(lowFps || lowSpace) && (
              <motion.p
                role="status"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="absolute top-2 left-1/2 z-10 -translate-x-1/2 rounded bg-black/75 px-2 py-1 text-[13px] whitespace-nowrap text-lamp"
              >
                {lowFps ? `プレビュー ${measuredFps}fps に低下` : `この設定で残り ${minutesLeft} 分`}
              </motion.p>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* 操作 */}
      <footer className="flex flex-col gap-2 px-3 pt-2 pb-2 landscape:col-start-2 landscape:row-start-2 landscape:min-h-0 landscape:justify-end landscape:overflow-y-auto landscape:pr-1">
        {saved.pro && (
          <>
            <div className="grid grid-cols-2 items-center gap-3 landscape:grid-cols-1">
              <Histogram video={videoEl} />
              <AudioMeter stream={stream} />
            </div>
            <div className="flex gap-1.5">
              <ToolButton label="FALSE" active={falseColor} onClick={() => setFalseColor((v) => !v)} />
              <ToolButton label="ZEBRA" active={zebra} onClick={() => setZebra((v) => !v)} />
              <ToolButton label="PEAK" active={peaking} onClick={() => setPeaking((v) => !v)} />
              <ToolButton label="LUT" active={lut != null} onClick={() => setLut(lut ? null : (customLuts[0] ?? BUILTIN_LUTS[0]))} />
            </div>
          </>
        )}
        {lenses.length > 1 && (
          <div className="flex justify-center gap-1.5" role="group" aria-label="レンズ">
            {lenses.map((l) => {
              const current = track?.getSettings().deviceId === l.id
              return (
                <button
                  key={l.id}
                  aria-pressed={current}
                  disabled={recording}
                  onClick={() => restart({ deviceId: l.id })}
                  className={`h-11 min-w-11 rounded-full px-2 font-mono text-[12px] disabled:opacity-40 ${current ? 'bg-fg text-ink' : 'bg-raised text-fg'}`}
                >
                  {l.label}
                </button>
              )
            })}
          </div>
        )}
        <div className="grid grid-cols-3 items-center landscape:grid-cols-2 landscape:gap-y-2">
          <button aria-label="クリップ一覧" onClick={() => setSheet('clips')} className="relative grid size-12 place-items-center justify-self-start rounded-lg bg-raised">
            <Clapperboard size={22} />
            {clips.length > 0 && (
              <span className="absolute -top-1 -right-1 rounded-full bg-lamp px-1.5 font-mono text-[11px] text-ink">{clips.length}</span>
            )}
          </button>
          <motion.button
            aria-label={recording ? '記録を停止' : '記録を開始'}
            aria-pressed={recording}
            whileTap={{ scale: 0.93 }}
            onClick={() => (recording ? stopRecording() : void startRecording())}
            className="grid size-[72px] place-items-center justify-self-center rounded-full border-4 border-fg landscape:col-span-2 landscape:row-start-1"
          >
            <motion.span
              className="block bg-tally"
              animate={{ width: recording ? 26 : 54, height: recording ? 26 : 54, borderRadius: recording ? 5 : 27 }}
              transition={{ duration: 0.22, ease: 'easeOut' }}
            />
          </motion.button>
          <div className="flex gap-1.5 justify-self-end">
            <button aria-label="カメラ調整" onClick={() => setSheet('controls')} className="grid size-12 place-items-center rounded-lg bg-raised">
              <SlidersHorizontal size={22} />
            </button>
            <button aria-label="設定" onClick={() => setSheet('settings')} className="grid size-12 place-items-center rounded-lg bg-raised">
              <Settings2 size={22} />
            </button>
          </div>
        </div>
      </footer>

      <AnimatePresence>
        {toast && (
          <motion.p
            role="status"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22 }}
            className="fixed inset-x-4 top-[calc(env(safe-area-inset-top)+40px)] z-[60] mx-auto max-w-md rounded-lg bg-raised px-3 py-2 text-center text-[14px]"
          >
            {toast}
          </motion.p>
        )}
      </AnimatePresence>

      <Sheet open={sheet === 'clips'} title="クリップ" onClose={() => setSheet('none')}>
        <ClipList clips={clips} onChange={() => void refreshClips()} onMessage={say} />
      </Sheet>

      <Sheet open={sheet === 'controls'} title="カメラ調整" onClose={() => setSheet('none')}>
        {torchAvailable && track && (
          <Toggle
            label="ライト"
            checked={torch}
            onChange={(on) => {
              setTorchOn(on)
              setTorch(track, on).catch(() => say('ライトを切り替えられませんでした'))
            }}
          />
        )}
        {ranges.map((c) => (
          <label key={c.key} className="flex flex-col gap-1.5">
            <span className="flex justify-between text-[13px] text-dim">
              {c.label}
              <span className="font-mono text-fg">{Number(c.value.toFixed(2))}</span>
            </span>
            <input
              id={`control-${c.key}`}
              type="range"
              min={c.min}
              max={c.max}
              step={c.step}
              value={c.value}
              className="h-8 w-full"
              onChange={(e) => {
                const value = Number(e.target.value)
                setRanges((all) => all.map((r) => (r.key === c.key ? { ...r, value } : r)))
                if (track) applyControl(track, c, value).catch(() => undefined)
              }}
            />
            {c.group && track && (
              <button onClick={() => setAuto(track, c.group!).catch(() => undefined)} className="self-start text-[13px] text-lamp">
                自動に戻す
              </button>
            )}
          </label>
        ))}
        {!ranges.length && !torchAvailable && (
          <p className="text-[15px] text-dim">このブラウザはカメラの手動調整を公開していません。</p>
        )}
        <p className="font-mono text-[12px] leading-relaxed break-words text-dim">
          ブラウザが報告した機能: {reported.join(', ') || 'なし'}
        </p>
      </Sheet>

      <Sheet open={sheet === 'bench'} title="性能テスト" onClose={() => !benchRunning && setSheet('none')}>
        <Benchmark running={benchRunning} progress={benchProgress} report={benchReport} onRun={(m) => void runBench(m)} onMessage={say} />
      </Sheet>

      <Sheet open={sheet === 'settings'} title="設定" onClose={() => setSheet('none')}>
        <Toggle
          label="プロ表示"
          hint="ヒストグラム、音声メーター、フォルスカラー、ゼブラ、ピーキング、LUT"
          checked={saved.pro}
          onChange={(pro) => update({ pro })}
        />
        <Segmented id="res" label="解像度" value={saved.resolution} disabled={recording}
          options={[{ value: '4K', label: '4K' }, { value: '1080p', label: '1080p' }, { value: '720p', label: '720p' }]}
          onChange={(resolution) => restart({ resolution })} />
        <Segmented id="fps" label="フレームレート" value={saved.fps} disabled={recording}
          options={[24, 25, 30, 60].map((v) => ({ value: v as Saved['fps'], label: String(v) }))}
          onChange={(fps) => restart({ fps })} />
        <Segmented id="codec" label="コーデック" value={saved.codec} disabled={recording}
          options={[{ value: 'hevc', label: 'HEVC' }, { value: 'h264', label: 'H.264' }]}
          onChange={(codec) => update({ codec })} />
        <Segmented id="quality" label="画質" value={saved.quality} disabled={recording}
          options={[{ value: 'low', label: '低' }, { value: 'medium', label: '中' }, { value: 'high', label: '高' }, { value: 'max', label: '最高' }]}
          onChange={(quality) => update({ quality })} />
        <Toggle label="三分割グリッド" checked={saved.thirds} onChange={(thirds) => update({ thirds })} />
        <Segmented id="aspect" label="フレームガイド" value={saved.aspect}
          options={(['off', '2.39', '1.85', '1:1', '4:5', '9:16'] as const).map((v) => ({ value: v, label: v === 'off' ? 'なし' : v }))}
          onChange={(aspect) => update({ aspect })} />
        {saved.pro && (
          <>
            <Segmented id="zebra" label="ゼブラの基準" value={saved.zebraLevel}
              options={[75, 85, 95, 100].map((v) => ({ value: v, label: `${v}%` }))}
              onChange={(zebraLevel) => update({ zebraLevel })} />
            <div className="flex flex-col gap-2">
              <span className="text-[13px] text-dim">LUT(プレビューのみ。録画には焼き込みません)</span>
              <div className="flex flex-wrap gap-1.5">
                {[...BUILTIN_LUTS, ...customLuts].map((l) => (
                  <button
                    key={l.name}
                    aria-pressed={lut?.name === l.name}
                    onClick={() => setLut(lut?.name === l.name ? null : l)}
                    className={`h-10 rounded-lg px-3 font-mono text-[13px] ${lut?.name === l.name ? 'bg-lamp text-ink' : 'bg-raised text-fg'}`}
                  >
                    {l.name}
                  </button>
                ))}
                <label className="flex h-10 items-center gap-1.5 rounded-lg bg-raised px-3 text-[13px]">
                  <Upload size={16} />
                  .cube を読み込む
                  <input
                    id="lut-file"
                    type="file"
                    className="sr-only"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) void importLut(file)
                      e.target.value = ''
                    }}
                  />
                </label>
              </div>
            </div>
          </>
        )}
        <div className="flex flex-col gap-2">
          <span className="flex items-center gap-1.5 text-[13px] text-dim"><Grid3x3 size={14} />スレート(次のクリップ: <span className="font-mono text-fg">{clipName}</span>)</span>
          <div className="grid grid-cols-3 gap-2">
            {([['reel', 'リール'], ['scene', 'シーン'], ['take', 'テイク']] as const).map(([key, label]) => (
              <label key={key} className="flex min-w-0 flex-col gap-1 text-[13px] text-dim">
                {label}
                <input
                  id={`slate-${key}`}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={saved[key]}
                  onChange={(e) => update({ [key]: Math.max(1, Number(e.target.value) || 1) })}
                  className="h-11 w-full min-w-0 rounded-lg bg-black px-2 font-mono text-[16px] text-fg select-text"
                />
              </label>
            ))}
          </div>
        </div>
        <button disabled={recording} onClick={() => setSheet('bench')} className="h-12 rounded-lg bg-raised text-[15px] disabled:opacity-40">
          この iPhone の性能をテスト
        </button>
      </Sheet>
    </main>
  )
}
