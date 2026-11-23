// 화면 연결: 사진 넣기 → 외곽선 따기 → 편집기·3D → 겉면(부위별 재질·색, 라벨)·세트·조명 → PNG 저장
import { analyze, analysisSize, suggestCapSplit, DEFAULT_TOL } from './outline.js';
import { Editor } from './editor.js';
import { Viewer, FINISHES, BACKDROPS, PEDESTALS, CAMERAS, LIGHTS } from './viewer.js';

const $ = (s) => document.querySelector(s);
const el = (tag, attrs = {}, kids = []) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) k === 'text' ? (n.textContent = v) : n.setAttribute(k, v);
  for (const c of kids) n.append(c);
  return n;
};
const press = (group, btn) => group.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));

const state = { image: null, source: null, aspect: 1, profile: null, capY: null, tol: DEFAULT_TOL, name: '', part: 'body' };
let loadSeq = 0; // 사진을 연달아 넣으면 마지막 것만 쓴다

const viewer = new Viewer($('#view'), {
  onLost: () => say('3D 화면이 멈췄어요. 잠시 뒤 돌아오지 않으면 새로고침해 주세요', true),
  onRestored: () => say('3D 화면이 다시 켜졌어요'),
  onView: (v, l) => readout(v, l),
});
const editor = new Editor($('#edit'), (profile, capY) => {
  state.profile = profile;
  state.capY = capY;
  // 점이 한 높이로 몰리면 모양을 만들 수 없다 → 마지막 모양을 그대로 둔다
  if (!viewer.setShape(profile, state.image, state.aspect, capY)) say('점들이 한 높이에 몰려 있어요. 위아래로 벌려 주세요', true);
  meta();
});

function say(msg, bad = false) {
  const s = $('#status');
  s.textContent = msg;
  s.classList.toggle('bad', bad);
}

function meta(ms) {
  if (!state.profile) { $('#meta').textContent = ''; return; }
  const p = state.profile;
  $('#meta').textContent = `점 ${p.points.length} · 축 ${(p.axisX * 100).toFixed(1)}%` + (ms != null ? ` · 분석 ${ms}ms` : '');
}

// 촬영 정보 한 줄: 카메라가 어디서 보는지, 빛이 어디서 오는지, 저장 크기
function readout(v, l) {
  const [w, h] = $('#size').value.split('x');
  $('#readout').innerHTML = `카메라 <b>${v.azimuth}°</b> 높이 <b>${v.elevation}°</b> · 조명 <b>${Math.round(l.azimuth)}°</b> 높이 <b>${Math.round(l.elevation)}°</b> · <b>${w}×${h}</b>`;
}

// 뷰파인더 모서리 표시를 3D 화면 네 귀퉁이에 붙인다
function placeCrops() {
  const box = $('#viewbox').getBoundingClientRect(), c = $('#view').getBoundingClientRect();
  const o = 10, L = c.left - box.left - o, T = c.top - box.top - o, R = box.right - c.right - o, B = box.bottom - c.bottom - o;
  const set = (cls, css) => Object.assign($(`.crop.${cls}`).style, css);
  set('tl', { left: `${L}px`, top: `${T}px`, borderLeftWidth: '1.5px', borderTopWidth: '1.5px' });
  set('tr', { right: `${R}px`, top: `${T}px`, borderRightWidth: '1.5px', borderTopWidth: '1.5px' });
  set('bl', { left: `${L}px`, bottom: `${B}px`, borderLeftWidth: '1.5px', borderBottomWidth: '1.5px' });
  set('br', { right: `${R}px`, bottom: `${B}px`, borderRightWidth: '1.5px', borderBottomWidth: '1.5px' });
}
new ResizeObserver(() => requestAnimationFrame(placeCrops)).observe($('#viewbox'));

async function loadFile(file) {
  if (!file) return;
  const url = URL.createObjectURL(file);
  try { await loadImage(url, file.name); } finally { URL.revokeObjectURL(url); }
}

