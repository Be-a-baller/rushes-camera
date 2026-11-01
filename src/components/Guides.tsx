export type GuideAspect = 'off' | '2.39' | '1.85' | '1:1' | '4:5' | '9:16'

const RATIO: Record<Exclude<GuideAspect, 'off'>, number> = { '2.39': 2.39, '1.85': 1.85, '1:1': 1, '4:5': 0.8, '9:16': 9 / 16 }

export function Guides({ thirds, aspect, width, height }: { thirds: boolean; aspect: GuideAspect; width: number; height: number }) {
  const ratio = aspect === 'off' ? 0 : RATIO[aspect]
  const stage = width / Math.max(1, height)
  const w = ratio && ratio < stage ? (ratio / stage) * 100 : 100
  const h = ratio && ratio > stage ? (stage / ratio) * 100 : 100
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden>
      {thirds && (
        <>
          {[33.33, 66.66].map((p) => (
            <span key={`v${p}`} className="absolute inset-y-0 w-px bg-white/40" style={{ left: `${p}%` }} />
          ))}
          {[33.33, 66.66].map((p) => (
            <span key={`h${p}`} className="absolute inset-x-0 h-px bg-white/40" style={{ top: `${p}%` }} />
          ))}
        </>
      )}
      {ratio > 0 && (
        <span
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 border border-lamp shadow-[0_0_0_100vmax_rgba(0,0,0,0.55)]"
          style={{ width: `${w}%`, height: `${h}%` }}
        />
      )}
    </div>
  )
}
