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
import { Aperture, Download, RotateCcw } from 'lucide-react';
import { studioTheme } from './theme.js';
import { analyze, analysisSize, suggestCapSplit, DEFAULT_TOL } from './outline.js';
import { Editor } from './editor.js';
import { Viewer, FINISHES, BACKDROPS, PEDESTALS, CAMERAS, LIGHTS } from './viewer.js';
import { LightPad } from './LightPad.jsx';
import { resolveColor } from './tokens.js';

const SAMPLES = [
  { src: '/samples/bottle_amber.png', name: '갈색 앰플' },
  { src: '/samples/bottle_white.png', name: '흰 로션병' },
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
  const loadSeq = useRef(0);

  const [status, setStatus] = useState({ text: '제품 사진을 넣으면 시작해요', bad: false });
  const [loaded, setLoaded] = useState(false);
  const [meta, setMeta] = useState('');
  const [tol, setTol] = useState(DEFAULT_TOL);
  const [part, setPart] = useState('body');
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

  const say = (text, bad = false) => setStatus({ text, bad });
  const font = () => getComputedStyle(document.body).fontFamily || 'sans-serif';

  // 테마 토큰 → 캔버스 색(편집기 선·라벨 표시)
  const tokenColors = () => {
    const el = editCanvas.current;
    return { ink: resolveColor(el, '--color-text-primary', 'black'), accent: resolveColor(el, '--color-accent', 'firebrick'), shade: 'rgba(255,255,255,0.55)', font: font() };
  };

  const showMeta = (ms) => {
    const p = S.profile;
    setMeta(p ? `점 ${p.points.length} · 축 ${(p.axisX * 100).toFixed(1)}%` + (ms != null ? ` · 분석 ${ms}ms` : '') : '');
  };

  // 재질 견본: 같은 렌더러로 작은 구를 그린다. 한꺼번에 그리면 화면이 몇 초 멈춰서(소프트웨어 렌더링에서 약 3초)
  // 하나씩 쉬어 가며 그린다. 새로 요청이 오면 앞의 줄은 버린다
  const swatchJob = useRef(0), swatchesDone = useRef(false);
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
    });
    e.setColors(tokenColors());
    // 재질 견본은 첫 사진이 들어온 뒤에 그린다. 견본을 이미지로 뜨는 순간 밀린 그래픽 작업을 다 기다리는데,
    // 앱을 연 직후엔 셰이더 컴파일이 밀려 있어 화면이 2초 가까이 멈췄다(그동안 사진을 넣어도 못 받음)
    v.emitView();
    window.studio = { state: S, viewer: v, editor: e };
    // 끌어다 놓기
    const over = (ev) => ev.preventDefault();
    const drop = (ev) => { ev.preventDefault(); loadFile(ev.dataTransfer.files[0]); };
    document.addEventListener('dragover', over);
    document.addEventListener('drop', drop);
    return () => { document.removeEventListener('dragover', over); document.removeEventListener('drop', drop); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadFile(file) {
    if (!file) return;
    const url = URL.createObjectURL(file);
    try { await loadImage(url, file.name); } finally { URL.revokeObjectURL(url); }
  }

  async function loadImage(src, name) {
    const token = ++loadSeq.current;
    const img = new Image();
    img.src = src;
    try { await img.decode(); } catch {
      if (token === loadSeq.current) say('이미지를 열 수 없어요. PNG·JPG 사진을 넣어 주세요', true);
      return;
    }
    if (token !== loadSeq.current) return;
    const iw = img.naturalWidth, ih = img.naturalHeight;
    if (!iw || !ih || Math.max(iw, ih) > 16000 || Math.max(iw / ih, ih / iw) > 10) {
      say('이 사진은 크기나 비율이 너무 커서 열지 않았어요(16000px, 가로세로 10배 안쪽)', true);
      return;
    }
    const k = Math.min(1, 2048 / Math.max(iw, ih));
    const tex = document.createElement('canvas');
    tex.width = Math.max(1, Math.round(iw * k)); tex.height = Math.max(1, Math.round(ih * k));
    tex.getContext('2d').drawImage(img, 0, 0, tex.width, tex.height);
    Object.assign(S, { image: tex, source: img, aspect: iw / ih, name });
    setLoaded(true);
    // 편집기 캔버스가 보이고 크기가 잡힌 다음 따기
    requestAnimationFrame(() => extract());
  }

  function extract(t = tol) {
    if (!S.source) return;
    const v = viewer.current, e = editor.current;
    const t0 = performance.now();
    const [w, h] = analysisSize(S.source.naturalWidth, S.source.naturalHeight);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(S.source, 0, 0, w, h);
    const res = analyze(g.getImageData(0, 0, w, h).data, w, h, { tol: t });
    const ms = Math.round(performance.now() - t0);
    if (!res.profile) {
      S.profile = null;
      v.clear();
      e.set(S.image, null);
      say(REASONS[res.reason] || REASONS.edge, true);
      showMeta();
      return;
    }
    S.profile = res.profile;
    S.capY = suggestCapSplit(res.profile);
    e.set(S.image, res.profile, S.capY);
    v.setShape(res.profile, S.image, S.aspect, S.capY);
    e.setLabel(v.label.on ? v.label : null);
    showMeta(ms);
    say(`${S.name} · 외곽선을 땄어요. 어긋난 곳은 점을 끌어서 고치세요`);
    // 처음이면 견본 다섯 개를, 아니면 '사진' 견본만 다시 그린다(나머지는 색에만 달렸다). 3D 가 먼저 뜨게 한 박자 뒤에
    if (!swatchesDone.current) { swatchesDone.current = true; renderSwatches(part, v.parts[part === 'label' ? 'body' : part].color); }
    else requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(() => setSwatches((sw) => ({ ...sw, photo: v.swatch('photo', '#ffffff') })), 250)));
  }

  // ── 겉면
  const curPart = part === 'label' ? null : parts[part];
  function chooseFinish(finish) {
    viewer.current.setFinish(part, finish);
    setParts((ps) => ({ ...ps, [part]: { ...ps[part], finish } }));
  }
  function chooseColor(color) {
    const p = viewer.current.parts[part];
    const finish = p.finish === 'photo' ? 'matte' : p.finish; // 사진 상태에서 색을 고르면 색이 보이는 무광으로
    viewer.current.setFinish(part, finish, color);
    setParts((ps) => ({ ...ps, [part]: { finish, color } }));
    renderSwatches(part, color);
  }
  function choosePart(next) {
    setPart(next);
    if (next !== 'label') renderSwatches(next, viewer.current.parts[next].color);
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
  function save() {
    if (!S.profile) { say('먼저 사진을 넣어 주세요', true); return; }
    const [w, h] = size.split('x').map(Number);
    const url = viewer.current.capture(w, h);
    if (!url) { say('저장하지 못했어요. 3D 화면이 멈췄거나 이 크기를 그래픽 카드가 못 그려요. 작은 크기로 해 보세요', true); return; }
    const a = document.createElement('a');
    const t = new Date(), p = (n) => String(n).padStart(2, '0');
    a.download = `studio_${t.getFullYear()}${p(t.getMonth() + 1)}${p(t.getDate())}_${p(t.getHours())}${p(t.getMinutes())}${p(t.getSeconds())}.png`;
    a.href = url;
    document.body.appendChild(a); a.click(); a.remove();
    say(`${w}×${h} PNG 로 저장했어요`);
  }

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
                      <HStack gap={2} vAlign="center" hAlign="between">
                        <HStack gap={1}>
                          {SAMPLES.map((s) => (
                            <Thumbnail key={s.src} src={s.src} alt={s.name} label={`예시: ${s.name}`} onClick={() => loadImage(s.src, s.src.split('/').pop())} />
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
                              description="정면에서 찍은, 배경이 단색인 병 사진. 위 예시를 눌러도 돼요"
                              value={null} onChange={(f) => loadFile(Array.isArray(f) ? f[0] : f)} data-testid="file" />
                          )}
                        </AspectRatio>
                      </Card>
                      <Text type="supporting">점을 끌어 옮기고, 선 위 더블클릭으로 추가, 우클릭으로 지워요. "뚜껑" 이름표가 붙은 가로선을 위아래로 끌면 뚜껑 경계가 옮겨져요</Text>
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
                            <VStack height="100%" width="100%" hAlign="center" vAlign="center">
                              <canvas ref={viewCanvas} style={{ boxShadow: 'var(--shadow-high)', borderRadius: 'var(--radius-container)' }} />
                            </VStack>
                          </LayoutContent>
                        }
                        footer={
                          <LayoutFooter padding={2}>
                            <Toolbar
                              label="앵글"
                              size="sm"
                              startContent={
                                <SegmentedControl label="앵글" size="sm" value={cam} onChange={(k) => { setCam(k); viewer.current.setCamera(k); }}>
                                  {Object.entries(CAMERAS).map(([k, c]) => <SegmentedControlItem key={k} value={k} label={c.name} />)}
                                </SegmentedControl>
                              }
                              endContent={
                                <Text type="code" color="secondary" hasTabularNumbers data-testid="readout">
                                  {`카메라 ${view.azimuth}°/${view.elevation}° · 조명 ${Math.round(light.azimuth)}°/${Math.round(light.elevation)}° · ${W}×${H}`}
                                </Text>
                              }
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
                      </TabList>
                      {curPart ? (
                        <VStack gap={3}>
                          <HStack gap={1} data-testid="finishes">
                            {Object.entries(FINISHES).map(([k, f]) => (
                              <SelectableCard key={k} label={f.name} padding={1} width="20%" isSelected={curPart.finish === k}
                                isDisabled={k === 'photo' && !loaded} onChange={() => chooseFinish(k)} data-finish={k}>
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
