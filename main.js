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
uniform vec2 uCenter;
uniform float uScale;
uniform float uHue;
uniform float uSat;
uniform float uVal;
uniform int uScheme;

#define MAX_ITER ${maxIter}

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
  vec2 c = uCenter + vec2(uv.x * uScale * aspect, uv.y * uScale);

  float x = 0.0, y = 0.0;
  float x2 = 0.0, y2 = 0.0;
  int iter = MAX_ITER;

  for (int i = 0; i < MAX_ITER; i++) {
    if (x2 + y2 > 4.0) {
      iter = i;
      break;
    }
    y = 2.0 * x * y + c.y;
    x = x2 - y2 + c.x;
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
let maxIter = 300;
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

// Buffer once
const buf = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, buf);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);

rebuildProgram();

let center = [-0.75, 0.0];
let scale = 2.5;
let hue = 0;
let sat = 0.8;
let val = 1.0;
let scheme = 0;

function render() {
  gl.useProgram(program);
  gl.uniform2f(gl.getUniformLocation(program, 'uResolution'), canvas.width, canvas.height);
  gl.uniform2f(gl.getUniformLocation(program, 'uCenter'), center[0], center[1]);
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
  center = [-0.75, 0.0];
  scale = 2.5;
  maxIter = 300;
  document.getElementById('iters').value = 300;
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
  center[0] -= dx * scale * aspect;
  center[1] += dy * scale;
  lastX = e.clientX;
  lastY = e.clientY;
});

canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const factor = e.deltaY > 0 ? 1.1 : 0.9;
  const mx = (e.clientX / canvas.width - 0.5) * scale * (canvas.width / canvas.height);
  const my = (0.5 - e.clientY / canvas.height) * scale;
  center[0] += mx * (1 - factor);
  center[1] += my * (1 - factor);
  scale *= factor;

  // Auto-increase quality a bit when zooming deep (helps "sharpen")
  const suggested = Math.min(1000, Math.max(150, Math.round(200 + Math.log2(2.5 / scale) * 40)));
  if (Math.abs(suggested - maxIter) > 30) {
    maxIter = suggested;
    document.getElementById('iters').value = maxIter;
    rebuildProgram();
  }
}, { passive: false });

// Touch support
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
    center[0] -= dx * scale * aspect;
    center[1] += dy * scale;
  } else if (e.touches.length === 2 && touches.length === 2) {
    const d1 = Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
    const d2 = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    const factor = d1 / d2;
    scale *= factor;
  }
  touches = [...e.touches];
}, { passive: false });
