import { useState } from 'react'
import { Share, Copy } from 'lucide-react'
import { summarize, type BenchMode, type BenchReport } from '../lib/benchmark'

export function Benchmark({ running, progress, report, onRun, onMessage }: {
  running: boolean
  progress: string
  report: BenchReport | null
  onRun: (mode: BenchMode) => void
  onMessage: (m: string) => void
}) {
  const [showRaw, setShowRaw] = useState(false)
  const text = report ? JSON.stringify(report) : ''

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      onMessage('結果をコピーしました')
    } catch {
      setShowRaw(true)
      onMessage('コピーできませんでした。下の文字を長押しで選択してください')
    }
  }

  const share = async () => {
    try {
      await navigator.share({ text })
    } catch (e) {
      if ((e as Error).name !== 'AbortError') void copy()
    }
  }

  return (
    <>
      <p className="text-[14px] leading-relaxed text-dim">
        テスト中はカメラが切り替わります。画面を閉じずに、iPhone を動かさず待ってください。テストの録画は自動で消えます。
      </p>
      <div className="grid grid-cols-2 gap-2">
        <button disabled={running} onClick={() => onRun('standard')} className="min-h-14 rounded-lg bg-fg px-2 text-[15px] font-semibold text-ink disabled:opacity-40">
          標準テスト
          <span className="block text-[12px] font-normal">約1分</span>
        </button>
        <button disabled={running} onClick={() => onRun('long')} className="min-h-14 rounded-lg bg-raised px-2 text-[15px] font-semibold text-fg disabled:opacity-40">
          長時間テスト
          <span className="block text-[12px] font-normal text-dim">4K 約3分</span>
        </button>
      </div>
      {running && <p role="status" className="font-mono text-[14px] text-lamp">{progress}</p>}
      {report && !running && (
        <>
          <ul className="flex flex-col gap-3">
            {report.results.map((r) => (
              <li key={r.label} className="flex flex-col gap-1">
                <span className="font-mono text-[14px]">{r.label}</span>
                <span className="text-[13px] leading-relaxed text-dim">{summarize(r)}</span>
              </li>
            ))}
          </ul>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => void copy()} className="flex h-12 items-center justify-center gap-2 rounded-lg bg-lamp text-[15px] font-semibold text-ink">
              <Copy size={18} />結果をコピー
            </button>
            <button onClick={() => void share()} className="flex h-12 items-center justify-center gap-2 rounded-lg bg-raised text-[15px]">
              <Share size={18} />共有
            </button>
          </div>
          {showRaw && <p className="font-mono text-[11px] break-all text-dim select-text" style={{ WebkitUserSelect: 'text' }}>{text}</p>}
        </>
      )}
    </>
  )
}
