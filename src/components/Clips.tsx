import { useEffect, useState } from 'react'
import { Share, Star, Trash2 } from 'lucide-react'
import { clipBlob, deleteClip, putClip, type Clip } from '../lib/store'

const duration = (ms: number) => {
  const s = Math.round(ms / 1000)
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}
const size = (b: number) => (b > 1e9 ? `${(b / 1e9).toFixed(2)} GB` : `${(b / 1e6).toFixed(1)} MB`)

// iPhone では共有シートの「ビデオを保存」で写真アプリへ入れられる。
async function saveClip(clip: Clip): Promise<string | null> {
  const blob = await clipBlob(clip)
  const ext = blob.type.includes('webm') ? 'webm' : 'mp4'
  const file = new File([blob], `${clip.name}.${ext}`, { type: blob.type })
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] })
    } catch (e) {
      if ((e as Error).name !== 'AbortError') throw e
    }
    return null
  }
  const url = URL.createObjectURL(file)
  const a = document.createElement('a')
  a.href = url
  a.download = file.name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
  return 'ダウンロードを開始しました'
}

export function ClipList({ clips, onChange, onMessage }: { clips: Clip[]; onChange: () => void; onMessage: (m: string) => void }) {
  const [playing, setPlaying] = useState<{ id: string; url: string } | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)

  useEffect(() => () => {
    if (playing) URL.revokeObjectURL(playing.url)
  }, [playing])

  if (!clips.length) {
    return <p className="py-6 text-center text-[15px] text-dim">まだクリップはありません。記録ボタンで撮影を始めると、ここに並びます。</p>
  }

  const play = async (clip: Clip) => {
    if (playing?.id === clip.id) return setPlaying(null)
    setPlaying({ id: clip.id, url: URL.createObjectURL(await clipBlob(clip)) })
  }

  return (
    <ul className="flex flex-col divide-y divide-line">
      {clips.map((clip) => (
        <li key={clip.id} className="flex flex-col gap-2 py-3">
          <div className="flex items-center gap-1">
            <button onClick={() => void play(clip)} className="min-h-11 min-w-0 flex-1 text-left">
              <span className="block truncate font-mono text-[13px]">{clip.name}</span>
              <span className="block font-mono text-[12px] text-dim">
                {duration(clip.durationMs)} · {size(clip.bytes)} · {clip.width}×{clip.height}
                {clip.status === 'recovered' && <span className="text-lamp"> · 中断から復元</span>}
              </span>
            </button>
            <button
              aria-label={clip.good ? 'グッドテイクを解除' : 'グッドテイクにする'}
              aria-pressed={clip.good}
              className={`grid size-11 place-items-center ${clip.good ? 'text-lamp' : 'text-dim'}`}
              onClick={() => void putClip({ ...clip, good: !clip.good }).then(onChange)}
            >
              <Star size={20} fill={clip.good ? 'currentColor' : 'none'} />
            </button>
            <button
              aria-label="写真に保存または共有"
              className="grid size-11 place-items-center text-fg"
              onClick={() => saveClip(clip).then((m) => m && onMessage(m)).catch(() => onMessage('保存できませんでした。もう一度試してください。'))}
            >
              <Share size={20} />
            </button>
            <button
              aria-label={confirming === clip.id ? '削除を確定' : '削除'}
              className={`grid size-11 place-items-center ${confirming === clip.id ? 'rounded-lg bg-tally text-white' : 'text-dim'}`}
              onClick={() => {
                if (confirming !== clip.id) return setConfirming(clip.id)
                setConfirming(null)
                void deleteClip(clip.id).then(onChange)
              }}
            >
              <Trash2 size={20} />
            </button>
          </div>
          {confirming === clip.id && <p className="text-[13px] text-tally">もう一度押すと完全に削除します。</p>}
          {playing?.id === clip.id && <video src={playing.url} controls playsInline className="w-full rounded-lg bg-black" />}
        </li>
      ))}
    </ul>
  )
}