async function loadImage(src, name) {
  const token = ++loadSeq;
  const img = new Image();
  img.src = src;
  try { await img.decode(); } catch {
    if (token === loadSeq) say('이미지를 열 수 없어요. PNG·JPG 사진을 넣어 주세요', true);
    return;
  }
  if (token !== loadSeq) return;
  const iw = img.naturalWidth, ih = img.naturalHeight;
  if (!iw || !ih || Math.max(iw, ih) > 16000 || Math.max(iw / ih, ih / iw) > 10) {
    say('이 사진은 크기나 비율이 너무 커서 열지 않았어요(16000px, 가로세로 10배 안쪽)', true);
    return;
  }
  // 3D 겉면·편집기용 사본(너무 크면 2048px 로 줄인다)
  const k = Math.min(1, 2048 / Math.max(iw, ih));
  const tex = document.createElement('canvas');
  tex.width = Math.max(1, Math.round(iw * k)); tex.height = Math.max(1, Math.round(ih * k));
  tex.getContext('2d').drawImage(img, 0, 0, tex.width, tex.height);
  Object.assign(state, { image: tex, source: img, aspect: iw / ih, name });
  document.body.classList.add('loaded');
  extract();
}

const REASONS = {
  small: '제품을 찾지 못했어요. 배경과 색이 확실히 다른 사진이거나, 배경 구분 값을 낮춰 보세요',
  large: '사진 거의 전체가 제품으로 잡혔어요. 배경이 단색인 사진을 넣거나 배경 구분 값을 올려 보세요',
  edge: '제품 가장자리를 찾지 못했어요. 제품이 사진 가장자리에 닿지 않게 여백을 두거나 배경 구분 값을 바꿔 보세요',
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
    state.profile = null;
    viewer.clear();
    editor.set(state.image, null);
    say(REASONS[res.reason] || REASONS.edge, true);
    meta();
    return;
  }
  state.profile = res.profile;
  state.capY = suggestCapSplit(res.profile);
  editor.set(state.image, res.profile, state.capY);
  viewer.setShape(res.profile, state.image, state.aspect, state.capY);
  editor.setLabel(viewer.label.on ? viewer.label : null);
  meta(ms);
  renderFinishes();
  say(`${state.name} · 외곽선을 땄어요. 어긋난 곳은 점을 끌어서 고치세요`);
}

// 사진 넣기: 파일 고르기·끌어다 놓기·예시
$('#file').addEventListener('change', (e) => { loadFile(e.target.files[0]); e.target.value = ''; });
const box = $('#editbox');
document.addEventListener('dragover', (e) => { e.preventDefault(); box.classList.add('drag'); });
document.addEventListener('dragleave', (e) => { if (!e.relatedTarget) box.classList.remove('drag'); });
document.addEventListener('drop', (e) => { e.preventDefault(); box.classList.remove('drag'); loadFile(e.dataTransfer.files[0]); });
document.querySelectorAll('[data-sample]').forEach((b) => b.addEventListener('click', () => loadImage(b.dataset.sample, b.dataset.sample.split('/').pop())));

// 외곽선 다시 따기
$('#tol').addEventListener('input', (e) => { state.tol = +e.target.value; $('#tolv').textContent = state.tol; });
$('#tol').addEventListener('change', extract);
$('#redo').addEventListener('click', extract);

// ── 겉면: 부위 탭(몸통·뚜껑·라벨), 재질 견본, 색
const COLORS = [
  ['#f2efe8', '크림 화이트'], ['#1f1e1c', '블랙'], ['#7a3f1d', '앰버'], ['#9fb2a3', '세이지'],
  ['#d8b48a', '샌드'], ['#7d2a22', '버건디'], ['#c9cbce', '실버'], ['#b7893f', '골드'],
];
const tabs = $('#parts');
tabs.addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  state.part = b.dataset.part;
  tabs.querySelectorAll('button').forEach((t) => t.setAttribute('aria-selected', String(t === b)));
  $('#finishPanel').hidden = state.part === 'label';
  $('#labelPanel').hidden = state.part !== 'label';
  renderFinishes();
});

