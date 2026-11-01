import type { Lut } from './lut'

// プレビュー専用の WebGL2 処理。録画データは加工しない。
export type MonitorOptions = {
  lut: boolean
  falseColor: boolean
  zebra: boolean
  zebraLevel: number
  peaking: boolean
}

const VERT = `#version 300 es
in vec2 p; out vec2 uv;
void main(){ uv = vec2(p.x*.5+.5, .5-p.y*.5); gl_Position = vec4(p,0.,1.); }`

const FRAG = `#version 300 es
precision highp float;
precision highp sampler3D;
in vec2 uv; out vec4 color;
uniform sampler2D video;
uniform sampler3D lutTex;
uniform float lutSize;
uniform bool useLut, useFalse, useZebra, usePeak;
uniform float zebraLevel, time;
uniform vec2 texel;

float luma(vec3 c){ return dot(c, vec3(.2126,.7152,.0722)); }

vec3 falseColor(float y){
  if(y < .025) return vec3(.45,.1,.6);
  if(y < .10)  return vec3(.1,.35,.9);
  if(y >= .38 && y < .44) return vec3(.15,.8,.3);
  if(y >= .52 && y < .58) return vec3(1.,.45,.7);
  if(y >= .93 && y < .98) return vec3(1.,.85,.1);
  if(y >= .98) return vec3(.95,.1,.1);
  return vec3(y*.8);
}

void main(){
  vec3 src = texture(video, uv).rgb;
  float y = luma(src);
  vec3 c = src;
  if(useLut) c = texture(lutTex, (src*(lutSize-1.)+.5)/lutSize).rgb;
  if(useFalse) c = falseColor(y);
  if(usePeak){
    float l = luma(texture(video, uv+vec2(texel.x,0.)).rgb);
    float r = luma(texture(video, uv-vec2(texel.x,0.)).rgb);
    float t = luma(texture(video, uv+vec2(0.,texel.y)).rgb);
    float b = luma(texture(video, uv-vec2(0.,texel.y)).rgb);
    float edge = abs(4.*y-l-r-t-b);
    if(edge > .16) c = vec3(1.,.71,.33);
  }
  if(useZebra && y >= zebraLevel){
    float s = mod(gl_FragCoord.x + gl_FragCoord.y + time*30., 16.);
    if(s < 7.) c = mix(c, vec3(0.), .75);
  }
  color = vec4(c,1.);
}`

export class Monitor {
  private gl: WebGL2RenderingContext
  private uniforms: Record<string, WebGLUniformLocation | null> = {}
  private lutSize = 2
  private canvas: HTMLCanvasElement

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false })
    if (!gl) throw new Error('WebGL2 が使えません')
    this.gl = gl
    const program = gl.createProgram()!
    for (const [type, src] of [[gl.VERTEX_SHADER, VERT], [gl.FRAGMENT_SHADER, FRAG]] as const) {
      const shader = gl.createShader(type)!
      gl.shaderSource(shader, src)
      gl.compileShader(shader)
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'shader')
      gl.attachShader(program, shader)
    }
    gl.linkProgram(program)
    gl.useProgram(program)
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    const loc = gl.getAttribLocation(program, 'p')
    gl.enableVertexAttribArray(loc)
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
    for (const name of ['video', 'lutTex', 'lutSize', 'useLut', 'useFalse', 'useZebra', 'usePeak', 'zebraLevel', 'time', 'texel']) {
      this.uniforms[name] = gl.getUniformLocation(program, name)
    }
    gl.uniform1i(this.uniforms.video, 0)
    gl.uniform1i(this.uniforms.lutTex, 1)

    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture())
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) {
      gl.texParameteri(gl.TEXTURE_2D, k, v)
    }
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_3D, gl.createTexture())
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE]]) {
      gl.texParameteri(gl.TEXTURE_3D, k, v)
    }
    gl.activeTexture(gl.TEXTURE0)
  }

  setLut(lut: Lut) {
    const { gl } = this
    gl.activeTexture(gl.TEXTURE1)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, lut.size, lut.size, lut.size, 0, gl.RGBA, gl.UNSIGNED_BYTE, lut.data)
    gl.activeTexture(gl.TEXTURE0)
    this.lutSize = lut.size
  }

  render(video: HTMLVideoElement, opts: MonitorOptions, time: number) {
    if (video.readyState < 2 || !video.videoWidth) return
    const { gl, canvas, uniforms: u } = this
    const scale = Math.min(1, 1920 / Math.max(video.videoWidth, video.videoHeight))
    const w = Math.round(video.videoWidth * scale)
    const h = Math.round(video.videoHeight * scale)
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
      gl.viewport(0, 0, w, h)
    }
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video)
    gl.uniform1i(u.useLut, Number(opts.lut))
    gl.uniform1i(u.useFalse, Number(opts.falseColor))
    gl.uniform1i(u.useZebra, Number(opts.zebra))
    gl.uniform1i(u.usePeak, Number(opts.peaking))
    gl.uniform1f(u.zebraLevel, opts.zebraLevel)
    gl.uniform1f(u.lutSize, this.lutSize)
    gl.uniform1f(u.time, time)
    gl.uniform2f(u.texel, 1 / video.videoWidth, 1 / video.videoHeight)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }
}
