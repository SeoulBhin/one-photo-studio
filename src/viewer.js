// 3D 촬영 세트: 말려 올라간 배경지 위 받침에 병을 세우고, 조명 하나·환경 반사·마우스 앵글로 찍는다.
// 병은 뚜껑·몸통 두 덩어리 + 라벨 띠. 부위마다 재질·색을 따로 입힌다.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { toLathe } from './outline.js';

export const ASPECT = 4 / 5; // 화면과 저장 PNG 를 같은 비율로 묶어 보이는 그대로 저장한다
const HEIGHT = 3;            // 병 높이(3D 단위)
const INSET = 0.97;          // 사진을 입힐 때 가장자리 배경색을 물지 않게 축 쪽으로 살짝 당긴다

// 재질 견본. 이름은 화면에 그대로 나간다
export const FINISHES = {
  photo:   { name: '사진' },
  glass:   { name: '유리' },
  matte:   { name: '무광' },
  ceramic: { name: '유광' },
  metal:   { name: '금속' },
};

export const BACKDROPS = {
  paper: { name: '웜그레이', color: '#d9d5cd' },
  sage:  { name: '세이지', color: '#a9b4a0' },
  clay:  { name: '테라코타', color: '#c08a6e' },
  ink:   { name: '먹색', color: '#3b3a38' },
  cream: { name: '크림', color: '#efe6d4' },
};

export const PEDESTALS = { none: '없음', round: '원기둥', marble: '대리석', acrylic: '아크릴' };

// 카메라 자리는 병 가운데(받침 높이 포함)를 기준으로 한 거리
export const CAMERAS = {
  front: { name: '정면', pos: [0, 1.1, 10.8] },
  three: { name: '45°', pos: [6.4, 2.2, 8.0] },
  high:  { name: '내려다보기', pos: [3.0, 7.6, 7.0] },
};

export const LIGHTS = {
  key:   { name: '왼쪽 위', azimuth: -45, elevation: 45 },
  side:  { name: '옆', azimuth: 85, elevation: 18 },
  back:  { name: '역광', azimuth: 170, elevation: 30 },
  top:   { name: '머리 위', azimuth: 0, elevation: 82 },
};