function renderFinishes() {
  if (state.part === 'label') return;
  const part = viewer.parts[state.part];
  const wrap = $('#finishes');
  wrap.replaceChildren(...Object.entries(FINISHES).map(([key, f]) => {
    const img = el('img', { alt: '' });
    const src = viewer.swatch(key, part.color);
    if (src) img.src = src;
    const b = el('button', { 'data-finish': key, 'aria-pressed': String(part.finish === key), title: f.name }, [img, f.name]);
    if (key === 'photo' && !state.image) b.disabled = true;
    return b;
  }));
  const colors = $('#colors');
  colors.replaceChildren(...COLORS.map(([c, name]) =>
    el('button', { 'data-color': c, title: name, 'aria-label': name, 'aria-pressed': String(part.finish !== 'photo' && part.color === c), style: `background:${c}` })),
  el('label', { title: '직접 고르기' }, ['+', el('input', { type: 'color', id: 'customColor', value: part.color })]));
  colors.classList.toggle('dim', part.finish === 'photo');
}

$('#finishes').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  viewer.setFinish(state.part, b.dataset.finish);
  press($('#finishes'), b);
  $('#colors').classList.toggle('dim', b.dataset.finish === 'photo');
});
function pickColor(c) {
  const part = viewer.parts[state.part];
  // 사진 그대로인 상태에서 색을 고르면 색이 보이는 무광으로 바꾼다
  viewer.setFinish(state.part, part.finish === 'photo' ? 'matte' : null, c);
  renderFinishes();
}
$('#colors').addEventListener('click', (e) => { const b = e.target.closest('button[data-color]'); if (b) pickColor(b.dataset.color); });
$('#colors').addEventListener('change', (e) => { if (e.target.id === 'customColor') pickColor(e.target.value); });

// ── 라벨: 없음 / 예시 라벨 / 내 이미지. 높이·크기는 병 높이 비율, 감기는 둘레 각도
function sampleLabel() {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#f1ebdf'; g.fillRect(0, 0, 1024, 512);
  g.strokeStyle = '#2a2724'; g.lineWidth = 3; g.strokeRect(40, 40, 944, 432);
  g.lineWidth = 1.5; g.strokeRect(54, 54, 916, 404);
  g.fillStyle = '#2a2724'; g.textAlign = 'center';
  g.font = '500 40px Pretendard, sans-serif'; g.fillText('No. 07', 512, 150);
  g.font = '600 112px Pretendard, sans-serif'; g.fillText('데일리 세럼', 512, 290);
  g.fillRect(432, 330, 160, 2);
  g.font = '400 36px Pretendard, sans-serif'; g.fillText('30 ml  ·  1.0 fl.oz', 512, 400);
  return c;
}
function labelGeom() {
  const pos = +$('#lpos').value / 100, size = +$('#lsize').value / 100;
  $('#lposv').textContent = `${Math.round(pos * 100)}%`;
  $('#lsizev').textContent = `${Math.round(size * 100)}%`;
  $('#lwrapv').textContent = `${$('#lwrap').value}°`;
  return { y0: Math.max(0, pos - size / 2), y1: Math.min(1, pos + size / 2), width: +$('#lwrap').value };
}
function applyLabel(patch = {}) {
  viewer.setLabel({ ...patch, ...labelGeom() });
  editor.setLabel(viewer.label.on ? viewer.label : null);
}
$('#labelSrc').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.src === 'file') { $('#labelFile').click(); return; }
  press($('#labelSrc'), b);
  applyLabel(b.dataset.src === 'none' ? { on: false } : { on: true, image: sampleLabel() });
});
$('#labelFile').addEventListener('change', async (e) => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  const url = URL.createObjectURL(f), img = new Image();
  img.src = url;
  try { await img.decode(); } catch { say('라벨 이미지를 열 수 없어요', true); return; } finally { URL.revokeObjectURL(url); }
  press($('#labelSrc'), $('#labelSrc [data-src=file]'));
  // 가로세로 비율을 지키도록 감기 각도에 맞춰 크기를 정한다
  applyLabel({ on: true, image: img });
  say(`${f.name} 라벨을 붙였어요`);
});
for (const id of ['lpos', 'lsize', 'lwrap']) $('#' + id).addEventListener('input', () => applyLabel());

// ── 세트: 배경지·받침
$('#backdrops').replaceChildren(...Object.entries(BACKDROPS).map(([k, b]) =>
  el('button', { 'data-backdrop': k, 'aria-pressed': String(k === viewer.set.backdrop) }, [el('i', { style: `background:${b.color}` }), b.name])));
