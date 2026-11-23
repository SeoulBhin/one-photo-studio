// 3D 화면: 외곽선을 한 바퀴 돌린 병, 바닥 그림자, 조명 하나, 마우스 앵글, PNG 저장
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/OrbitControls.js';
import { toLathe } from './outline.js';

export const ASPECT = 4 / 5; // 화면과 저장 PNG 를 같은 비율로 묶어 보이는 그대로 저장한다
const HEIGHT = 3;            // 병 높이(3D 단위)
const INSET = 0.97;          // 사진을 입힐 때 가장자리 배경색을 물지 않게 축 쪽으로 살짝 당긴다

export class Viewer {
  constructor(canvas, { onLost } = {}) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#eeece6');
    this.camera = new THREE.PerspectiveCamera(30, ASPECT, 0.1, 100);
    this.camera.position.set(2.6, 3.1, 8.2);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(0, HEIGHT / 2, 0);
    this.controls.enableDamping = false;
    this.controls.minDistance = 4;
    this.controls.maxDistance = 20;
    this.controls.maxPolarAngle = Math.PI * 0.49; // 바닥 아래로는 못 내려가게
    this.controls.addEventListener('change', () => this.requestRender());
    this.controls.update();

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.ShadowMaterial({ opacity: 0.22 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    this.hemi = new THREE.HemisphereLight('#ffffff', '#cfcdc6', 0.9);
    this.scene.add(this.hemi);
    this.key = new THREE.DirectionalLight('#ffffff', 2.2);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(4096, 4096);
    Object.assign(this.key.shadow.camera, { left: -11, right: 11, top: 11, bottom: -11, near: 0.5, far: 40 });
    this.key.shadow.bias = -0.0005;
    this.key.target.position.set(0, HEIGHT / 3, 0);
    this.scene.add(this.key, this.key.target);
    // 조명 위치 표시(화면에서만, 저장할 땐 숨긴다)
    this.marker = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 12), new THREE.MeshBasicMaterial({ color: '#f2a33a' }));
    this.scene.add(this.marker);

    this.material = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.55, side: THREE.DoubleSide });
    this.mesh = null;
    this.texture = null;
    this.surface = 'photo';
    this.solidColor = '#e9e6df';
    this.light = { azimuth: -40, elevation: 50, intensity: 2.2 };
    this.applyLight();

    this.lost = false;
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.lost = true; onLost?.(); });
    this.resize();
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
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

  // profile: 사진 비율 좌표 외곽선, image: 사진(HTMLImageElement·Canvas), aspect: 사진 가로/세로
  setShape(profile, image, aspect) {
    const { points, scale, bottom } = toLathe(profile, aspect, HEIGHT);
    const geo = new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), 96);
    // 사진 입히기용 UV: 정점을 정면에서 사진 위로 그대로 투영(뒷면은 앞면과 같은 곳을 받는다)
    const pos = geo.attributes.position, uv = geo.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i);
      const u = profile.axisX + (INSET * x) / (aspect * scale);
      const imgY = bottom - y / scale;
      uv.setXY(i, u, 1 - imgY);
    }
    uv.needsUpdate = true;
    geo.computeVertexNormals();
    if (this.mesh) { this.mesh.geometry.dispose(); this.mesh.geometry = geo; }
    else {
      this.mesh = new THREE.Mesh(geo, this.material);
      this.mesh.castShadow = true;
      this.scene.add(this.mesh);
    }
    if (image && image !== this.image) {
      this.image = image;
      this.texture?.dispose();
      this.texture = new THREE.Texture(image);
      this.texture.colorSpace = THREE.SRGBColorSpace;
      this.texture.anisotropy = 4;
      this.texture.needsUpdate = true;
    }
    this.applySurface();
  }

  setSurface(kind, color) {
    this.surface = kind;
    if (color) this.solidColor = color;
    this.applySurface();
  }

  applySurface() {
    const photo = this.surface === 'photo' && this.texture;
    this.material.map = photo ? this.texture : null;
    this.material.color.set(photo ? '#ffffff' : this.solidColor);
    this.material.roughness = photo ? 0.6 : 0.45;
    this.material.needsUpdate = true;
    this.requestRender();
  }

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
    this.marker.position.copy(p).multiplyScalar(0.55);
    this.requestRender();
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

  // 고른 크기로 한 번 그리고, 그 자리에서 바로 PNG 로 뜬다(그리고 나서 기다리면 내용이 사라질 수 있다)
  capture(width, height) {
    const size = new THREE.Vector2();
    this.renderer.getSize(size);
    const ratio = this.renderer.getPixelRatio();
    this.marker.visible = false;
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(width, height, false);
    this.renderer.render(this.scene, this.camera);
    const url = this.canvas.toDataURL('image/png');
    this.marker.visible = true;
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(size.x, size.y, true);
    this.render();
    return url;
  }
}