export class Viewer {
  constructor(canvas, { onLost, onRestored, onView } = {}) {
    this.canvas = canvas;
    this.onView = onView;
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#d9d5cd');
    const pmrem = new THREE.PMREMGenerator(r);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

    this.camera = new THREE.PerspectiveCamera(30, ASPECT, 0.1, 100);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.minDistance = 4;
    this.controls.maxDistance = 18;
    this.controls.maxPolarAngle = Math.PI * 0.49; // 바닥 아래로는 못 내려가게
    this.controls.addEventListener('change', () => { this.requestRender(); this.emitView(); });

    // 배경지: 바닥에서 둥글게 말려 벽으로 올라가는 한 장
    this.backdrop = new THREE.Mesh(sweepGeometry(), new THREE.MeshStandardMaterial({ color: '#d9d5cd', roughness: 0.95, envMapIntensity: 0.35 }));
    this.backdrop.receiveShadow = true;
    this.scene.add(this.backdrop);

    this.hemi = new THREE.HemisphereLight('#ffffff', '#bdb8ae', 0.55);
    this.scene.add(this.hemi);
    this.key = new THREE.DirectionalLight('#fff7ee', 2.4);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    Object.assign(this.key.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5, near: 0.5, far: 30 });
    this.key.shadow.bias = -0.0004;
    this.key.shadow.radius = 4;
    this.key.target.position.set(0, HEIGHT / 3, 0);
    this.scene.add(this.key, this.key.target);
    // 조명 위치 표시(화면에서만, 저장할 땐 숨긴다)
    this.marker = new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 12), new THREE.MeshBasicMaterial({ color: '#f3c178' }));
    this.scene.add(this.marker);

    this.stand = new THREE.Group(); // 받침 + 병. 받침 높이만큼 병이 올라간다
    this.scene.add(this.stand);
    this.bottle = new THREE.Group();
    this.stand.add(this.bottle);
    this.pedestal = null;

    this.photoTex = null;
    this.labelTex = null;
    this.parts = {
      body: { finish: 'photo', color: '#e9e6df', mesh: null },
      cap: { finish: 'photo', color: '#2b2a28', mesh: null },
    };
    this.label = { on: false, y0: 0.45, y1: 0.7, width: 150, mesh: null };
    this.set = { backdrop: 'paper', pedestal: 'none' };
    this.light = { ...LIGHTS.key, intensity: 2.4 };
    this.shape = null;
    this.setCamera('three');
    this.applyLight();

    this.lost = false;
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.lost = true; onLost?.(); });
    canvas.addEventListener('webglcontextrestored', () => {
      this.lost = false;
      for (const t of [this.photoTex, this.labelTex]) if (t) t.needsUpdate = true;
      onRestored?.();
      this.requestRender();
    });
    this.resize();
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
    // 예열: 사진이 들어오기 전에 병에 쓸 재질(사진 입힌 재질 + 그림자)을 한 번 그려
    // 셰이더 컴파일을 미리 끝낸다. 첫 사진에서 3D 가 늦게 뜨던 것(헤드리스 3~4초)을 줄인다
    setTimeout(() => this.warmUp(), 0);
  }

  warmUp() {
    if (this.lost) return;
    const tex = new THREE.DataTexture(new Uint8Array([200, 200, 200, 255]), 1, 1);
    tex.needsUpdate = true;
    const mesh = new THREE.Mesh(new THREE.LatheGeometry([new THREE.Vector2(0, 0), new THREE.Vector2(0.5, 0), new THREE.Vector2(0.5, 1), new THREE.Vector2(0, 1)], 8), makeMaterial('photo', '#ffffff', tex));
    mesh.castShadow = mesh.receiveShadow = true;
    this.scene.add(mesh);
    this.renderer.render(this.scene, this.camera);
    this.scene.remove(mesh);
    mesh.geometry.dispose(); mesh.material.dispose(); tex.dispose();
    this.render();
  }

  resize() {
    const box = this.canvas.parentElement.getBoundingClientRect();
    let w = box.width, h = w / ASPECT;
    if (h > box.height) { h = box.height; w = h * ASPECT; }
    if (w < 10 || h < 10) return;
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.setSize(Math.floor(w), Math.floor(h), true);
    this.requestRender();
  }

  // profile: 사진 비율 좌표 외곽선, capY: 뚜껑 경계(사진 세로 비율), image: 사진, aspect: 사진 가로/세로
  // 모양을 만들 수 없으면(점이 한 높이에 몰림) false, 마지막 모양을 그대로 둔다
  setShape(profile, image, aspect, capY) {
    const lathe = toLathe(profile, aspect, HEIGHT);
    if (!lathe) return false;
    this.shape = { ...lathe, profile, aspect };
    if (image && image !== this.image) {
      this.image = image;
      this.photoTex?.dispose();
      this.photoTex = new THREE.Texture(image);
      this.photoTex.colorSpace = THREE.SRGBColorSpace;
      this.photoTex.anisotropy = 4;
      this.photoTex.needsUpdate = true;
    }
    // 뚜껑 경계를 3D 높이로. 범위 밖이면 뚜껑 없이 몸통 하나
    const ys = capY == null ? HEIGHT : (lathe.bottom - capY) * lathe.scale;
    const split = Math.min(HEIGHT, Math.max(0, ys));
    this.buildPart('body', slice(lathe.points, 0, split));
    this.buildPart('cap', split < HEIGHT - 0.02 ? slice(lathe.points, split, HEIGHT) : null);
    this.buildLabel();
    this.bottle.visible = true;
    this.placeStand();
    this.requestRender();
    return true;
  }

  buildPart(key, points) {
    const part = this.parts[key];
    if (part.mesh) { part.mesh.geometry.dispose(); this.bottle.remove(part.mesh); part.mesh = null; }
    if (!points) return;
    const geo = new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), 96);
    this.projectPhotoUV(geo);
    geo.computeVertexNormals();
    part.mesh = new THREE.Mesh(geo, makeMaterial(part.finish, part.color, this.photoTex));
    part.mesh.castShadow = true;
    part.mesh.receiveShadow = true;
    this.bottle.add(part.mesh);
  }

  // 사진 입히기용 UV: 정점을 정면에서 사진 위로 그대로 투영(뒷면은 앞면과 같은 곳을 받는다)
  projectPhotoUV(geo) {
    const { profile, aspect, scale, bottom } = this.shape;
    const pos = geo.attributes.position, uv = geo.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      const u = profile.axisX + (INSET * pos.getX(i)) / (aspect * scale);
      uv.setXY(i, u, 1 - (bottom - pos.getY(i) / scale));
    }
    uv.needsUpdate = true;
  }

  // 라벨 띠: 몸통 표면을 살짝 띄워 감싼다. y0·y1 은 병 높이 비율(0 = 바닥), width 는 감싸는 각도
  buildLabel() {
    const L = this.label;
    if (L.mesh) { L.mesh.geometry.dispose(); this.bottle.remove(L.mesh); L.mesh = null; }
    if (!L.on || !this.labelTex || !this.shape) return;
    const pts = this.shape.points, rows = 24, out = [];
    for (let k = 0; k <= rows; k++) {
      const y = HEIGHT * (L.y0 + (L.y1 - L.y0) * (k / rows));
      out.push(new THREE.Vector2(radiusAt(pts, y) * 1.006 + 0.002, y));
    }
    const phi = THREE.MathUtils.degToRad(L.width);
    // φ = 0 이 정면(+z). φ 가 커질수록 왼쪽(-x)에서 오른쪽(+x)으로 가서 라벨 그림이 뒤집히지 않는다
    const geo = new THREE.LatheGeometry(out, 64, -phi / 2, phi);
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ map: this.labelTex, roughness: 0.55, transparent: true, alphaTest: 0.02, side: THREE.DoubleSide, envMapIntensity: 0.6 });
    L.mesh = new THREE.Mesh(geo, mat);
    L.mesh.castShadow = false;
    L.mesh.receiveShadow = true;
    this.bottle.add(L.mesh);
  }

  setFinish(key, finish, color) {
    const part = this.parts[key];
    if (finish) part.finish = finish;
    if (color) part.color = color;
    if (part.mesh) {
      part.mesh.material.dispose();
      part.mesh.material = makeMaterial(part.finish, part.color, this.photoTex);
    }
    this.requestRender();
  }

  setLabel(patch) {
    if ('image' in patch) {
      this.labelTex?.dispose();
      this.labelTex = patch.image ? new THREE.Texture(patch.image) : null;
      if (this.labelTex) { this.labelTex.colorSpace = THREE.SRGBColorSpace; this.labelTex.anisotropy = 4; this.labelTex.needsUpdate = true; }
    }
    for (const k of ['on', 'y0', 'y1', 'width']) if (k in patch) this.label[k] = patch[k];
    this.buildLabel();
    this.requestRender();
  }

  setSet(patch) {
    Object.assign(this.set, patch);
    const c = BACKDROPS[this.set.backdrop].color;
    this.backdrop.material.color.set(c);
    this.scene.background.set(c);
    this.placeStand();
    this.requestRender();
  }

  // 받침을 병 크기에 맞춰 다시 만들고 병을 그 위에 세운다
  placeStand() {
    if (this.pedestal) { this.stand.remove(this.pedestal); this.pedestal.traverse(o => { o.geometry?.dispose(); o.material?.dispose?.(); }); this.pedestal = null; }
    const rMax = this.shape ? Math.max(...this.shape.points.map(p => p[0])) : 0.7;
    const kind = this.set.pedestal;
    let h = 0, mesh = null;
    if (kind === 'round') {
      h = 0.5;
      mesh = new THREE.Mesh(new THREE.CylinderGeometry(rMax * 1.9, rMax * 1.9, h, 96),
        new THREE.MeshStandardMaterial({ color: '#efece6', roughness: 0.8 }));
    } else if (kind === 'marble') {
      h = 0.22;
      mesh = new THREE.Mesh(new THREE.BoxGeometry(rMax * 5.2, h, rMax * 3.6),
        new THREE.MeshPhysicalMaterial({ map: marbleTexture(), roughness: 0.28, clearcoat: 0.6, clearcoatRoughness: 0.2 }));
    } else if (kind === 'acrylic') {
      h = 0.16;
      mesh = new THREE.Mesh(new THREE.CylinderGeometry(rMax * 2.3, rMax * 2.3, h, 96),
        new THREE.MeshPhysicalMaterial({ color: '#ffffff', transmission: 0.92, roughness: 0.08, thickness: 0.3, ior: 1.49 }));
    }
    if (mesh) {
      mesh.position.y = h / 2;
      mesh.castShadow = kind !== 'acrylic';
      mesh.receiveShadow = true;
      this.pedestal = mesh;
      this.stand.add(mesh);
    }
    // 받침 높이가 바뀐 만큼 카메라도 같이 올려 구도를 유지한다
    const dy = h - this.bottle.position.y;
    this.camera.position.y += dy;
    this.bottle.position.y = h;
    this.controls.target.set(0, h + HEIGHT / 2, 0);
    this.key.target.position.set(0, h + HEIGHT / 3, 0);
    this.controls.update();
  }

  setCamera(key) {
    const [x, y, z] = CAMERAS[key].pos, ty = (this.bottle?.position.y || 0) + HEIGHT / 2;
    this.controls.target.set(0, ty, 0);
    this.camera.position.set(x, ty + y, z);
    this.controls.update();
    this.requestRender();
    this.emitView();
  }

  // 지금 카메라가 보는 방향(위에서 본 방위·올려본 고도). 화면 아래 촬영 정보 줄에 쓴다
  view() {
    const v = this.camera.position.clone().sub(this.controls.target);
    const azimuth = Math.round(THREE.MathUtils.radToDeg(Math.atan2(v.x, v.z)));
    const elevation = Math.round(THREE.MathUtils.radToDeg(Math.asin(v.y / v.length())));
    return { azimuth, elevation, distance: +v.length().toFixed(1) };
  }

  emitView() { this.onView?.(this.view(), this.light); }

  // 외곽선을 못 땄을 때: 이전 병이 화면·저장에 남지 않게 숨긴다
  clear() {
    this.bottle.visible = false;
    this.shape = null;
    this.requestRender();
  }

  get ready() { return !!this.shape && this.bottle.visible; }

  // azimuth: 위에서 본 각도(0 = 정면, -90 = 왼쪽), elevation: 바닥에서 올려본 각도
  setLight(patch) {
    Object.assign(this.light, patch);
    this.applyLight();
  }

  applyLight() {
    const { azimuth, elevation, intensity } = this.light;
    const a = THREE.MathUtils.degToRad(azimuth), e = THREE.MathUtils.degToRad(elevation), R = 8;
    const p = new THREE.Vector3(R * Math.cos(e) * Math.sin(a), R * Math.sin(e) + HEIGHT / 3, R * Math.cos(e) * Math.cos(a));
    this.key.position.copy(p);
    this.key.intensity = intensity;
    this.marker.position.copy(p).multiplyScalar(0.5);
    this.requestRender();
    this.emitView();
  }

  requestRender() {
    if (this.pending) return;
    this.pending = true;
    requestAnimationFrame(() => { this.pending = false; this.render(); });
  }

  render() {
    if (this.lost) return;
    this.renderer.render(this.scene, this.camera);
  }

  // 재질 견본: 같은 렌더러로 작은 구를 그려 이미지로 뜬다(화면의 재질 버튼에 쓴다)
  swatch(finish, color, size = 88) {
    if (this.lost) return null;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#f1efea');
    scene.environment = this.scene.environment;
    const l = new THREE.DirectionalLight('#ffffff', 2.2); l.position.set(-2, 3, 3); scene.add(l, new THREE.HemisphereLight('#fff', '#bbb', 0.5));
    const geo = new THREE.SphereGeometry(1, 48, 32);
    // 유리 견본은 가벼운 반투명 재질로 흉내만 낸다. 진짜 유리(빛 통과) 셰이더는 처음 컴파일이
    // 소프트웨어 렌더링에서 2초 가까이 걸려 앱을 연 직후 화면이 멈췄다. 병에는 진짜 유리를 쓴다
    const mat = finish === 'glass'
      ? new THREE.MeshStandardMaterial({ color, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.45, envMapIntensity: 1.4 })
      : makeMaterial(finish, color, finish === 'photo' ? this.photoTex : null);
    if (finish === 'photo' && this.photoTex) {
      // 견본 구에는 사진 가운데를 감아 보인다
      mat.map = this.photoTex;
    }
    scene.add(new THREE.Mesh(geo, mat));
    if (finish === 'glass') { // 유리는 뒤가 비쳐야 유리로 보인다
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.35, 4, 0.35), new THREE.MeshStandardMaterial({ color: '#3b3a38' }));
      bar.position.set(0.6, 0, -1.6); scene.add(bar);
    }
    const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 20); cam.position.set(0, 0, 4.2);
    const size0 = new THREE.Vector2(); this.renderer.getSize(size0);
    const ratio = this.renderer.getPixelRatio();
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(size, size, false);
    // 그림자 기능은 켠 채로 둔다. 껐다 켜면 three.js 가 모든 셰이더를 다시 컴파일해서
    // 견본 하나에 2초 가까이 화면이 멈췄다(견본 장면엔 그림자 만드는 조명이 없어 켜 둬도 같다)
    this.renderer.render(scene, cam);
    const url = this.canvas.toDataURL('image/png');
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(size0.x, size0.y, true);
    geo.dispose(); mat.dispose();
    this.render();
    return url;
  }

  // 고른 크기로 한 번 그리고, 그 자리에서 바로 PNG 로 뜬다(그리고 나서 기다리면 내용이 사라질 수 있다)
  capture(width, height) {
    if (this.lost || !this.ready) return null;
    const size = new THREE.Vector2();
    this.renderer.getSize(size);
    const ratio = this.renderer.getPixelRatio();
    this.marker.visible = false;
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(width, height, false);
    this.renderer.render(this.scene, this.camera);
    // 그래픽 카드가 고른 크기를 못 잡으면(약한 GPU) 잘린 그림이 나오므로 저장하지 않는다
    const gl = this.renderer.getContext();
    const ok = gl.drawingBufferWidth === width && gl.drawingBufferHeight === height;
    const url = ok ? this.canvas.toDataURL('image/png') : null;
    this.marker.visible = true;
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(size.x, size.y, true);
    this.render();
    return url;
  }
}

