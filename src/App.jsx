// 화면: Astryx canvas-editor 템플릿의 뼈대(헤더 · 왼쪽 패널 · 가운데 작업면 + 도구 막대 · 오른쪽 인스펙터)에
// 한 장 스튜디오 내용을 채운다. 외곽선·편집기·3D 는 화면과 따로 있는 모듈(outline·editor·viewer)이 맡는다.
import { useEffect, useRef, useState, useCallback } from 'react';
import { Theme } from '@astryxdesign/core/theme';
import { Section } from '@astryxdesign/core/Section';
import { HStack, VStack, Layout, LayoutContent, LayoutFooter, LayoutHeader, LayoutPanel } from '@astryxdesign/core/Layout';
import { Heading, Text } from '@astryxdesign/core/Text';
import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { Selector } from '@astryxdesign/core/Selector';
import { Slider } from '@astryxdesign/core/Slider';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { TabList, Tab } from '@astryxdesign/core/TabList';
import { SelectableCard } from '@astryxdesign/core/SelectableCard';
import { AspectRatio } from '@astryxdesign/core/AspectRatio';
import { Thumbnail } from '@astryxdesign/core/Thumbnail';
import { FileInput } from '@astryxdesign/core/FileInput';
import { Toolbar } from '@astryxdesign/core/Toolbar';
import { Card } from '@astryxdesign/core/Card';
import { TextArea } from '@astryxdesign/core/TextArea';
import { ProgressBar } from '@astryxdesign/core/ProgressBar';
import { Aperture, Box, Clapperboard, Download, RotateCcw, Square } from 'lucide-react';
import { zipSync, strToU8 } from 'fflate';
import { studioTheme } from './theme.js';
import { analyze, analysisSize, suggestCapSplit, boxFromImage, edgeColor, DEFAULT_TOL } from './outline.js';
import { Editor } from './editor.js';
import { Viewer, FINISHES, BACKDROPS, PEDESTALS, CAMERAS, LIGHTS } from './viewer.js';
import { LightPad } from './LightPad.jsx';
import { resolveColor } from './tokens.js';

const SAMPLES = {
  bottle: [
    { src: '/samples/bottle_amber.png', name: '갈색 앰플' },
    { src: '/samples/bottle_white.png', name: '흰 로션병' },
  ],
  box: [
    { src: '/samples/box_cream.png', name: '크림 상자' },
    { src: '/samples/box_navy.png', name: '남색 상자' },
  ],
};
// 연출 컷 장면 프리셋(지어낸 장면. 고정 지시 — 앵글·조명 유지, 브랜드 금지 — 는 서버가 붙인다)
const SCENES = [
  { key: 'limestone', name: '석회암 자연광', text: '따뜻한 베이지 석회암 바닥과 벽, 창으로 들어오는 부드러운 오후 자연광, 차분한 고급 화장품 광고' },
  { key: 'marble', name: '대리석 스튜디오', text: '흰 대리석 받침과 연회색 스튜디오 배경, 깨끗한 소프트박스 조명, 미니멀한 제품 카탈로그 사진' },
  { key: 'water', name: '물결 수면', text: '얕은 물 위에 놓인 제품, 잔잔한 물결과 물에 비친 반사, 맑고 시원한 여름 광고 느낌' },
  { key: 'linen', name: '리넨과 그림자', text: '구겨진 크림색 리넨 천 위, 창살 모양 그림자가 비스듬히 지는 아침 햇살, 따뜻한 라이프스타일 사진' },
  { key: 'night', name: '먹색 무드', text: '먹색 배경과 바닥, 제품 가장자리를 따라 흐르는 좁은 테두리 빛, 어둡고 고급스러운 향수 광고 느낌' },
];
const SIZES = [{ value: '1080x1350', label: '1080 × 1350' }, { value: '2160x2700', label: '2160 × 2700' }];
// 병에 입히는 색(제품 색이라 테마 토큰이 아니라 값 그대로 둔다)
const COLORS = [
  ['#f2efe8', '크림 화이트'], ['#1f1e1c', '블랙'], ['#7a3f1d', '앰버'], ['#9fb2a3', '세이지'],
  ['#d8b48a', '샌드'], ['#7d2a22', '버건디'], ['#c9cbce', '실버'], ['#b7893f', '골드'],
];
const REASONS = {
  small: '제품을 찾지 못했어요. 배경과 색이 확실히 다른 사진이거나, 배경 구분 값을 낮춰 보세요',
  large: '사진 거의 전체가 제품으로 잡혔어요. 배경이 단색인 사진을 넣거나 배경 구분 값을 올려 보세요',
  edge: '제품 가장자리를 찾지 못했어요. 제품이 사진 가장자리에 닿지 않게 여백을 두거나 배경 구분 값을 바꿔 보세요',
};

function InspectorSection({ title, children }) {
  return (
    <Section padding={3} dividers={['bottom']}>
      <VStack gap={3}>
        <Text type="label" weight="semibold">{title}</Text>
        {children}
      </VStack>
    </Section>
  );
}

