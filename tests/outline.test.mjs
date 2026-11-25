// 외곽선 따기 단위 시험: node --test tests/
// 사진 대신 모양을 아는 합성 이미지를 코드로 그려 넣고, 따낸 외곽선이 그린 모양과 맞는지 본다.
//
// protects: 사진 → 축·반지름·위아래 끝(3D 모양의 원재료)
// fails_when: 반지름이 5% 넘게 어긋남 / 흰 병처럼 배경과 차이 작은 몸통을 놓침 / 바닥 그림자를 병으로 잡음 /
//             배경과 밝기 같은 라벨 때문에 점이 축으로 튐 / 제품 없는 사진에서 엉뚱한 모양을 냄 / 3D 점 목록이 안 닫힘
//             병 말고 작은 얼룩이 있으면 그쪽을 잡음 / 한두 줄 튀는 폭을 그대로 반지름으로 씀 / 높이 없는 점 목록으로 거대한 모양을 만듦
// no_claim: 실제 사진 품질(예시 사진 2장은 e2e 와 눈으로 확인), 원근·기울어진 사진, 3D 렌더링 자체
import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze, toLathe } from '../src/outline.js';

const W = 400, H = 500;

// 병 하나 그리기. radius(t) 는 위(t=0)~아래(t=1) 반지름(px). 배경은 위아래 그라데이션.
function draw({ top = 80, bottom = 420, cx = 200, radius, body = [120, 60, 20], bg = 205, label = null, shadow = false, extra = null }) {
  const px = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    const g = bg + Math.round((y / H) * 6 - 3); // 은은한 그라데이션
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      let c = [g, g, g];
      if (shadow && y > bottom - 6 && y < bottom + 14) {
        const dx = (x - cx - 40) / 120, dy = (y - bottom - 3) / 9;
        const s = Math.max(0, 1 - dx * dx - dy * dy); // 가장자리가 흐린 타원 그림자
        c = c.map(v => v - Math.round(40 * s));
      }
      if (y >= top && y < bottom) {
        const t = (y - top) / (bottom - top), r = radius(t);
        const d = Math.abs(x + 0.5 - cx);
        if (d < r) {
          c = body;
          if (label && t > label.from && t < label.to) c = label.color;
        } else if (d < r + 1) {
          const a = r + 1 - d; // 경계 1px 안티앨리어싱
          c = c.map((v, k) => Math.round(v * (1 - a) + (label && t > label.from && t < label.to ? label.color : body)[k] * a));
        }
      }
      if (extra && extra(x, y)) c = body;
      px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 255;
    }
  }
  return px;
}

// 몸통 70px, 위 30% 는 목 30px(어깨 턱)
const bottle = (t) => (t < 0.3 ? 30 : 70);
const maxR = (p) => Math.max(...p.points.map(q => q.r)) * W;
// 외곽선 선분을 따라 높이 y(px)에서의 반지름(px)
function radiusAt(p, y) {
  const pts = [...p.points].sort((a, b) => a.y - b.y).map(q => [q.y * H, q.r * W]);
  for (let i = 0; i < pts.length - 1; i++) {
    const [y0, r0] = pts[i], [y1, r1] = pts[i + 1];
    if (y >= y0 && y <= y1) return y1 === y0 ? Math.max(r0, r1) : r0 + (r1 - r0) * (y - y0) / (y1 - y0);
  }
  return 0;
}

test('갈색 병: 축·최대 반지름·위아래 끝이 그린 대로', () => {
  const { profile } = analyze(draw({ radius: bottle }), W, H);
  assert.ok(profile);
  assert.ok(Math.abs(profile.axisX * W - 200) <= 2, `축 ${profile.axisX * W}`);
  assert.ok(Math.abs(maxR(profile) - 70) / 70 <= 0.05, `최대 반지름 ${maxR(profile)}`);
  assert.ok(Math.abs(profile.top * H - 80) <= 2, `위 ${profile.top * H}`);
  assert.ok(Math.abs(profile.bottom * H - 420) <= 2, `아래 ${profile.bottom * H}`);
});