function makeMaterial(finish, color, photoTex) {
  const c = new THREE.Color(color);
  switch (finish) {
    case 'photo':
      return photoTex
        ? new THREE.MeshStandardMaterial({ map: photoTex, roughness: 0.55, envMapIntensity: 0.5 })
        : new THREE.MeshStandardMaterial({ color: c, roughness: 0.55 });
    case 'glass':
      return new THREE.MeshPhysicalMaterial({
        color: '#ffffff', transmission: 1, roughness: 0.02, thickness: 0.18, ior: 1.5,
        attenuationColor: c, attenuationDistance: 0.6, envMapIntensity: 1.4, specularIntensity: 1, clearcoat: 1, clearcoatRoughness: 0.02,
      });
    case 'matte':
      return new THREE.MeshStandardMaterial({ color: c, roughness: 0.78, envMapIntensity: 0.6 });
    case 'ceramic':
      return new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.06, envMapIntensity: 1 });
    case 'metal':
      return new THREE.MeshStandardMaterial({ color: c, metalness: 1, roughness: 0.3, envMapIntensity: 1.1 });
    default:
      return new THREE.MeshStandardMaterial({ color: c });
  }
}

// [r, y] 점 목록에서 높이 y 의 반지름(선형 보간)
function radiusAt(pts, y) {
  for (let i = 0; i < pts.length - 1; i++) {
    const [r0, y0] = pts[i], [r1, y1] = pts[i + 1];
    if (y >= y0 && y <= y1 && y1 > y0) return r0 + (r1 - r0) * (y - y0) / (y1 - y0);
  }
  return Math.max(...pts.map(p => p[0])) * 0.5;
}