$('#backdrops').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  viewer.setSet({ backdrop: b.dataset.backdrop }); press($('#backdrops'), b);
});
$('#pedestals').replaceChildren(...Object.entries(PEDESTALS).map(([k, n]) =>
  el('button', { 'data-pedestal': k, 'aria-pressed': String(k === viewer.set.pedestal), text: n })));
$('#pedestals').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  viewer.setSet({ pedestal: b.dataset.pedestal }); press($('#pedestals'), b);
});

// ── 앵글 프리셋
$('#cams').replaceChildren(...Object.entries(CAMERAS).map(([k, c]) =>
  el('button', { 'data-cam': k, 'aria-pressed': String(k === 'three'), text: c.name })));
$('#cams').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  viewer.setCamera(b.dataset.cam); press($('#cams'), b);
});
$('#view').addEventListener('pointerdown', () => press($('#cams'), null)); // 손으로 돌리면 프리셋 표시를 끈다

// ── 조명: 위에서 본 세트. 아래쪽이 정면, 가운데일수록 머리 위
const pad = $('#pad'), dot = $('#dot');
function placeDot() {
  const { azimuth, elevation } = viewer.light;
  const a = (azimuth * Math.PI) / 180, d = 0.12 + 0.8 * (1 - elevation / 90);
  const x = 50 + 46 * d * Math.sin(a), y = 50 + 46 * d * Math.cos(a);
  dot.style.left = `${x}%`; dot.style.top = `${y}%`;
  const ray = $('#ray'), len = Math.hypot(x - 50, y - 50) * 1.2; // 120px 판 → % 를 px 로
  ray.style.width = `${len}px`;
  ray.style.transform = `rotate(${Math.atan2(y - 50, x - 50)}rad)`;
}
function padMove(e) {
  const r = pad.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width * 2 - 1, y = (e.clientY - r.top) / r.height * 2 - 1;
  const d = Math.min(1, Math.max(0, (Math.hypot(x, y) / 0.92 - 0.12) / 0.8));
  viewer.setLight({ azimuth: (Math.atan2(x, y) * 180) / Math.PI, elevation: Math.max(8, 90 * (1 - d)) });
  press($('#lights'), null);
  placeDot();
}
pad.addEventListener('pointerdown', (e) => { pad.setPointerCapture(e.pointerId); padMove(e); });
pad.addEventListener('pointermove', (e) => { if (pad.hasPointerCapture(e.pointerId)) padMove(e); });
$('#lights').replaceChildren(...Object.entries(LIGHTS).map(([k, l]) =>
  el('button', { 'data-light': k, 'aria-pressed': String(k === 'key'), text: l.name })));
$('#lights').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  const { azimuth, elevation } = LIGHTS[b.dataset.light];
  viewer.setLight({ azimuth, elevation }); press($('#lights'), b); placeDot();
});
$('#power').addEventListener('input', (e) => { viewer.setLight({ intensity: +e.target.value }); $('#powerv').textContent = (+e.target.value).toFixed(1); });
$('#size').addEventListener('change', () => viewer.emitView());
placeDot();
renderFinishes();
viewer.emitView();

// PNG 저장
$('#save').addEventListener('click', () => {
  if (!state.profile) { say('먼저 사진을 넣어 주세요', true); return; }
  const [w, h] = $('#size').value.split('x').map(Number);
  const url = viewer.capture(w, h);
  if (!url) { say('저장하지 못했어요. 3D 화면이 멈췄거나 이 크기를 그래픽 카드가 못 그려요. 작은 크기로 해 보세요', true); return; }
  const a = document.createElement('a');
  const t = new Date(), p = (n) => String(n).padStart(2, '0');
  a.download = `studio_${t.getFullYear()}${p(t.getMonth() + 1)}${p(t.getDate())}_${p(t.getHours())}${p(t.getMinutes())}${p(t.getSeconds())}.png`;
  a.href = url;
  document.body.appendChild(a); a.click(); a.remove();
  say(`${w}×${h} PNG 로 저장했어요`);
});

// 시험용 손잡이(e2e 가 상태를 읽는다)
window.studio = { state, viewer, editor };
