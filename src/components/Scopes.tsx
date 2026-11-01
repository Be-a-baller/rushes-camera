import { useEffect, useRef } from 'react'

// 映像を縮小して読み取るだけなので、4K でも処理は軽い。
export function Histogram({ video }: { video: HTMLVideoElement | null }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas || !video) return
    const source = document.createElement('canvas')
    source.width = 96
    source.height = 54
    const read = source.getContext('2d', { willReadFrequently: true })!
    const draw = canvas.getContext('2d')!
    const BINS = 64
    const id = setInterval(() => {
      if (video.readyState < 2) return
      read.drawImage(video, 0, 0, 96, 54)
      const px = read.getImageData(0, 0, 96, 54).data
      const bins = [new Uint32Array(BINS), new Uint32Array(BINS), new Uint32Array(BINS)]
      let clipped = 0
      for (let i = 0; i < px.length; i += 4) {
        for (let c = 0; c < 3; c++) bins[c][(px[i + c] * BINS) >> 8]++
        if (px[i] > 250 || px[i + 1] > 250 || px[i + 2] > 250) clipped++
      }
      const { width: w, height: h } = canvas
      draw.clearRect(0, 0, w, h)
      draw.globalCompositeOperation = 'lighter'
      const peak = Math.max(1, ...bins.flatMap((b) => Array.from(b.subarray(1, BINS - 1))))
      ;['#e0403a', '#3fc463', '#4a7dff'].forEach((color, c) => {
        draw.fillStyle = color
        draw.beginPath()
        draw.moveTo(0, h)
        bins[c].forEach((v, x) => draw.lineTo((x / (BINS - 1)) * w, h - Math.min(1, v / peak) * h))
        draw.lineTo(w, h)
        draw.fill()
      })
      draw.globalCompositeOperation = 'source-over'
      if (clipped / (px.length / 4) > 0.01) {
        draw.fillStyle = '#ff3b30'
        draw.fillRect(w - 6, 0, 6, h)
      }
    }, 200)
    return () => clearInterval(id)
  }, [video])
  return <canvas ref={ref} width={192} height={64} aria-label="ヒストグラム" className="h-11 w-full min-w-0 rounded bg-white/5" />
}

export function AudioMeter({ stream }: { stream: MediaStream | null }) {
  const bar = useRef<HTMLDivElement>(null)
  const text = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!stream || !stream.getAudioTracks().length) return
    const Ctx = window.AudioContext
    const ctx = new Ctx()
    void ctx.resume()
    const node = ctx.createMediaStreamSource(stream)
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 1024
    node.connect(analyser)
    const buf = new Float32Array(analyser.fftSize)
    let raf = 0
    let held = 0
    const loop = () => {
      analyser.getFloatTimeDomainData(buf)
      let p = 0
      for (const v of buf) p = Math.max(p, Math.abs(v))
      held = Math.max(p, held * 0.92)
      const db = 20 * Math.log10(Math.max(held, 1e-4))
      if (bar.current) {
        bar.current.style.transform = `scaleX(${Math.max(0, (db + 60) / 60)})`
        bar.current.style.backgroundColor = db > -6 ? '#ff3b30' : db > -12 ? '#ffb454' : '#3fc463'
      }
      if (text.current) text.current.textContent = db <= -60 ? '-∞' : db.toFixed(0)
      raf = requestAnimationFrame(loop)
    }
    loop()
    return () => {
      cancelAnimationFrame(raf)
      void ctx.close()
    }
  }, [stream])
  return (
    <div className="flex min-w-0 items-center gap-2" aria-label="音声レベル">
      <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-sm bg-white/10">
        <div ref={bar} className="h-full origin-left" style={{ transform: 'scaleX(0)' }} />
      </div>
      <span ref={text} className="w-7 text-right font-mono text-[11px] text-dim tabular-nums">-∞</span>
    </div>
  )
}
