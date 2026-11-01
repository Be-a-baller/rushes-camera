export type Lut = { name: string; size: number; data: Uint8Array }

// .cube を読み込む。R が最も速く変化する順序で、3Dテクスチャの x/y/z にそのまま対応する。
export function parseCube(text: string, name: string): Lut {
  let size = 0
  let min = [0, 0, 0]
  let max = [1, 1, 1]
  const values: number[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#') || line.startsWith('TITLE')) continue
    const parts = line.split(/\s+/)
    if (parts[0] === 'LUT_3D_SIZE') size = Number(parts[1])
    else if (parts[0] === 'LUT_1D_SIZE') throw new Error('1D LUT には対応していません。3D LUT を選んでください。')
    else if (parts[0] === 'DOMAIN_MIN') min = parts.slice(1).map(Number)
    else if (parts[0] === 'DOMAIN_MAX') max = parts.slice(1).map(Number)
    else if (parts.length === 3 && !Number.isNaN(Number(parts[0]))) values.push(...parts.map(Number))
  }
  if (!size || values.length !== size ** 3 * 3) {
    throw new Error('LUT を読み取れませんでした。.cube 形式の 3D LUT か確認してください。')
  }
  const data = new Uint8Array(size ** 3 * 4)
  for (let i = 0; i < size ** 3; i++) {
    for (let c = 0; c < 3; c++) {
      const v = (values[i * 3 + c] - min[c]) / (max[c] - min[c])
      data[i * 4 + c] = Math.round(Math.min(1, Math.max(0, v)) * 255)
    }
    data[i * 4 + 3] = 255
  }
  return { name, size, data }
}

function build(name: string, fn: (r: number, g: number, b: number) => [number, number, number]): Lut {
  const size = 17
  const data = new Uint8Array(size ** 3 * 4)
  let i = 0
  for (let b = 0; b < size; b++)
    for (let g = 0; g < size; g++)
      for (let r = 0; r < size; r++) {
        const out = fn(r / (size - 1), g / (size - 1), b / (size - 1))
        for (let c = 0; c < 3; c++) data[i++] = Math.round(Math.min(1, Math.max(0, out[c])) * 255)
        data[i++] = 255
      }
  return { name, size, data }
}

const luma = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b
const curve = (v: number) => v * v * (3 - 2 * v)

export const BUILTIN_LUTS: Lut[] = [
  build('Tungsten', (r, g, b) => {
    const l = luma(r, g, b)
    const k = 0.35
    return [curve(r) * k + r * (1 - k) + 0.03, g * 0.98 + 0.01, b * 0.86 + 0.02 * (1 - l)]
  }),
  build('Harbour', (r, g, b) => {
    const l = curve(luma(r, g, b))
    return [r + (l - 0.5) * 0.14, g + (0.5 - l) * 0.03, b + (0.5 - l) * 0.16]
  }),
  build('Silver', (r, g, b) => {
    const l = curve(luma(r, g, b))
    return [l, l, l]
  }),
]