// 높이 lo~hi 구간만 잘라 축으로 닫은 점 목록
function slice(pts, lo, hi) {
  const inner = pts.filter(([r, y]) => y > lo && y < hi && r > 0);
  const out = [[0, lo], [radiusAt(pts, lo + 1e-6), lo], ...inner, [radiusAt(pts, hi - 1e-6), hi], [0, hi]];
  return out.filter((p, i) => i === 0 || p[0] !== out[i - 1][0] || p[1] !== out[i - 1][1]);
}

// 배경지: 앞쪽 바닥(z=+7) → 뒤(z=-2.5)에서 반지름 3 으로 말려 → 벽(높이 12)
function sweepGeometry(width = 30, front = 7, back = -2.5, radius = 3, height = 12) {
  const prof = [];
  for (let k = 0; k <= 8; k++) prof.push([front - (front - back) * (k / 8), 0]);
  for (let k = 1; k <= 24; k++) {
    const t = (k / 24) * (Math.PI / 2);
    prof.push([back - Math.sin(t) * radius, radius - Math.cos(t) * radius]);
  }
  for (let k = 1; k <= 6; k++) prof.push([back - radius, radius + (height - radius) * (k / 6)]);
  const cols = 2, pos = [], idx = [];
  for (const [z, y] of prof) for (let c = 0; c <= cols; c++) pos.push(-width / 2 + (width * c) / cols, y, z);
  for (let i = 0; i < prof.length - 1; i++) for (let c = 0; c < cols; c++) {
    const a = i * (cols + 1) + c, b = a + 1, d = a + cols + 1, e = d + 1;
    idx.push(a, b, d, b, e, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// 대리석 판 무늬: 회색 결을 몇 줄 그린 캔버스(외부 이미지 없음)
let marbleCache = null;
function marbleTexture() {
  if (marbleCache) return marbleCache;
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#ecebe7'; g.fillRect(0, 0, 512, 512);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < 14; k++) {
    g.strokeStyle = `rgba(120,118,112,${0.08 + rnd() * 0.18})`;
    g.lineWidth = 0.6 + rnd() * 2.2;
    g.beginPath();
    let x = rnd() * 512, y = -10;
    g.moveTo(x, y);
    while (y < 530) { x += (rnd() - 0.45) * 26; y += 10 + rnd() * 18; g.lineTo(x, y); }
    g.stroke();
  }
  marbleCache = new THREE.CanvasTexture(c);
  marbleCache.colorSpace = THREE.SRGBColorSpace;
  return marbleCache;
}
