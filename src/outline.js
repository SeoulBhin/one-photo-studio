// 사진에서 병 외곽선을 따는 순수 함수들(DOM 없음 — node --test 로 시험한다)
// 좌표는 모두 원본 사진 기준 비율(0~1)로 돌려준다. 분석 해상도가 바뀌어도 결과 단위는 같다.
//
// 흐름: 줄마다 배경색 → 배경과 다른 픽셀(약한 기준으로 넓게, 강한 픽셀에 붙은 덩어리만)
//      → 줄마다 바깥에서 안쪽으로 훑어 "선명한 경계"가 처음 나오는 곳 = 병 가장자리
//      → 축·반지름 → 꺾이는 곳을 살려 점 N개
// 선명한 경계를 따로 보는 이유: 흰 병 + 밝은 회색 배경은 색 차이가 14 정도라 기준을 낮춰야 잡히는데,
// 낮추면 바닥 그림자까지 붙는다. 그림자는 가장자리가 흐릿하고 병은 또렷해서 경계로 가를 수 있다.

export const ANALYSIS_MAX = 800; // 분석은 긴 변 800px 사본에서(큰 사진도 빠르게)
export const DEFAULT_TOL = 22;   // 이보다 배경과 다르면 "확실히 제품"
export const DEFAULT_POINTS = 24;
const EDGE_MIN = 6;              // 좌우 이웃 밝기 차이가 이 이상이면 선명한 경계

// 줄마다 배경색: 왼쪽·오른쪽 가장자리 4% 픽셀의 중앙값(위아래 그라데이션 배경 대응)
// 함께 배경 잡음 크기(가장자리 픽셀이 그 줄 배경색에서 벗어난 정도의 중앙값)도 돌려준다.
export function rowBackgrounds(rgba, w, h) {
  const m = Math.max(2, Math.round(w * 0.04));
  const bg = new Uint8Array(h * 3);
  const vals = [[], [], []];
  const devs = [];
  for (let y = 0; y < h; y++) {
    for (const v of vals) v.length = 0;
    for (let x = 0; x < w; x++) {
      if (x >= m && x < w - m) continue;
      const i = (y * w + x) * 4;
      vals[0].push(rgba[i]); vals[1].push(rgba[i + 1]); vals[2].push(rgba[i + 2]);
    }
    for (let c = 0; c < 3; c++) bg[y * 3 + c] = median(vals[c]);
    if (y % 4 === 0) for (let k = 0; k < vals[0].length; k += 3) {
      devs.push(Math.max(...[0, 1, 2].map(c => Math.abs(vals[c][k] - bg[y * 3 + c]))));
    }
  }
  return { bg, noise: median(devs) };
}

function colorDiff(rgba, w, bg) {
  const n = rgba.length / 4, d = new Uint8Array(n);
  for (let p = 0; p < n; p++) {
    const y = (p / w) | 0, i = p * 4;
    d[p] = Math.max(Math.abs(rgba[i] - bg[y * 3]), Math.abs(rgba[i + 1] - bg[y * 3 + 1]), Math.abs(rgba[i + 2] - bg[y * 3 + 2]));
  }
  return d;
}

// 전경 마스크: 배경과 low 넘게 다른 픽셀 중, high 넘는 픽셀을 품은 덩어리에서 가장 큰 것
export function foregroundMask(diff, w, h, low, high) {
  const label = new Int32Array(w * h);
  const queue = new Int32Array(w * h);
  let best = 0, bestSize = 0, next = 0;
  for (let s = 0; s < w * h; s++) {
    if (diff[s] <= high || label[s]) continue; // 강한 픽셀에서만 키우기 시작
    next++;
    let head = 0, tail = 0;
    queue[tail++] = s; label[s] = next;
    while (head < tail) {
      const p = queue[head++];
      const x = p % w;
      for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w]) {
        if (q < 0 || q >= w * h || diff[q] <= low || label[q]) continue;
        label[q] = next; queue[tail++] = q;
      }
    }
    if (tail > bestSize) { bestSize = tail; best = next; }
  }
  const mask = new Uint8Array(w * h);
  if (best) for (let p = 0; p < w * h; p++) if (label[p] === best) mask[p] = 1;
  return mask;
}


// 줄마다 [왼끝, 오른끝]: 마스크 바깥 끝에서 안쪽으로 가며 처음 만나는 선명한 경계.
// 경계가 없는 줄(그림자만 있는 줄)은 빠진다. 가장 긴 연속 구간(틈 3줄까지 허용)만 남긴다.
// 경계는 밝기 대신 R·G·B 중 가장 크게 바뀐 채널로 본다(하늘색 라벨은 밝기가 배경과 거의 같다).
export function silhouetteRows(mask, rgba, w, h, edgeMin = EDGE_MIN) {
  const sharp = (y, x) => {
    if (x <= 0 || x >= w - 1) return false;
    const i = (y * w + x - 1) * 4, j = i + 8;
    return Math.max(Math.abs(rgba[i] - rgba[j]), Math.abs(rgba[i + 1] - rgba[j + 1]), Math.abs(rgba[i + 2] - rgba[j + 2])) >= edgeMin;
  };
  const rows = [];
  for (let y = 0; y < h; y++) {
    let l = -1, r = -1;
    for (let x = 0; x < w; x++) if (mask[y * w + x]) { l = x; break; }
    if (l < 0) continue;
    for (let x = w - 1; x >= 0; x--) if (mask[y * w + x]) { r = x; break; }
    // 마스크 끝 바로 바깥 2px 도 본다(경계 픽셀이 약한 기준에 막 걸치지 못한 경우)
    let a = -1, b = -1;
    for (let x = Math.max(1, l - 2); x <= r; x++) if (sharp(y, x)) { a = x; break; }
    for (let x = Math.min(w - 2, r + 2); x >= l; x--) if (sharp(y, x)) { b = x; break; }
    if (a < 0 || b <= a) continue;
    rows.push({ y, l: a, r: b });
  }
  // 가장 긴 연속 구간
  let best = [0, 0], start = 0;
  for (let i = 1; i <= rows.length; i++) {
    if (i === rows.length || rows[i].y - rows[i - 1].y > 4) {
      if (i - start > best[1] - best[0]) best = [start, i];
      start = i;
    }
  }
  return rows.slice(best[0], best[1]);
}