test('어깨 턱(30→70px)이 점으로 살아 있다', () => {
  const { profile } = analyze(draw({ radius: bottle }), W, H);
  assert.ok(profile.points.length <= 24);
  const stepY = 80 + 0.3 * 340;
  const near = profile.points.filter(q => Math.abs(q.y * H - stepY) <= 4);
  assert.ok(near.some(q => q.r * W < 40) && near.some(q => q.r * W > 60), '턱 위아래 점이 있어야 함');
});

test('흰 병: 배경과 차이 14 인 몸통도 잡는다', () => {
  const { profile } = analyze(draw({ radius: bottle, body: [219, 219, 219], bg: 205 }), W, H);
  assert.ok(profile, '흰 병을 못 찾음');
  assert.ok(Math.abs(maxR(profile) - 70) / 70 <= 0.05, `최대 반지름 ${maxR(profile)}`);
});

test('바닥 그림자는 병으로 안 잡는다', () => {
  const { profile } = analyze(draw({ radius: bottle, shadow: true }), W, H);
  assert.ok(Math.abs(profile.bottom * H - 420) <= 3, `아래 ${profile.bottom * H}`);
  assert.ok(maxR(profile) <= 70 * 1.05, `그림자 폭이 섞임 ${maxR(profile)}`);
});

test('배경과 밝기가 같은 하늘색 라벨에서도 점이 축으로 튀지 않는다', () => {
  // 하늘색(181,207,224) 밝기 ≈ 201, 배경 205 와 거의 같다
  const { profile } = analyze(draw({ radius: bottle, body: [222, 222, 222], label: { from: 0.45, to: 0.75, color: [181, 207, 224] } }), W, H);
  for (let y = 80 + 0.35 * 340; y < 416; y += 3) {
    const r = radiusAt(profile, y);
    assert.ok(r > 70 * 0.9, `튐 y=${y.toFixed(0)} r=${r.toFixed(1)}`);
  }
});

test('제품이 없거나 화면을 다 덮으면 null 과 이유', () => {
  const empty = analyze(draw({ radius: () => 0 }), W, H);
  assert.equal(empty.profile, null);
  assert.equal(empty.reason, 'small');
  const full = new Uint8ClampedArray(W * H * 4);
  for (let p = 0; p < W * H; p++) {
    const edge = p % W < 16 || p % W >= W - 16;
    full.set(edge ? [200, 200, 200, 255] : [40, 40, 40, 255], p * 4);
  }
  assert.equal(analyze(full, W, H).reason, 'large');
});

test('3D 점 목록: 바닥·꼭대기가 축(r=0)으로 닫히고 높이는 3', () => {
  const { profile } = analyze(draw({ radius: bottle }), W, H);
  const { points } = toLathe(profile, W / H);
  assert.deepEqual(points[0], [0, 0]);
  assert.equal(points.at(-1)[0], 0);
  assert.ok(Math.abs(points.at(-1)[1] - 3) < 1e-9);
  for (let i = 1; i < points.length; i++) assert.ok(points[i][1] >= points[i - 1][1], '높이가 거꾸로 감');
  // 반지름/높이 비율이 사진 그대로(70px / 340px)
  const rMax = Math.max(...points.map(p => p[0]));
  assert.ok(Math.abs(rMax / 3 - 70 / 340) < 0.012, `비율 ${rMax / 3}`);
});

test('병 위쪽에 작은 얼룩이 있어도 가장 큰 덩어리(병)를 잡는다', () => {
  const dust = (x, y) => x >= 40 && x < 52 && y >= 20 && y < 32; // 병보다 먼저 훑어지는 12×12 얼룩
  const { profile } = analyze(draw({ radius: bottle, extra: dust }), W, H);
  assert.ok(Math.abs(profile.top * H - 80) <= 2, `위 ${profile.top * H}`);
  assert.ok(Math.abs(profile.axisX * W - 200) <= 2, `축 ${profile.axisX * W}`);
});

