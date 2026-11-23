// 화면 연결: 사진 넣기 → 외곽선 따기 → 편집기·3D → 겉면·조명 → PNG 저장
import { analyze, analysisSize, DEFAULT_TOL } from './outline.js';
import { Editor } from './editor.js';
import { Viewer } from './viewer.js';

const $ = (s) => document.querySelector(s);
const state = { image: null, aspect: 1, profile: null, tol: DEFAULT_TOL, name: '' };

const viewer = new Viewer($('#view'), { onLost: () => say('3D 화면이 멈췄어요. 새로고침해 주세요.', true) });
const editor = new Editor($('#edit'), (profile) => {
  state.profile = profile;
  viewer.setShape(profile, state.image, state.aspect);
  $('#count').textContent = `점 ${profile.points.length}개`;
});

function say(msg, bad = false) {
  const el = $('#status');
  el.textContent = msg;
  el.classList.toggle('bad', bad);
}

async function loadFile(file) {
  if (!file) return;
  const url = URL.createObjectURL(file);
  try { await loadImage(url, file.name); } finally { URL.revokeObjectURL(url); }
}

async function loadImage(src, name) {
  const img = new Image();
  img.src = src;
  try { await img.decode(); } catch { say('이미지를 열 수 없어요. PNG·JPG 사진을 넣어 주세요.', true); return; }
  // 3D 겉면용 사본(너무 크면 2048px 로 줄인다)
  const k = Math.min(1, 2048 / Math.max(img.naturalWidth, img.naturalHeight));
  const tex = document.createElement('canvas');
  tex.width = Math.round(img.naturalWidth * k); tex.height = Math.round(img.naturalHeight * k);
  tex.getContext('2d').drawImage(img, 0, 0, tex.width, tex.height);
  state.image = tex;
  state.source = img;
  state.aspect = img.naturalWidth / img.naturalHeight;
  state.name = name;
  document.body.classList.add('loaded');
  extract();
}

const REASONS = {
  small: '제품을 찾지 못했어요. 배경과 색이 확실히 다른 사진이거나, 배경 허용치를 낮춰 보세요.',
  large: '사진 거의 전체가 제품으로 잡혔어요. 배경이 단색인 사진을 넣거나 허용치를 올려 보세요.',
  edge: '제품 가장자리를 찾지 못했어요. 배경 허용치를 바꿔 보세요.',
};

function extract() {
  if (!state.source) return;
  const t0 = performance.now();
  const [w, h] = analysisSize(state.source.naturalWidth, state.source.naturalHeight);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(state.source, 0, 0, w, h);
  const res = analyze(g.getImageData(0, 0, w, h).data, w, h, { tol: state.tol });
  const ms = Math.round(performance.now() - t0);
  if (!res.profile) {
    editor.set(state.source, null);
    say(REASONS[res.reason] || REASONS.edge, true);
    $('#count').textContent = '';
    return;
  }
  state.profile = res.profile;
  editor.set(state.source, res.profile);
  viewer.setShape(res.profile, state.image, state.aspect);
  $('#count').textContent = `점 ${res.profile.points.length}개`;
  say(`${state.name} — 외곽선을 땄어요(${ms}ms). 어긋난 곳은 점을 끌어서 고치세요.`);
}

// 사진 넣기: 파일 고르기·끌어다 놓기·예시
$('#file').addEventListener('change', (e) => loadFile(e.target.files[0]));
for (const ev of ['dragover', 'drop']) {
  document.addEventListener(ev, (e) => {
    e.preventDefault();
    if (ev === 'drop') loadFile(e.dataTransfer.files[0]);
  });
}
document.querySelectorAll('[data-sample]').forEach((b) => b.addEventListener('click', () => loadImage(b.dataset.sample, b.dataset.sample.split('/').pop())));

// 외곽선 다시 따기
$('#tol').addEventListener('input', (e) => { state.tol = +e.target.value; $('#tolv').textContent = state.tol; });
$('#tol').addEventListener('change', extract);
$('#redo').addEventListener('click', extract);

// 겉면
document.querySelectorAll('input[name=surface]').forEach((r) => r.addEventListener('change', () => {
  viewer.setSurface(r.value, $('#color').value);
  $('#color').disabled = r.value !== 'solid';
}));
$('#color').addEventListener('input', (e) => viewer.setSurface('solid', e.target.value));

// 조명 패드: 위에서 내려다본 바닥. 아래쪽이 정면, 가운데일수록 머리 위.
const pad = $('#pad'), dot = $('#dot');
function placeDot() {
  const { azimuth, elevation } = viewer.light;
  const a = (azimuth * Math.PI) / 180, d = 1 - elevation / 90;
  dot.style.left = `${50 + 46 * d * Math.sin(a)}%`;
  dot.style.top = `${50 + 46 * d * Math.cos(a)}%`;
  $('#lightv').textContent = `방향 ${Math.round(azimuth)}° · 높이 ${Math.round(elevation)}°`;
}
function padMove(e) {
  const r = pad.getBoundingClientRect();
  let x = (e.clientX - r.left) / r.width * 2 - 1, y = (e.clientY - r.top) / r.height * 2 - 1;
  const d = Math.min(1, Math.hypot(x, y) / 0.92);
  const azimuth = (Math.atan2(x, y) * 180) / Math.PI;
  const elevation = Math.max(8, 90 * (1 - d));
  viewer.setLight({ azimuth, elevation });
  placeDot();
}
pad.addEventListener('pointerdown', (e) => { pad.setPointerCapture(e.pointerId); padMove(e); });
pad.addEventListener('pointermove', (e) => { if (pad.hasPointerCapture(e.pointerId)) padMove(e); });
$('#power').addEventListener('input', (e) => viewer.setLight({ intensity: +e.target.value }));
placeDot();

// PNG 저장
$('#save').addEventListener('click', () => {
  if (!state.profile) { say('먼저 사진을 넣어 주세요.', true); return; }
  const [w, h] = $('#size').value.split('x').map(Number);
  const url = viewer.capture(w, h);
  const a = document.createElement('a');
  const t = new Date(), p = (n) => String(n).padStart(2, '0');
  a.download = `studio_${t.getFullYear()}${p(t.getMonth() + 1)}${p(t.getDate())}_${p(t.getHours())}${p(t.getMinutes())}${p(t.getSeconds())}.png`;
  a.href = url;
  document.body.appendChild(a); a.click(); a.remove();
  say(`${w}×${h} PNG 로 저장했어요.`);
});

// 시험용 손잡이(e2e 가 상태를 읽는다)
window.studio = { state, viewer, editor };