// 줄 목록 → 외곽선. 축 = 줄 가운데의 중앙값, 반지름 = 줄 폭 절반(5줄 중앙값으로 튀는 줄 거름).
// 점은 꺾이는 곳(어깨·뚜껑 턱)을 살리도록 Douglas-Peucker 로 maxPoints 개 이하만 남긴다.
export function profileFromRows(rows, w, h, maxPoints = DEFAULT_POINTS) {
  if (rows.length < 8) return null;
  const axisPx = median(rows.map(o => (o.l + o.r + 1) / 2));
  const half = rows.map(o => (o.r - o.l + 1) / 2);
  const smooth = half.map((_, i) => median(half.slice(Math.max(0, i - 2), i + 3)));
  const curve = rows.map((o, i) => ({ y: o.y, r: smooth[i] }));
  let eps = 0.5, pts = curve;
  for (let k = 0; k < 60; k++) {
    pts = simplify(curve, eps);
    if (pts.length <= maxPoints) break;
    eps *= 1.3;
  }
  return {
    axisX: axisPx / w,
    top: rows[0].y / h,
    bottom: (rows[rows.length - 1].y + 1) / h,
    points: pts.map(p => ({ y: (p.y + 0.5) / h, r: p.r / w })),
  };
}

function simplify(pts, eps) {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let far = -1, dmax = eps;
    const A = pts[a], B = pts[b];
    const dy = B.y - A.y, dr = B.r - A.r, len = Math.hypot(dy, dr) || 1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs(dr * (pts[i].y - A.y) - dy * (pts[i].r - A.r)) / len;
      if (d > dmax) { dmax = d; far = i; }
    }
    if (far > 0) { keep[far] = 1; stack.push([a, far], [far, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

// 사진 한 장(RGBA, 분석 크기)에서 외곽선까지. 브라우저·노드 공통 진입점.
// 실패(제품이 너무 작거나 화면을 거의 다 덮음, 경계를 못 찾음)면 profile = null 과 이유.
export function analyze(rgba, w, h, { tol = DEFAULT_TOL, maxPoints = DEFAULT_POINTS } = {}) {
  const { bg, noise } = rowBackgrounds(rgba, w, h);
  const low = Math.min(tol - 1, Math.max(6, Math.round(noise * 4) + 2));
  const diff = colorDiff(rgba, w, bg);
  let mask = foregroundMask(diff, w, h, low, tol);
  let frac = areaOf(mask);
  // 라벨·뚜껑 없는 흰 병처럼 "확실히 다른" 픽셀이 없으면 기준을 낮춰 한 번 더
  if (frac < 0.02 && tol > low + 4) {
    mask = foregroundMask(diff, w, h, low, low + 4);
    frac = areaOf(mask);
  }
  if (frac < 0.02) return { profile: null, mask, reason: 'small' };
  if (frac > 0.9) return { profile: null, mask, reason: 'large' };
  const rows = silhouetteRows(mask, rgba, w, h);
  const profile = profileFromRows(rows, w, h, maxPoints);
  return { profile, mask, rows, low, reason: profile ? null : 'edge' };
}

function areaOf(mask) {
  let a = 0;
  for (let p = 0; p < mask.length; p++) a += mask[p];
  return a / mask.length;
}

export function analysisSize(w, h) {
  const k = Math.min(1, ANALYSIS_MAX / Math.max(w, h));
  return [Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))];
}

// 외곽선(비율) → LatheGeometry 용 [r, y] 목록. 높이를 height 단위로 맞추고 바닥·꼭대기를 축으로 닫는다.
// aspect = 사진 가로/세로. scale = 사진 세로 비율 1 이 3D 몇 단위인지(텍스처 투영에도 쓴다).
// 위·아래 끝은 점에서 다시 잰다(편집기에서 맨 아래 점을 끌어내리면 병이 그만큼 길어진다).
export function toLathe(profile, aspect, height = 3) {
  const ys = profile.points.map(p => p.y);
  const top = Math.min(...ys), bottom = Math.max(...ys);
  const scale = height / Math.max(1e-6, bottom - top);
  const pts = profile.points
    .map(p => [Math.max(0.001, p.r * aspect * scale), (bottom - p.y) * scale])
    .sort((a, b) => a[1] - b[1]);
  const raw = [[0, 0], [pts[0][0], 0], ...pts, [pts[pts.length - 1][0], height], [0, height]];
  const points = raw.filter((p, i) => i === 0 || p[0] !== raw[i - 1][0] || p[1] !== raw[i - 1][1]);
  return { points, scale, bottom };
}

function median(a) {
  if (!a.length) return 0;
  const s = Float64Array.from(a).sort();
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
