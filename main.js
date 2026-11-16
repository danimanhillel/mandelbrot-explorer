const canvas = document.getElementById('canvas');
const gl = canvas.getContext('webgl', { antialias: false, preserveDrawingBuffer: true });

if (!gl) {
  alert('WebGL not supported');
  throw new Error('WebGL unavailable');
}

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  gl.viewport(0, 0, canvas.width, canvas.height);
}
window.addEventListener('resize', resize);
resize();

const VERT = `
attribute vec2 aPos;
void main() {
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

function makeFrag(maxIter) {
  return `
precision highp float;
uniform vec2 uResolution;
uniform vec2 uCenterHi;
uniform vec2 uCenterLo;
uniform float uScale;
uniform float uHue;
uniform float uSat;
uniform float uVal;
uniform int uScheme;

#define MAX_ITER ${maxIter}

// Simple double-float helpers (enough for much deeper zoom)
vec2 dfAdd(vec2 a, float b) {
  float hi = a.x + b;
  float lo = b - (hi - a.x) + a.y;
  return vec2(hi, lo);
}

vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

vec3 cosinePalette(float t) {
  return 0.5 + 0.5 * cos(6.28318 * (t + vec3(0.0, 0.33, 0.67) + uHue/360.0));
}

void main() {
  float aspect = uResolution.x / uResolution.y;
  vec2 uv = (gl_FragCoord.xy / uResolution) - 0.5;

  // Offset with higher precision
  vec2 cHi = uCenterHi;
  vec2 cLo = uCenterLo;
  cHi = dfAdd(cHi, uv.x * uScale * aspect);
  cLo = dfAdd(cLo, uv.y * uScale);

  float cx = cHi.x + cLo.x;
  float cy = cHi.y + cLo.y;

  float x = 0.0, y = 0.0;
  float x2 = 0.0, y2 = 0.0;
  int iter = MAX_ITER;

  for (int i = 0; i < MAX_ITER; i++) {
    if (x2 + y2 > 4.0) {
      iter = i;
      break;
    }
    y = 2.0 * x * y + cy;
    x = x2 - y2 + cx;
    x2 = x * x;
    y2 = y * y;
  }

  if (iter >= MAX_ITER) {
    gl_FragColor = vec4(0.0);
    return;
  }

  float smoothIter = float(iter) + 1.0 - log(log(sqrt(x2 + y2))) / log(2.0);
  float t = smoothIter / float(MAX_ITER);

  vec3 color;
  if (uScheme == 0) {
    color = hsv2rgb(vec3(fract(t * 5.0 + uHue/360.0), uSat, uVal));
  } else if (uScheme == 1) {
    color = cosinePalette(t * 3.0) * uVal;
    color = mix(vec3(0.0), color, uSat);
  } else {
    color = mix(vec3(0.0, 0.0, 0.1), vec3(1.0, 0.5, 0.0), pow(t, 0.5));
    color = mix(color, vec3(1.0, 1.0, 0.5), pow(t, 2.0));
    color = hsv2rgb(vec3(fract(t + uHue/360.0), uSat, uVal * length(color)));
  }

  gl_FragColor = vec4(color, 1.0);
}`;
}

function compileShader(src, type) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    console.error(gl.getShaderInfoLog(s));
    throw new Error('Shader compile failed');
  }
  return s;
}

let program;
let maxIter = 400;
let aPosLoc = -1;

function setupAttributes() {
  if (aPosLoc >= 0) gl.disableVertexAttribArray(aPosLoc);
  aPosLoc = gl.getAttribLocation(program, 'aPos');
  gl.enableVertexAttribArray(aPosLoc);
  gl.vertexAttribPointer(aPosLoc, 2, gl.FLOAT, false, 0, 0);
}

function rebuildProgram() {
  if (program) gl.deleteProgram(program);
  const vs = compileShader(VERT, gl.VERTEX_SHADER);
  const fs = compileShader(makeFrag(maxIter), gl.FRAGMENT_SHADER);
  program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error(gl.getProgramInfoLog(program));
    throw new Error('Program link failed');
  }
  gl.useProgram(program);
  setupAttributes();
}

const buf = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, buf);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);

rebuildProgram();

// Center stored as number (JS double) then split for GPU
let centerX = -0.75;
let centerY = 0.0;
let scale = 2.5;
let hue = 0;
let sat = 0.8;
let val = 1.0;
let scheme = 0;

function splitDouble(v) {
  const hi = Math.fround(v);          // force to float32 range roughly
  const lo = v - hi;
  return [hi, lo];
}

function render() {
  gl.useProgram(program);

  const [cxHi, cxLo] = splitDouble(centerX);
  const [cyHi, cyLo] = splitDouble(centerY);

  gl.uniform2f(gl.getUniformLocation(program, 'uResolution'), canvas.width, canvas.height);
  gl.uniform2f(gl.getUniformLocation(program, 'uCenterHi'), cxHi, cyHi);
  gl.uniform2f(gl.getUniformLocation(program, 'uCenterLo'), cxLo, cyLo);
  gl.uniform1f(gl.getUniformLocation(program, 'uScale'), scale);
  gl.uniform1f(gl.getUniformLocation(program, 'uHue'), hue);
  gl.uniform1f(gl.getUniformLocation(program, 'uSat'), sat);
  gl.uniform1f(gl.getUniformLocation(program, 'uVal'), val);
  gl.uniform1i(gl.getUniformLocation(program, 'uScheme'), scheme);

  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  requestAnimationFrame(render);
}
render();

// Controls
document.getElementById('hue').addEventListener('input', e => hue = +e.target.value);
document.getElementById('sat').addEventListener('input', e => sat = +e.target.value);
document.getElementById('val').addEventListener('input', e => val = +e.target.value);
document.getElementById('iters').addEventListener('input', e => {
  maxIter = +e.target.value;
  rebuildProgram();
});
document.getElementById('scheme').addEventListener('change', e => {
  scheme = e.target.selectedIndex;
});
document.getElementById('reset').addEventListener('click', () => {
  centerX = -0.75;
  centerY = 0.0;
  scale = 2.5;
  maxIter = 400;
  document.getElementById('iters').value = 400;
  rebuildProgram();
});

// Interaction
let dragging = false;
let lastX, lastY;

canvas.addEventListener('mousedown', e => {
  dragging = true;
  lastX = e.clientX;
  lastY = e.clientY;
});
window.addEventListener('mouseup', () => dragging = false);
window.addEventListener('mousemove', e => {
  if (!dragging) return;
  const dx = (e.clientX - lastX) / canvas.width;
  const dy = (e.clientY - lastY) / canvas.height;
  const aspect = canvas.width / canvas.height;
  centerX -= dx * scale * aspect;
  centerY += dy * scale;
  lastX = e.clientX;
  lastY = e.clientY;
});

canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const factor = e.deltaY > 0 ? 1.12 : 0.89;
  const mx = (e.clientX / canvas.width - 0.5) * scale * (canvas.width / canvas.height);
  const my = (0.5 - e.clientY / canvas.height) * scale;
  centerX += mx * (1 - factor);
  centerY += my * (1 - factor);
  scale *= factor;

  // Auto quality
  const suggested = Math.min(1200, Math.max(200, Math.round(250 + Math.log2(2.5 / Math.max(scale, 1e-12)) * 50)));
  if (Math.abs(suggested - maxIter) > 40) {
    maxIter = suggested;
    document.getElementById('iters').value = maxIter;
    rebuildProgram();
  }
}, { passive: false });

// Touch
let touches = [];
canvas.addEventListener('touchstart', e => {
  touches = [...e.touches];
});
canvas.addEventListener('touchmove', e => {
  e.preventDefault();
  if (e.touches.length === 1 && touches.length === 1) {
    const dx = (e.touches[0].clientX - touches[0].clientX) / canvas.width;
    const dy = (e.touches[0].clientY - touches[0].clientY) / canvas.height;
    const aspect = canvas.width / canvas.height;
    centerX -= dx * scale * aspect;
    centerY += dy * scale;
  } else if (e.touches.length === 2 && touches.length === 2) {
    const d1 = Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
    const d2 = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    scale *= d1 / d2;
  }
  touches = [...e.touches];
}, { passive: false });