// 예시 라벨: 지어낸 무브랜드 라벨(캔버스로 그린다)
function sampleLabel(font) {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#f1ebdf'; g.fillRect(0, 0, 1024, 512);
  g.strokeStyle = '#2a2724'; g.lineWidth = 3; g.strokeRect(40, 40, 944, 432);
  g.lineWidth = 1.5; g.strokeRect(54, 54, 916, 404);
  g.fillStyle = '#2a2724'; g.textAlign = 'center';
  g.font = `500 40px ${font}`; g.fillText('No. 07', 512, 150);
  g.font = `600 112px ${font}`; g.fillText('데일리 세럼', 512, 290);
  g.fillRect(432, 330, 160, 2);
  g.font = `400 36px ${font}`; g.fillText('30 ml  ·  1.0 fl.oz', 512, 400);
  return c;
}

export function App() {
  const viewCanvas = useRef(null), editCanvas = useRef(null);
  const viewer = useRef(null), editor = useRef(null);
  const S = useRef({ image: null, source: null, aspect: 1, profile: null, capY: null, name: '' }).current;
  // 상자: 사진 + 앞면 사각형(사진 비율 좌표)
  const SB = useRef({ image: null, source: null, aspect: 1, rect: null, name: '', userColor: false }).current;
  const loadSeq = useRef({ bottle: 0, box: 0 }); // 제품마다 따로: 병을 여는 중에 상자를 열어도 병이 버려지지 않게
  const latest = useRef({}); // 끌어다 놓기 처리기(처음 한 번 등록)가 지금 화면의 함수·값을 쓰게
  const kindRef = useRef('bottle'); // 끌어다 놓기 처리기가 지금 고른 제품을 알도록

  const [status, setStatus] = useState({ text: '제품 사진을 넣으면 시작해요', bad: false });
  const [product, setProductState] = useState('bottle'); // 왼쪽 패널에서 고친 제품
  const [has, setHas] = useState({ bottle: false, box: false }); // 사진이 들어온 제품
  const loaded = has[product], any = has.bottle || has.box;
  const [boxSide, setBoxSide] = useState({ finish: 'matte', color: '#dddddd' });
  const [boxDim, setBoxDim] = useState({ scale: 90, depth: 45 });
  const [gap, setGap] = useState(35);
  const [meta, setMeta] = useState('');
  const [tol, setTol] = useState(DEFAULT_TOL);
  const [part, setPart] = useState('body');
  latest.current.part = part;
  const [parts, setParts] = useState({ body: { finish: 'photo', color: '#e9e6df' }, cap: { finish: 'photo', color: '#2b2a28' } });
  const [swatches, setSwatches] = useState({});
  const [labelSrc, setLabelSrc] = useState('none');
  const [label, setLabelGeom] = useState({ pos: 46, size: 30, wrap: 150 });
  const [backdrop, setBackdrop] = useState('paper');
  const [pedestal, setPedestal] = useState('none');
  const [cam, setCam] = useState('three');
  const [lightPreset, setLightPreset] = useState('key');
  const [light, setLight] = useState({ ...LIGHTS.key, intensity: 2.4 });
  const [view, setView] = useState({ azimuth: 0, elevation: 0 });
  const [size, setSize] = useState('1080x1350');
  const [sceneKey, setSceneKey] = useState(SCENES[0].key);
  const [sceneText, setSceneText] = useState(SCENES[0].text);
  const [shot, setShot] = useState(null);      // { id, state, elapsed, error }
  const [mode, setMode] = useState('view');    // view: 3D / compare: 캡처 | 연출 컷
  const pollTimer = useRef(0), pollFails = useRef(0), alive = useRef(true);
  const [pending, setPending] = useState(false); // 요청 보내는 중(더블클릭으로 두 번 보내지 않게)

  const say = (text, bad = false) => setStatus({ text, bad });
  const font = () => getComputedStyle(document.body).fontFamily || 'sans-serif';

  // 테마 토큰 → 캔버스 색(편집기 선·라벨 표시)
  const tokenColors = () => {
    const el = editCanvas.current;
    return { ink: resolveColor(el, '--color-text-primary', 'black'), accent: resolveColor(el, '--color-accent', 'firebrick'), shade: 'rgba(255,255,255,0.55)', font: font() };
  };

  const showMeta = (ms, kind = kindRef.current) => {
    const tail = ms != null ? ` · 분석 ${ms}ms` : '';
    if (kind === 'box') {
      const r = SB.rect;
      setMeta(r ? `앞면 ${((r.right - r.left) * 100).toFixed(0)}×${((r.bottom - r.top) * 100).toFixed(0)}% · 가로/세로 ${((r.right - r.left) * SB.aspect / (r.bottom - r.top)).toFixed(2)}` + tail : '');
      return;
    }
    const p = S.profile;
    setMeta(p ? `점 ${p.points.length} · 축 ${(p.axisX * 100).toFixed(1)}%` + tail : '');
  };
  // 견본 구에 칠할 색: 고른 부위(라벨이면 몸통, 상자면 옆면)
  const partColor = (p) => (p === 'box' ? viewer.current.box.color : viewer.current.parts[p === 'label' ? 'body' : p].color);

  // 재질 견본: 같은 렌더러로 작은 구를 그린다. 한꺼번에 그리면 화면이 몇 초 멈춰서(소프트웨어 렌더링에서 약 3초)
  // 하나씩 쉬어 가며 그린다. 새로 요청이 오면 앞의 줄은 버린다
  const swatchJob = useRef(0), swatchesDone = useRef(false), rectFrame = useRef(0);
  const renderSwatches = useCallback((key, color) => {
    const v = viewer.current;
    if (!v) return;
    const job = ++swatchJob.current, queue = Object.keys(FINISHES);
    const step = () => {
      if (job !== swatchJob.current || !queue.length) return;
      const f = queue.shift();
      setSwatches((sw) => ({ ...sw, [f]: v.swatch(f, color) }));
      setTimeout(step, 40);
    };
    // 상태 문구와 3D 가 화면에 먼저 그려진 다음 시작한다(두 번 그려질 때까지 기다린 뒤 조금 더)
    requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(step, 250)));
  }, []);

  useEffect(() => {
    const v = viewer.current = new Viewer(viewCanvas.current, {
      onLost: () => say('3D 화면이 멈췄어요. 잠시 뒤 돌아오지 않으면 새로고침해 주세요', true),
      onRestored: () => say('3D 화면이 다시 켜졌어요'),
      onView: (vw, l) => { setView(vw); setLight({ ...l }); },
    });
    const e = editor.current = new Editor(editCanvas.current, (profile, capY) => {
      S.profile = profile; S.capY = capY;
      if (!v.setShape(profile, S.image, S.aspect, capY)) say('점들이 한 높이에 몰려 있어요. 위아래로 벌려 주세요', true);
      showMeta();
    }, (rect) => {
      // 상자 앞면 사각형을 끌 때: 한 프레임에 한 번만 3D 를 다시 만든다
      SB.rect = rect;
      if (rectFrame.current) return;
      rectFrame.current = requestAnimationFrame(() => { rectFrame.current = 0; v.setBox({ rect: SB.rect }); showMeta(); });
    });
    e.setColors(tokenColors());
    // 재질 견본은 첫 사진이 들어온 뒤에 그린다. 견본을 이미지로 뜨는 순간 밀린 그래픽 작업을 다 기다리는데,
    // 앱을 연 직후엔 셰이더 컴파일이 밀려 있어 화면이 2초 가까이 멈췄다(그동안 사진을 넣어도 못 받음)
    v.emitView();
    window.studio = { state: S, box: SB, viewer: v, editor: e };
    // 끌어다 놓기
    const over = (ev) => ev.preventDefault();
    const drop = (ev) => { ev.preventDefault(); latest.current.loadFile(ev.dataTransfer.files[0]); };
    document.addEventListener('dragover', over);
    document.addEventListener('drop', drop);
    return () => { document.removeEventListener('dragover', over); document.removeEventListener('drop', drop); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  latest.current.loadFile = loadFile;
  async function loadFile(file) {
    if (!file) return;
    const url = URL.createObjectURL(file);
    try { await loadImage(url, file.name); } finally { URL.revokeObjectURL(url); }
  }

  async function loadImage(src, name, kind = kindRef.current) {
    const token = ++loadSeq.current[kind];
    const img = new Image();
    img.src = src;
    try { await img.decode(); } catch {
      if (token === loadSeq.current[kind]) say('이미지를 열 수 없어요. PNG·JPG 사진을 넣어 주세요', true);
      return;
    }
    if (token !== loadSeq.current[kind]) return;
    const iw = img.naturalWidth, ih = img.naturalHeight;
    if (!iw || !ih || Math.max(iw, ih) > 16000 || Math.max(iw / ih, ih / iw) > 10) {
      say('이 사진은 크기나 비율이 너무 커서 열지 않았어요(16000px, 가로세로 10배 안쪽)', true);
      return;
    }
    const k = Math.min(1, 2048 / Math.max(iw, ih));
    const tex = document.createElement('canvas');
    tex.width = Math.max(1, Math.round(iw * k)); tex.height = Math.max(1, Math.round(ih * k));
    tex.getContext('2d').drawImage(img, 0, 0, tex.width, tex.height);
    Object.assign(kind === 'box' ? SB : S, { image: tex, source: img, aspect: iw / ih, name });
    if (kind === 'box') { SB.userColor = false; SB.rect = null; } // 새 상자 사진이면 옆면 색·사각형도 새로 딴다(옛 사각형이 새 사진 위에 안 보이게)
    setHas((h) => ({ ...h, [kind]: true }));
    // 편집기 캔버스가 보이고 크기가 잡힌 다음 따기
    requestAnimationFrame(() => extract(tol, kind));
  }

  // 왼쪽 패널의 제품을 바꾸면 편집기에 그 제품 사진과 선을 다시 올린다
  function setProduct(kind, redraw = true) {
    kindRef.current = kind;
    setProductState(kind);
    if (!redraw) return;
    const e = editor.current;
    if (kind === 'box') { if (SB.image) e.setBox(SB.image, SB.rect); }
    else if (S.image) { e.set(S.image, S.profile, S.capY); e.setLabel(viewer.current.label.on ? viewer.current.label : null); }
    showMeta(null, kind);
  }

  function pixels(source) {
    const [w, h] = analysisSize(source.naturalWidth, source.naturalHeight);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(source, 0, 0, w, h);
    return [g.getImageData(0, 0, w, h).data, w, h];
  }

  // 상자: 앞면 사각형 + 옆면 색(앞면 테두리 띠 색)
  function extractBox(t) {
    if (!SB.source) return;
    const v = viewer.current, e = editor.current, onEditor = kindRef.current === 'box';
    const t0 = performance.now();
    const [px, w, h] = pixels(SB.source);
    const { rect, reason } = boxFromImage(px, w, h, { tol: t });
    const ms = Math.round(performance.now() - t0);
    if (!rect) {
      SB.rect = null;
      v.clear('box');
      if (onEditor) e.setBox(SB.image, null);
      say(REASONS[reason] || REASONS.edge, true);
      if (onEditor) showMeta(null, 'box');
      return;
    }
    SB.rect = rect;
    // 옆면 색: 사용자가 칩으로 고른 색이 있으면 그대로, 아니면 앞면 테두리 띠 색(못 구하면 연회색)
    const color = SB.userColor ? v.box.color : (edgeColor(px, w, h, rect) || '#dddddd');
    if (onEditor) e.setBox(SB.image, rect);
    v.setBox({ rect, image: SB.image, aspect: SB.aspect, color }); // 크기·두께는 viewer 가 들고 있는 값 그대로
    setBoxSide((b) => ({ ...b, color }));
    if (onEditor) showMeta(ms, 'box');
    say(`${SB.name} · 상자 앞면을 찾았어요. 모서리를 끌어 맞추고, 크기·두께는 오른쪽 겉면 > 상자에서 바꿔요`);
    // 병이 없으면 오른쪽 겉면도 상자 탭으로(병 부위 탭은 할 일이 없다)
    const cur = S.profile ? latest.current.part : 'box';
    if (cur !== latest.current.part) setPart(cur);
    if (!swatchesDone.current || cur === 'box') { swatchesDone.current = true; renderSwatches(cur, partColor(cur)); }
  }

  function extract(t = tol, kind = kindRef.current) {
    if (kind === 'box') { extractBox(t); return; }
    if (!S.source) return;
    const v = viewer.current, e = editor.current, onEditor = kindRef.current === 'bottle';
    const t0 = performance.now();
    const [px, w, h] = pixels(S.source);
    const res = analyze(px, w, h, { tol: t });
    const ms = Math.round(performance.now() - t0);
    if (!res.profile) {
      S.profile = null;
      v.clear();
      if (onEditor) { e.set(S.image, null); showMeta(); }
      say(REASONS[res.reason] || REASONS.edge, true);
      return;
    }
    S.profile = res.profile;
    S.capY = suggestCapSplit(res.profile);
    v.setShape(res.profile, S.image, S.aspect, S.capY);
    if (onEditor) { e.set(S.image, res.profile, S.capY); e.setLabel(v.label.on ? v.label : null); showMeta(ms); }
    say(`${S.name} · 외곽선을 땄어요. 어긋난 곳은 점을 끌어서 고치세요`);
    // 처음이면 견본 다섯 개를, 아니면 '사진' 견본만 다시 그린다(나머지는 색에만 달렸다). 3D 가 먼저 뜨게 한 박자 뒤에
    if (!swatchesDone.current) { swatchesDone.current = true; renderSwatches(latest.current.part, partColor(latest.current.part)); }
    else requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(() => setSwatches((sw) => ({ ...sw, photo: v.swatch('photo', '#ffffff') })), 250)));
  }

  // ── 겉면
  const curPart = part === 'label' ? null : part === 'box' ? boxSide : parts[part];
  function chooseFinish(finish) {
    if (part === 'box') { viewer.current.setBoxFinish(finish); setBoxSide((b) => ({ ...b, finish })); return; }
    viewer.current.setFinish(part, finish);
    setParts((ps) => ({ ...ps, [part]: { ...ps[part], finish } }));
  }
  function chooseColor(color) {
    if (part === 'box') {
      SB.userColor = true;
      viewer.current.setBoxFinish(null, color);
      setBoxSide((b) => ({ ...b, color }));
      renderSwatches('box', color);
      return;
    }
    const p = viewer.current.parts[part];
    const finish = p.finish === 'photo' ? 'matte' : p.finish; // 사진 상태에서 색을 고르면 색이 보이는 무광으로
    viewer.current.setFinish(part, finish, color);
    setParts((ps) => ({ ...ps, [part]: { finish, color } }));
    renderSwatches(part, color);
  }
  function choosePart(next) {
    setPart(next);
    if (next !== 'label') renderSwatches(next, partColor(next));
  }
  function resizeBox(key, value) {
    const d = { ...boxDim, [key]: value };
    setBoxDim(d);
    viewer.current.setBoxSize({ scale: d.scale / 100, depth: d.depth / 100 });
  }

  // ── 라벨: 높이·크기는 병 높이 비율, 감기는 둘레 각도
  const labelPatch = (g) => ({
    y0: Math.max(0, (g.pos - g.size / 2) / 100), y1: Math.min(1, (g.pos + g.size / 2) / 100), width: g.wrap,
  });
  function applyLabel(patch, g = label) {
    viewer.current.setLabel({ ...patch, ...labelPatch(g) });
    editor.current.setLabel(viewer.current.label.on ? viewer.current.label : null);
  }
  function chooseLabel(src) {
    setLabelSrc(src);
    if (src === 'file') return; // 아래에 나타나는 파일 칸에서 고른다
    applyLabel(src === 'none' ? { on: false } : { on: true, image: sampleLabel(font()) });
  }
  async function labelFile(f) {
    if (!f) return;
    const url = URL.createObjectURL(f), img = new Image();
    img.src = url;
    try { await img.decode(); } catch { say('라벨 이미지를 열 수 없어요', true); return; } finally { URL.revokeObjectURL(url); }
    setLabelSrc('file');
    applyLabel({ on: true, image: img });
    say(`${f.name} 라벨을 붙였어요`);
  }
  function moveLabel(key, value) {
    const g = { ...label, [key]: value };
    setLabelGeom(g);
    applyLabel({}, g);
  }

  // ── 저장
  const stamp = () => {
    const t = new Date(), p = (n) => String(n).padStart(2, '0');
    return `${t.getFullYear()}${p(t.getMonth() + 1)}${p(t.getDate())}_${p(t.getHours())}${p(t.getMinutes())}${p(t.getSeconds())}`;
  };
  function download(href, name) {
    const a = document.createElement('a');
    a.download = name; a.href = href;
    document.body.appendChild(a); a.click(); a.remove();
  }
  function save() {
    if (!viewer.current.ready) { say('먼저 사진을 넣어 주세요', true); return; }
    const [w, h] = size.split('x').map(Number);
    const url = viewer.current.capture(w, h);
    if (!url) { say('저장하지 못했어요. 3D 화면이 멈췄거나 이 크기를 그래픽 카드가 못 그려요. 작은 크기로 해 보세요', true); return; }
    download(url, `studio_${stamp()}.png`);
    say(`${w}×${h} PNG 로 저장했어요`);
  }

  // ── OBJ 저장: 모양(model.obj) + 재질(model.mtl) + 입힌 그림(PNG)을 zip 하나로
  const toPNG = (img) => new Promise((resolve, reject) => {
    const c = document.createElement('canvas');
    c.width = img.width || img.naturalWidth; c.height = img.height || img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    c.toBlob((b) => (b ? b.arrayBuffer().then((buf) => resolve(new Uint8Array(buf)), reject) : reject(new Error('png'))), 'image/png');
  });
  async function saveOBJ() {
    const out = viewer.current.ready && viewer.current.exportOBJ();
    if (!out) { say('먼저 사진을 넣어 주세요', true); return; }
    try {
      const files = { 'model.obj': strToU8(out.obj), 'model.mtl': strToU8(out.mtl) };
      for (const [name, img] of Object.entries(out.textures)) files[name] = await toPNG(img);
      const url = URL.createObjectURL(new Blob([zipSync(files)], { type: 'application/zip' }));
      download(url, `studio_model_${stamp()}.zip`);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      say(`OBJ 로 저장했어요(덩어리 ${out.meshes}개, 그림 ${Object.keys(out.textures).length}장). Blender 등에서 model.obj 를 열면 돼요`);
    } catch { say('OBJ 를 묶지 못했어요. 다시 눌러 주세요', true); }
  }

  // ── 연출 컷: 캡처 → 로컬 서버 → Codex. 서버는 이 페이지에 끼워 준 토큰과 같은 주소에서 온 요청만 받는다
  const token = () => document.querySelector('meta[name=studio-token]')?.content || '';
  async function api(path, body) {
    const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Studio-Token': token() }, body: JSON.stringify(body) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `서버 오류(${r.status})`);
    return data;
  }
  function poll(id) {
    clearTimeout(pollTimer.current);
    pollTimer.current = setTimeout(async () => {
      try {
        const r = await fetch(`/api/shot/${id}`, { headers: { 'X-Studio-Token': token() } });
        if (!r.ok) throw new Error(String(r.status));
        const info = await r.json();
        if (!alive.current) return;
        pollFails.current = 0;
        setShot(info);
        if (info.state === 'running') { poll(id); return; }
        if (info.state === 'done') { setMode('compare'); say(`연출 컷이 나왔어요(${Math.round(info.elapsed)}초). 왼쪽이 넘긴 캡처, 오른쪽이 Codex 가 만든 사진이에요`); }
        else if (info.state === 'cancelled') say('연출 컷 만들기를 취소했어요');
        else say(info.error || '연출 컷을 만들지 못했어요', true);
      } catch {
        // 서버가 잠깐 안 받으면 다시 묻되, 30번(약 30초) 넘게 실패하면 멈추고 알린다
        if (!alive.current) return;
        if (++pollFails.current > 30) { say('서버와 연결이 끊겼어요. serve.py 가 켜져 있는지 확인해 주세요', true); return; }
        poll(id);
      }
    }, 1000);
  }
  async function makeShot() {
    if (!viewer.current.ready) { say('먼저 사진을 넣어 주세요', true); return; }
    if (pending) return;
    const image = viewer.current.capture(1080, 1350);
    if (!image) { say('캡처를 뜨지 못했어요. 3D 화면이 멈췄으면 새로고침해 주세요', true); return; }
    setPending(true);
    try {
      const info = await api('/api/shot', { image, scene: sceneText });
      setMode('view'); // 새로 만드는 동안엔 3D 를 보여 준다(이전 결과의 비교 보기에 머물지 않게)
      setShot(info);
      say('Codex 에 캡처를 넘겼어요. 1분 남짓 걸려요');
      poll(info.id);
    } catch (e) { say(e.message, true); } finally { setPending(false); }
  }
  async function cancelShot() {
    if (!shot) return;
    try { await api(`/api/shot/${shot.id}/cancel`, {}); } catch (e) { say(e.message, true); }
  }
  async function saveShot() {
    if (shot?.state !== 'done') return;
    const r = await fetch(`/api/shot/${shot.id}/image`, { headers: { 'X-Studio-Token': token() } });
    if (!r.ok) { say('연출 컷 파일을 받지 못했어요', true); return; }
    const url = URL.createObjectURL(await r.blob());
    download(url, `shot_${shot.id}.png`);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    say('연출 컷을 저장했어요');
  }
  useEffect(() => () => { alive.current = false; clearTimeout(pollTimer.current); }, []);
  // 비교 보기는 결과가 다 됐을 때만. 다시 만드는 중이거나 실패하면 3D 로(가운데가 비지 않게)
  const showCompare = mode === 'compare' && shot?.state === 'done';

  const [W, H] = size.split('x');

  return (
    <Theme theme={studioTheme} mode="light">
      <Section variant="section" padding={0} height="100vh">
        <Layout
          height="fill"
          padding={0}
          header={
            <LayoutHeader hasDivider padding={2}>
              <HStack gap={3} vAlign="center" hAlign="between">
                <HStack gap={2} vAlign="center">
                  <Icon icon={Aperture} size="md" color="accent" />
                  <Heading level={4} accessibilityLevel={1}>한 장 스튜디오</Heading>
                </HStack>
                <Text type="supporting" color={status.bad ? 'accent' : 'secondary'} maxLines={1} data-testid="status">{status.text}</Text>
                <HStack gap={2} vAlign="center">
                  <Button variant="secondary" size="sm" label="OBJ 저장" icon={<Icon icon={Box} size="sm" />} isDisabled={!any} onClick={saveOBJ} data-testid="save-obj" />
                  <Selector label="저장 크기" isLabelHidden size="sm" options={SIZES} value={size} onChange={setSize} data-testid="size" />
                  <Button variant="primary" size="sm" label="PNG 저장" icon={<Icon icon={Download} size="sm" />} onClick={save} data-testid="save" />
                </HStack>
              </HStack>
            </LayoutHeader>
          }
          content={
            <LayoutContent padding={0}>
              <Layout
                height="fill"
                start={
                  <LayoutPanel hasDivider width={320} padding={0} isScrollable label="사진과 옆선">
                    <InspectorSection title="사진">
                      <TabList value={product} onChange={(k) => setProduct(k)} size="sm" layout="fill" hasDivider data-testid="product">
                        <Tab value="bottle" label="병" />
                        <Tab value="box" label="상자" />
                      </TabList>
                      <HStack gap={2} vAlign="center" hAlign="between">
                        <HStack gap={1}>
                          {SAMPLES[product].map((s) => (
                            <Thumbnail key={s.src} src={s.src} alt={s.name} label={`예시: ${s.name}`} onClick={() => loadImage(s.src, s.src.split('/').pop(), product)} />
                          ))}
                        </HStack>
                        {loaded && (
                          <FileInput label="다른 사진 넣기" isLabelHidden accept="image/*" placeholder="다른 사진" width={128}
                            value={null} onChange={(f) => loadFile(Array.isArray(f) ? f[0] : f)} data-testid="file2" />
                        )}
                      </HStack>
                      <Card padding={0} variant="muted">
                        <AspectRatio ratio={4 / 5}>
                          <canvas ref={editCanvas} hidden={!loaded} />
                          {!loaded && (
                            <FileInput mode="dropzone" label="제품 사진" isLabelHidden accept="image/*"
                              placeholder="제품 사진을 끌어다 놓거나 눌러서 고르기"
                              description={product === 'box'
                                ? '앞면을 정면에서 찍은, 배경이 단색인 상자 사진. 위 예시를 눌러도 돼요'
                                : '정면에서 찍은, 배경이 단색인 병 사진. 위 예시를 눌러도 돼요'}
                              value={null} onChange={(f) => loadFile(Array.isArray(f) ? f[0] : f)} data-testid="file" />
                          )}
                        </AspectRatio>
                      </Card>
                      <Text type="supporting">{product === 'box'
                        ? '사각형의 모서리나 변을 끌어 앞면에 맞춰요. 상자 가로·세로 비율은 이 사각형에서, 높이·두께는 오른쪽 겉면 > 상자에서 정해요'
                        : '점을 끌어 옮기고, 선 위 더블클릭으로 추가, 우클릭으로 지워요. "뚜껑" 이름표가 붙은 가로선을 위아래로 끌면 뚜껑 경계가 옮겨져요'}</Text>
                    </InspectorSection>
                    <InspectorSection title="외곽선 따기">
                      <Slider label="배경 구분" description="제품과 배경이 섞이면 낮추고, 배경까지 잡히면 올려요" min={8} max={60} value={tol} onChange={setTol} onChangeEnd={(t) => extract(t)} valueDisplay="inline" />
                      <Button variant="secondary" size="sm" label="외곽선 다시 따기" icon={<Icon icon={RotateCcw} size="sm" />} onClick={() => extract()} data-testid="redo" />
                      <Text type="code" color="secondary" hasTabularNumbers data-testid="meta">{meta || ' '}</Text>
                    </InspectorSection>
                  </LayoutPanel>
                }
                content={
                  <LayoutContent padding={0}>
                    <Section variant="muted" padding={0} height="100%">
                      <Layout
                        height="fill"
                        content={
                          <LayoutContent padding={6}>
                            <VStack height="100%" width="100%" hAlign="center" vAlign="center" style={showCompare ? { display: 'none' } : undefined} data-testid="view3d">
                              <canvas ref={viewCanvas} style={{ boxShadow: 'var(--shadow-high)', borderRadius: 'var(--radius-container)' }} />
                            </VStack>
                            {showCompare && (
                              <HStack height="100%" width="100%" gap={4} hAlign="center" vAlign="center" data-testid="compare">
                                {[['3D 캡처', `/api/shot/${shot.id}/capture?t=${token()}`], [`연출 컷 · ${Math.round(shot.elapsed)}초`, `/api/shot/${shot.id}/image?t=${token()}`]].map(([name, src]) => (
                                  <VStack key={name} gap={2} width="45%" hAlign="center">
                                    <Card padding={0} elevation="high" width="100%">
                                      <AspectRatio ratio={4 / 5} fit="cover"><img src={src} alt={name} /></AspectRatio>
                                    </Card>
                                    <Text type="label" color="secondary">{name}</Text>
                                  </VStack>
                                ))}
                              </HStack>
                            )}
                          </LayoutContent>
                        }
                        footer={
                          <LayoutFooter padding={2}>
                            <Toolbar
                              label="앵글"
                              size="sm"
                              startContent={
                                <HStack gap={2} vAlign="center">
                                  {shot?.state === 'done' && (
                                    <SegmentedControl label="보기" size="sm" value={showCompare ? 'compare' : 'view'} onChange={setMode}>
                                      <SegmentedControlItem value="view" label="3D" />
                                      <SegmentedControlItem value="compare" label="비교" />
                                    </SegmentedControl>
                                  )}
                                  {!showCompare && (
                                    <SegmentedControl label="앵글" size="sm" value={cam} onChange={(k) => { setCam(k); viewer.current.setCamera(k); }}>
                                      {Object.entries(CAMERAS).map(([k, c]) => <SegmentedControlItem key={k} value={k} label={c.name} />)}
                                    </SegmentedControl>
                                  )}
                                </HStack>
                              }
                              endContent={showCompare ? (
                                <Button variant="secondary" size="sm" label="연출 컷 저장" icon={<Icon icon={Download} size="sm" />} onClick={saveShot} data-testid="shot-save" />
                              ) : (
                                <Text type="code" color="secondary" hasTabularNumbers data-testid="readout">
                                  {`카메라 ${view.azimuth}°/${view.elevation}° · 조명 ${Math.round(light.azimuth)}°/${Math.round(light.elevation)}° · ${W}×${H}`}
                                </Text>
                              )}
                            />
                          </LayoutFooter>
                        }
                      />
                    </Section>
                  </LayoutContent>
                }
                end={
                  <LayoutPanel hasDivider width={300} padding={0} isScrollable label="덧입히기">
                    <InspectorSection title="겉면">
                      <TabList value={part} onChange={choosePart} size="sm" layout="fill" hasDivider>
                        <Tab value="body" label="몸통" />
                        <Tab value="cap" label="뚜껑" />
                        <Tab value="label" label="라벨" />
                        <Tab value="box" label="상자" />
                      </TabList>
                      {curPart ? (
                        <VStack gap={3}>
                          {part === 'box' && <Text type="supporting">앞·뒷면은 사진, 나머지 네 면에 입힐 재질과 색이에요</Text>}
                          <HStack gap={1} data-testid="finishes">
                            {Object.entries(FINISHES).filter(([k]) => part !== 'box' || k !== 'photo').map(([k, f]) => (
                              <SelectableCard key={k} label={f.name} padding={1} width={part === 'box' ? '25%' : '20%'} isSelected={curPart.finish === k}
                                isDisabled={k === 'photo' && !has.bottle} onChange={() => chooseFinish(k)} data-finish={k}>
                                <VStack gap={1} hAlign="center">
                                  <AspectRatio ratio={1} shape="circle">{swatches[k] ? <img src={swatches[k]} alt="" /> : null}</AspectRatio>
                                  <Text type="supporting" size="xsm">{f.name}</Text>
                                </VStack>
                              </SelectableCard>
                            ))}
                          </HStack>
                          <HStack gap={1} wrap="wrap" data-testid="colors">
                            {COLORS.map(([c, name]) => (
                              <SelectableCard key={c} label={name} padding={0} width={28} height={28}
                                isSelected={curPart.finish !== 'photo' && curPart.color === c} onChange={() => chooseColor(c)}
                                style={{ background: c, borderRadius: "var(--radius-full)" }} data-chip={c} />
                            ))}
                          </HStack>
                          {part === 'box' && (
                            <VStack gap={3}>
                              <Slider label="크기(병 대비)" description="병 높이를 100% 로 본 상자의 긴 변" min={40} max={150} value={boxDim.scale}
                                onChange={(x) => resizeBox('scale', x)} formatValue={(x) => `${x}%`} valueDisplay="inline" isDisabled={!has.box} data-testid="box-scale" />
                              <Slider label="두께" description="앞면 가로를 100% 로 본 옆면 폭" min={10} max={100} value={boxDim.depth}
                                onChange={(x) => resizeBox('depth', x)} formatValue={(x) => `${x}%`} valueDisplay="inline" isDisabled={!has.box} data-testid="box-depth" />
                            </VStack>
                          )}
                        </VStack>
                      ) : (
                        <VStack gap={3}>
                          <SegmentedControl label="라벨" size="sm" layout="fill" value={labelSrc} onChange={chooseLabel}>
                            <SegmentedControlItem value="none" label="없음" />
                            <SegmentedControlItem value="sample" label="예시 라벨" />
                            <SegmentedControlItem value="file" label="내 이미지" />
                          </SegmentedControl>
                          <Slider label="높이" min={10} max={90} value={label.pos} onChange={(x) => moveLabel('pos', x)} formatValue={(x) => `${x}%`} valueDisplay="inline" />
                          <Slider label="크기" min={8} max={60} value={label.size} onChange={(x) => moveLabel('size', x)} formatValue={(x) => `${x}%`} valueDisplay="inline" />
                          <Slider label="감기" min={60} max={300} value={label.wrap} onChange={(x) => moveLabel('wrap', x)} formatValue={(x) => `${x}°`} valueDisplay="inline" />
                          {labelSrc === 'file' && (
                            <FileInput label="라벨 이미지" accept="image/*" placeholder="라벨 이미지 고르기" value={null}
                              onChange={(f) => labelFile(Array.isArray(f) ? f[0] : f)} />
                          )}
                        </VStack>
                      )}
                    </InspectorSection>
                    <InspectorSection title="세트">
                      <Text type="supporting">배경지</Text>
                      <HStack gap={1} data-testid="backdrops">
                        {Object.entries(BACKDROPS).map(([k, b]) => (
                          <SelectableCard key={k} label={b.name} padding={1} width="20%" isSelected={backdrop === k}
                            onChange={() => { setBackdrop(k); viewer.current.setSet({ backdrop: k }); }} data-backdrop={k}>
                            <VStack gap={1} hAlign="center">
                              <svg viewBox="0 0 1 1" width="100%" aria-hidden="true" style={{ borderRadius: 'var(--radius-element)', display: 'block' }}><rect width="1" height="1" fill={b.color} /></svg>
                              <Text type="supporting" size="xsm">{b.name}</Text>
                            </VStack>
                          </SelectableCard>
                        ))}
                      </HStack>
                      <Text type="supporting">받침</Text>
                      <SegmentedControl label="받침" size="sm" layout="fill" value={pedestal} onChange={(k) => { setPedestal(k); viewer.current.setSet({ pedestal: k }); }}>
                        {Object.entries(PEDESTALS).map(([k, n]) => <SegmentedControlItem key={k} value={k} label={n} />)}
                      </SegmentedControl>
                      {has.bottle && has.box && (
                        <Slider label="병과 상자 간격" min={0} max={150} value={gap} data-testid="gap"
                          onChange={(x) => { setGap(x); viewer.current.setGap(x / 100); }} formatValue={(x) => `${x}`} valueDisplay="inline" />
                      )}
                    </InspectorSection>
                    <InspectorSection title="연출 컷">
                      <Text type="supporting">지금 앵글·조명으로 캡처를 떠서 내 PC 의 Codex 에 넘기면, 구도는 그대로 두고 광고 사진으로 만들어 줘요(1분 남짓)</Text>
                      <Selector label="장면" size="sm" options={SCENES.map((s) => ({ value: s.key, label: s.name }))} value={sceneKey}
                        onChange={(k) => { setSceneKey(k); setSceneText(SCENES.find((s) => s.key === k).text); }} data-testid="scene" />
                      <TextArea label="장면 설명" description="고쳐 써도 돼요. 앵글·조명 유지와 브랜드 금지는 앱이 알아서 붙여요"
                        value={sceneText} onChange={(v) => setSceneText(v)} data-testid="scene-text" />
                      {shot?.state === 'running' ? (
                        <VStack gap={2}>
                          <ProgressBar label={`Codex 가 만드는 중 · ${Math.round(shot.elapsed)}초`} isIndeterminate />
                          <Button variant="secondary" size="sm" label="취소" icon={<Icon icon={Square} size="sm" />} onClick={cancelShot} data-testid="shot-cancel" />
                        </VStack>
                      ) : (
                        <Button variant="primary" label="연출 컷 만들기" icon={<Icon icon={Clapperboard} size="sm" />}
                          isDisabled={!any || pending} onClick={makeShot} data-testid="shot" />
                      )}
                    </InspectorSection>
                    <InspectorSection title="조명">
                      <HStack hAlign="center">
                        <LightPad light={light} onChange={(l) => { setLightPreset(''); viewer.current.setLight(l); }} />
                      </HStack>
                      <SegmentedControl label="조명 프리셋" size="sm" layout="fill" value={lightPreset} onChange={(k) => {
                          setLightPreset(k); const { azimuth, elevation } = LIGHTS[k]; viewer.current.setLight({ azimuth, elevation });
                        }}>
                        {Object.entries(LIGHTS).map(([k, l]) => <SegmentedControlItem key={k} value={k} label={l.name} />)}
                      </SegmentedControl>
                      <Slider label="세기" min={0.4} max={4} step={0.1} value={light.intensity} onChange={(x) => viewer.current.setLight({ intensity: x })} formatValue={(x) => x.toFixed(1)} valueDisplay="inline" />
                    </InspectorSection>
                  </LayoutPanel>
                }
              />
            </LayoutContent>
          }
        />
      </Section>
    </Theme>
  );
}
