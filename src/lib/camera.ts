export type Resolution = '4K' | '1080p' | '720p'
export type Codec = 'hevc' | 'h264'
export type Quality = 'low' | 'medium' | 'high' | 'max'

export type CameraSettings = {
  deviceId: string | null
  resolution: Resolution
  fps: 24 | 25 | 30 | 60
  codec: Codec
  quality: Quality
}

const SIZE: Record<Resolution, [number, number]> = {
  '4K': [3840, 2160],
  '1080p': [1920, 1080],
  '720p': [1280, 720],
}

const MBPS: Record<Resolution, Record<Quality, number>> = {
  '4K': { low: 20, medium: 35, high: 50, max: 80 },
  '1080p': { low: 8, medium: 14, high: 20, max: 30 },
  '720p': { low: 4, medium: 7, high: 10, max: 15 },
}

export function bitrate(s: Pick<CameraSettings, 'resolution' | 'quality' | 'fps'>): number {
  return MBPS[s.resolution][s.quality] * (s.fps > 30 ? 1.5 : 1) * 1_000_000
}

export async function openStream(s: CameraSettings): Promise<MediaStream> {
  const [width, height] = SIZE[s.resolution]
  return navigator.mediaDevices.getUserMedia({
    video: {
      ...(s.deviceId ? { deviceId: { exact: s.deviceId } } : { facingMode: { ideal: 'environment' } }),
      width: { ideal: width },
      height: { ideal: height },
      frameRate: { ideal: s.fps },
    },
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  })
}

export type Lens = { id: string; label: string; order: number }

// iPhone は端末言語のカメラ名を返すので日本語と英語の両方を判定する。
// 複合カメラは単体レンズの切り替えと重複するので除外する。
export async function listLenses(): Promise<Lens[]> {
  const devices = await navigator.mediaDevices.enumerateDevices()
  const lenses: Lens[] = []
  for (const d of devices) {
    if (d.kind !== 'videoinput') continue
    const name = d.label.toLowerCase()
    if (/dual|triple|デュアル|トリプル/.test(name)) continue
    if (/ultra|超広角/.test(name)) lenses.push({ id: d.deviceId, label: '.5', order: 0 })
    else if (/tele|望遠/.test(name)) lenses.push({ id: d.deviceId, label: 'TELE', order: 2 })
    else if (/front|前面/.test(name)) lenses.push({ id: d.deviceId, label: 'FRONT', order: 3 })
    else lenses.push({ id: d.deviceId, label: '1×', order: 1 })
  }
  return lenses.sort((a, b) => a.order - b.order)
}

export function pickMime(codec: Codec): string {
  if (typeof MediaRecorder === 'undefined') throw new Error('このブラウザは録画に対応していません')
  const hevc = ['video/mp4;codecs="hvc1.1.6.L153.B0,mp4a.40.2"', 'video/mp4;codecs=hvc1', 'video/mp4;codecs=hevc']
  const h264 = ['video/mp4;codecs="avc1.640033,mp4a.40.2"', 'video/mp4;codecs=avc1', 'video/mp4']
  const list = [...(codec === 'hevc' ? [...hevc, ...h264] : [...h264, ...hevc]), 'video/webm;codecs=vp9,opus', 'video/webm']
  const mime = list.find((m) => MediaRecorder.isTypeSupported(m))
  if (!mime) throw new Error('録画できる形式が見つかりませんでした')
  return mime
}

export const codecName = (mime: string) =>
  /hvc1|hevc/.test(mime) ? 'HEVC' : /avc1/.test(mime) || mime === 'video/mp4' ? 'H.264' : 'WebM'

// ブラウザが公開しているカメラ操作。端末とOSで変わるので、実際に報告された分だけUIに出す。
export type RangeControl = {
  key: string
  label: string
  min: number
  max: number
  step: number
  value: number
  group?: 'exposureMode' | 'focusMode' | 'whiteBalanceMode'
}

const RANGE_DEFS: Omit<RangeControl, 'min' | 'max' | 'step' | 'value'>[] = [
  { key: 'zoom', label: 'ズーム' },
  { key: 'exposureCompensation', label: '露出補正' },
  { key: 'iso', label: 'ISO', group: 'exposureMode' },
  { key: 'exposureTime', label: 'シャッター', group: 'exposureMode' },
  { key: 'focusDistance', label: 'フォーカス', group: 'focusMode' },
  { key: 'colorTemperature', label: '色温度', group: 'whiteBalanceMode' },
]

export function readControls(track: MediaStreamTrack): { ranges: RangeControl[]; torch: boolean; reported: string[] } {
  const caps = (track.getCapabilities?.() ?? {}) as Record<string, unknown>
  const settings = track.getSettings() as Record<string, unknown>
  const ranges: RangeControl[] = []
  for (const def of RANGE_DEFS) {
    const cap = caps[def.key] as { min?: number; max?: number; step?: number } | undefined
    if (!cap || cap.min == null || cap.max == null || cap.min === cap.max) continue
    ranges.push({
      ...def,
      min: cap.min,
      max: cap.max,
      step: cap.step || (cap.max - cap.min) / 100,
      value: typeof settings[def.key] === 'number' ? (settings[def.key] as number) : cap.min,
    })
  }
  return { ranges, torch: Boolean(caps.torch), reported: Object.keys(caps) }
}

export async function applyControl(track: MediaStreamTrack, c: RangeControl, value: number) {
  const constraint: Record<string, unknown> = { [c.key]: value }
  if (c.group) constraint[c.group] = 'manual'
  await track.applyConstraints({ advanced: [constraint] } as MediaTrackConstraints)
}

export async function setAuto(track: MediaStreamTrack, group: NonNullable<RangeControl['group']>) {
  await track.applyConstraints({ advanced: [{ [group]: 'continuous' }] } as MediaTrackConstraints)
}

export async function setTorch(track: MediaStreamTrack, on: boolean) {
  await track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] })
}