test('두 줄짜리 튀어나온 부분은 반지름으로 안 쓴다(5줄 중앙값)', () => {
  const bump = (x, y) => y >= 300 && y < 302 && x >= 270 && x < 300;
  const { profile } = analyze(draw({ radius: bottle, extra: bump }), W, H);
  assert.ok(maxR(profile) <= 70 * 1.05, `튄 폭이 섞임 ${maxR(profile)}`);
});

test('점이 한 높이에 몰리면 3D 점 목록을 만들지 않는다', () => {
  const flat = { axisX: 0.5, points: [{ y: 0.5, r: 0.1 }, { y: 0.5, r: 0.2 }, { y: 0.53, r: 0.05 }] };
  assert.equal(toLathe(flat, 0.8), null);
});

test('뚜껑 경계: 잘록한 목에서 자른다, 목이 없으면 위에서 15%', async () => {
  const { suggestCapSplit } = await import('../src/outline.js');
  // 위 25% 뚜껑(반지름 40) → 목(20) → 몸통(70)
  const capped = (t) => (t < 0.25 ? 40 : t < 0.32 ? 20 : 70);
  const { profile } = analyze(draw({ radius: capped }), W, H);
  const y = suggestCapSplit(profile) * H;
  assert.ok(y > 80 + 0.25 * 340 - 4 && y < 80 + 0.32 * 340 + 4, `경계 ${y.toFixed(0)}px`);
  const tube = { points: [{ y: 0.1, r: 0.2 }, { y: 0.5, r: 0.2 }, { y: 0.9, r: 0.2 }] };
  assert.ok(Math.abs(suggestCapSplit(tube) - (0.1 + 0.15 * 0.8)) < 1e-9);
});

test('뚜껑 경계: 스포이트 병은 고무 꼭지 밑이 아니라 칼라 밑 목에서 자른다', async () => {
  const { suggestCapSplit } = await import('../src/outline.js');
  // 고무 꼭지(30) → 꼭지 목(15, 가장 가늘다) → 칼라(60) → 유리 목(40) → 몸통(70)
  const dropper = (t) => (t < 0.1 ? 30 : t < 0.2 ? 15 : t < 0.3 ? 60 : t < 0.36 ? 40 : 70);
  const { profile } = analyze(draw({ radius: dropper }), W, H);
  const y = suggestCapSplit(profile) * H;
  assert.ok(y > 80 + 0.3 * 340 - 6 && y < 80 + 0.36 * 340, `경계 ${y.toFixed(0)}px (칼라 밑 ${80 + 0.3 * 340}px 근처여야)`);
});

test('상자: 앞면 사각형이 그린 대로(바닥 그림자 빼고), 옆면 색은 테두리 띠 색', async () => {
  const { boxFromImage, edgeColor } = await import('../src/outline.js');
  // 폭 120(반지름 60)·높이 340 의 갈색 사각형 + 가운데 흰 글자 띠 + 바닥 그림자
  const img = draw({ radius: () => 60, shadow: true, extra: (x, y) => false, label: { from: 0.45, to: 0.55, color: [250, 250, 250] } });
  const { rect } = boxFromImage(img, W, H);
  assert.ok(rect, '사각형을 못 찾음');
  assert.ok(Math.abs(rect.left * W - 140) <= 2 && Math.abs(rect.right * W - 260) <= 2, `좌우 ${rect.left * W} ${rect.right * W}`);
  assert.ok(Math.abs(rect.top * H - 80) <= 2 && Math.abs(rect.bottom * H - 420) <= 3, `위아래 ${rect.top * H} ${rect.bottom * H}`);
  assert.equal(edgeColor(img, W, H, rect), '#783c14', '글자 띠가 아니라 몸통 색(120,60,20)');
  const empty = boxFromImage(draw({ radius: () => 0 }), W, H);
  assert.equal(empty.rect, null);
});
