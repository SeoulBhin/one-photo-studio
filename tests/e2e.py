"""한 장 스튜디오 e2e: python tests/e2e.py   (먼저 npm run build 로 dist/ 를 만들고, 헤드리스 크로미움, 서버는 시험이 직접 띄운다)

protects: 사진 넣기 → 외곽선 → 3D → 점 편집 → 덧입히기(부위별 재질·색, 라벨, 받침, 배경지, 뚜껑 경계) → 조명 이동 → PNG 저장, 화면에서 사람이 하는 순서 그대로
fails_when: 3초 안에 외곽선·3D 가 안 뜸 / 점을 끌어도 3D 모양이 그대로 / 조명을 왼쪽↔오른쪽으로 옮겨도 그림자 쪽이 안 바뀜 /
            저장 PNG 크기가 고른 값과 다름·빈 화면 / 예시 사진 외곽선이 확인한 값에서 벗어남 / 실패 뒤 이전 병이 남음 / 조작 중 WebGL 이 죽음 / 외부 주소로 요청이 나감
no_claim: 보기 좋은지(저장 PNG 는 out/ 에 남겨 눈으로 본다), 실제 GPU 브라우저 동작(헤드리스는 소프트웨어 렌더링)
"""
import os
import socket
import tempfile
import subprocess
import sys
import time
from pathlib import Path

from PIL import Image
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
SAMPLE_DIR = ROOT / "public" / "samples"
OUT = ROOT / "out"
SAMPLES = ["bottle_amber.png", "bottle_white.png"]
# 예시 사진에서 따야 하는 외곽선(사진 비율). 2026-11-23 눈으로 맞는 걸 확인한 값, ±0.01
EXPECT = {
    "bottle_amber.png": {"axisX": 0.500, "top": 0.135, "bottom": 0.866},
    "bottle_white.png": {"axisX": 0.499, "top": 0.199, "bottom": 0.775},
}


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def blank_ratio(path):
    """배경(왼쪽 위 픽셀)과 눈에 띄게 다른 픽셀 비율"""
    raw = Image.open(path).convert("RGB").resize((216, 270)).tobytes()
    bg = raw[0:3]
    n = len(raw) // 3
    return sum(1 for i in range(n) if max(abs(raw[i * 3 + c] - bg[c]) for c in range(3)) > 12) / n


def shadow_x(on_path, off_path):
    """그림자 켠 캡처가 그림자 끈 캡처보다 어두운 픽셀(= 바닥 그림자만)의 가로 무게중심(0~1)"""
    w, h = 216, 270
    on = Image.open(on_path).convert("L").resize((w, h)).tobytes()
    off = Image.open(off_path).convert("L").resize((w, h)).tobytes()
    xs = [x for y in range(h) for x in range(w) if off[y * w + x] - on[y * w + x] > 10]
    return (sum(xs) / len(xs) / w if xs else None), len(xs)


FAILS = []

OK_TEXT = "() => document.querySelector('[data-testid=status]').textContent.includes('외곽선을 땄어요')"


def tab(page, name):
    """겉면 탭(몸통·뚜껑·라벨)"""
    page.locator("button", has_text=name).first.click()


def card(page, sel):
    """SelectableCard(재질·색·배경지): 사람처럼 보이는 카드 가운데를 누른다"""
    page.locator(sel).first.click()


def radio(page, name):
    """SegmentedControl 항목(라벨·받침·앵글·조명)"""
    page.get_by_role("radio", name=name, exact=True).click()


def pick_size(page, label):
    page.click("[data-testid=size]")
    page.get_by_role("option", name=label).click()


def put_file(page, path):
    """사진 넣기: 처음엔 끌어다 놓기 칸, 사진이 들어간 뒤엔 머리 줄의 '다른 사진' 칸"""
    page.locator("input[type=file][data-testid^=file]").first.set_input_files(path)


def status(page):
    return page.text_content("[data-testid=status]") or ""


def check(cond, msg):
    print(("  ok   " if cond else "  FAIL ") + msg)
    if not cond:
        FAILS.append(msg)


BOX_OK = "() => document.querySelector('[data-testid=status]').textContent.includes('상자 앞면을 찾았어요')"
# 예시 상자 사진의 앞면 사각형(사진 비율). 2026-11-25 눈으로 맞는 걸 확인한 값, ±0.01
BOX_EXPECT = {"left": 0.355, "right": 0.641, "top": 0.181, "bottom": 0.845}


def box_and_obj(page):
    """상자: 사진 → 앞면 사각형 → 3D 상자, 사각형·크기·두께 손으로 조절, 병과 나란히, OBJ(+재질·그림) 저장"""
    import io
    import re
    import zipfile
    print("[상자]")
    page.locator("button", has_text="상자").first.click()
    t0 = time.perf_counter()
    put_file(page, str(SAMPLE_DIR / "box_cream.png"))
    page.wait_for_function(BOX_OK, timeout=5000)
    check(time.perf_counter() - t0 < 3, "상자 3D 3초 안")
    r = page.evaluate("studio.box.rect")
    for k, v in BOX_EXPECT.items():
        check(abs(r[k] - v) <= 0.01, f"앞면 {k} {r[k]:.3f} (기대 {v:.3f}±0.01)")
    check(page.evaluate("studio.viewer.bottle.visible && studio.viewer.boxGroup.visible"), "병과 상자가 한 세트에 같이 섬")
    # 위에서 본 두 바닥 사각형이 겹치지 않는가(병은 몸통 반지름, 상자는 W×D)
    sep = page.evaluate("""() => { const v = studio.viewer; v.products.updateMatrixWorld(true);
        const s = v.boxSize(), bx = v.boxGroup.position.x, rB = Math.max(...v.shape.points.map(p => p[0]));
        return (v.bottle.position.x - rB) - (bx + s.W / 2); }""")
    check(sep > 0.05, f"병과 상자가 겹치지 않음(틈 {sep:.2f})")
    # 앞면 사각형 오른쪽 아래 모서리를 끌면 상자 가로/세로 비율이 바뀐다
    w0 = page.evaluate("studio.viewer.boxSize().W / studio.viewer.boxSize().H")
    xy = page.evaluate("""() => { const e = studio.editor, c = e.canvas.getBoundingClientRect(), r = e.rect;
        return [c.left + r.right * e.w, c.top + r.bottom * e.h]; }""")
    page.mouse.move(*xy); page.mouse.down(); page.mouse.move(xy[0] + 20, xy[1] - 20, steps=4); page.mouse.up()
    page.wait_for_timeout(100)
    w1 = page.evaluate("studio.viewer.boxSize().W / studio.viewer.boxSize().H")
    check(w1 > w0 * 1.1, f"모서리를 끌면 3D 상자 비율이 따라 바뀜({w0:.2f} → {w1:.2f})")
    page.click("[data-testid=redo]")
    page.wait_for_function(BOX_OK, timeout=5000)
    # 오른쪽 겉면 > 상자: 크기·두께·옆면 색
    page.locator("button", has_text="상자").last.click()
    h0, d0 = page.evaluate("[studio.viewer.boxSize().H, studio.viewer.boxSize().D]")
    page.get_by_role("slider", name="크기(병 대비)").focus(); page.keyboard.press("End")
    page.get_by_role("slider", name="두께").focus(); page.keyboard.press("Home")
    h1, d1 = page.evaluate("[studio.viewer.boxSize().H, studio.viewer.boxSize().D]")
    check(h1 > h0 * 1.4 and d1 < d0 * 0.5, f"크기·두께 손잡이로 3D 상자 높이 {h0:.2f}→{h1:.2f}, 두께 {d0:.2f}→{d1:.2f}")
    check(abs(page.evaluate("(() => { const g = studio.viewer.box.print.geometry; g.computeBoundingBox(); return g.boundingBox.max.y - g.boundingBox.min.y; })()") - h1) < 1e-6,
          "3D 상자 높이 = 계산한 높이")
    page.get_by_role("slider", name="크기(병 대비)").focus(); page.keyboard.press("Home")
    for _ in range(50):
        page.keyboard.press("ArrowRight")  # 40% → 90%
    page.get_by_role("slider", name="두께").focus()
    for _ in range(35):
        page.keyboard.press("ArrowRight")  # 10% → 45%
    card(page, "[data-chip='#7d2a22']")
    check(page.evaluate("studio.viewer.box.side.material.color.getHexString()") == "7d2a22", "옆면 색 바꾸기")
    check(page.evaluate("studio.viewer.box.print.material.map != null"), "앞·뒷면은 그대로 사진")
    # 리뷰에서 찾은 것들(2026-11-25)
    page.click("[data-testid=redo]")
    page.wait_for_function(BOX_OK, timeout=5000)
    check(page.evaluate("studio.viewer.box.side.material.color.getHexString()") == "7d2a22", "다시 따도 고른 옆면 색은 그대로")
    radio(page, "원기둥")
    fit = page.evaluate("""() => { const v = studio.viewer, s = v.boxSize(), p = v.boxGroup.position;
        const r = v.pedestal.geometry.parameters.radiusTop;
        return Math.max(...[-1, 1].flatMap(a => [-1, 1].map(b => Math.hypot(p.x + a * s.W / 2, p.z + b * s.D / 2)))) < r; }""")
    check(fit, "둥근 받침 위에 상자 네 귀퉁이가 다 올라감")
    radio(page, "없음")
    # 끌어다 놓기: 처음 그린 화면의 값(크기 90%)이 아니라 지금 손잡이 값(150%)으로 상자를 만든다
    page.get_by_role("slider", name="크기(병 대비)").focus(); page.keyboard.press("End")
    page.evaluate("""async () => { const b = await (await fetch('/samples/box_navy.png')).blob(), dt = new DataTransfer();
        dt.items.add(new File([b], 'box_navy.png', { type: 'image/png' }));
        document.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); }""")
    page.wait_for_function("() => document.querySelector('[data-testid=status]').textContent.includes('box_navy.png · 상자 앞면')", timeout=5000)
    s = page.evaluate("studio.viewer.boxSize()")
    check(abs(max(s["W"], s["H"]) - 4.5) < 1e-6 and s["W"] > s["H"], "끌어다 놓은 상자도 지금 크기 손잡이 값(150%)으로, 넓은 상자는 가로가 긴 변")
    # 상자 따기가 실패한 뒤 크기 손잡이를 움직여도 멈추지 않는다
    blank = OUT / "blank_box.png"
    Image.new("RGB", (600, 750), (205, 205, 205)).save(blank)
    put_file(page, str(blank))
    page.wait_for_function("() => document.querySelector('[data-testid=status]').textContent.includes('찾지 못했어요')", timeout=5000)
    check(not page.evaluate("studio.viewer.boxGroup.visible"), "상자 따기 실패 → 상자가 3D 에서 사라짐")
    page.get_by_role("slider", name="크기(병 대비)").focus(); page.keyboard.press("ArrowLeft")
    page.wait_for_timeout(100)
    put_file(page, str(SAMPLE_DIR / "box_cream.png"))
    page.wait_for_function(BOX_OK, timeout=5000)
    check(page.evaluate("studio.viewer.boxGroup.visible"), "실패 뒤에도 다음 상자 사진이 열림")
    card(page, "[data-chip='#7d2a22']")
    page.get_by_role("slider", name="크기(병 대비)").focus(); page.keyboard.press("Home")
    for _ in range(50):
        page.keyboard.press("ArrowRight")  # 다시 90%
    g0 = page.evaluate("studio.viewer.bottle.position.x - studio.viewer.boxGroup.position.x")
    page.get_by_role("slider", name="병과 상자 간격").focus(); page.keyboard.press("End")
    g1 = page.evaluate("studio.viewer.bottle.position.x - studio.viewer.boxGroup.position.x")
    check(g1 > g0 + 0.5, f"간격 손잡이로 둘 사이가 벌어짐({g0:.2f} → {g1:.2f})")
    page.get_by_role("slider", name="병과 상자 간격").focus(); page.keyboard.press("Home")
    for _ in range(35):
        page.keyboard.press("ArrowRight")
    with page.expect_download() as dl:
        page.click("[data-testid=save]")
    p_both = OUT / "bottle_and_box.png"
    dl.value.save_as(p_both)
    check(blank_ratio(p_both) > 0.08, f"병+상자 PNG 빈 화면 아님({blank_ratio(p_both):.1%})")

    # OBJ 저장: zip 안에 obj·mtl·그림, 면 번호가 점 개수 안쪽, 쓴 재질이 mtl 에 다 있음
    print("[OBJ]")
    with page.expect_download() as dl:
        page.click("[data-testid=save-obj]")
    p_zip = OUT / "studio_model.zip"
    dl.value.save_as(p_zip)
    z = zipfile.ZipFile(p_zip)
    names = set(z.namelist())
    check({"model.obj", "model.mtl", "photo.png", "box_front.png"} <= names, f"zip 안 파일 {sorted(names)}")
    obj = z.read("model.obj").decode()
    mtl = z.read("model.mtl").decode()
    nv = sum(1 for l in obj.splitlines() if l.startswith("v "))
    nvt = sum(1 for l in obj.splitlines() if l.startswith("vt "))
    idx = [int(p.split("/")[0]) for l in obj.splitlines() if l.startswith("f ") for p in l.split()[1:]]
    check(nv > 100 and nvt > 0 and idx and max(idx) <= nv and min(idx) >= 1, f"점 {nv}·텍스처 좌표 {nvt}·면 번호 {min(idx)}~{max(idx)}")
    used = set(re.findall(r"^usemtl (\S+)", obj, re.M))
    defined = set(re.findall(r"^newmtl (\S+)", mtl, re.M))
    check({"bottle_body", "bottle_cap", "box_print", "box_side"} <= used and used <= defined, f"재질 {sorted(used)} 이 mtl 에 다 있음")
    maps = set(re.findall(r"^map_Kd (\S+)", mtl, re.M))
    check(maps <= names and "box_front.png" in maps, f"mtl 이 부르는 그림 {sorted(maps)} 이 zip 에 있음")
    front = Image.open(io.BytesIO(z.read("box_front.png")))
    check(front.size[0] > 50 and front.size[1] > 50, f"상자 앞면 그림 {front.size}")
    ys = [float(l.split()[2]) for l in obj.splitlines() if l.startswith("v ")]
    check(abs(min(ys)) < 1e-3, f"바닥이 0(받침 높이 빠짐, 최저 {min(ys):.4f})")
    # 덩어리마다 이름이 붙고, 놓인 자리(가로 가운데)가 화면 속 자리와 같다(월드 행렬을 안 쓰면 전부 원점에 겹친다)
    cx, cur = {}, None
    for l in obj.splitlines():
        if l.startswith("o "):
            cur = l.split()[1]
            cx[cur] = []
        elif l.startswith("v ") and cur:
            cx[cur].append(float(l.split()[1]))
    cx = {k: (min(v) + max(v)) / 2 for k, v in cx.items() if v}
    want = page.evaluate("[studio.viewer.bottle.position.x, studio.viewer.boxGroup.position.x]")
    check(set(cx) >= {"bottle_body", "box_print", "box_side"}
          and abs(cx["bottle_body"] - want[0]) < 0.02 and abs(cx["box_print"] - want[1]) < 0.02,
          f"OBJ 속 자리 병 {cx.get('bottle_body', 0):.2f}·상자 {cx.get('box_print', 0):.2f} = 화면 {want[0]:.2f}·{want[1]:.2f}")
    check(not page.evaluate("studio.viewer.lost"), "WebGL 살아 있음")


def main():
    OUT.mkdir(exist_ok=True)
    port = free_port()
    # 연출 컷은 진짜 Codex 대신 가짜(tests/fake_codex.py)로: 1초 안에 1×1 그림을 돌려준다
    fake_images = Path(tempfile.mkdtemp()) / "generated_images"
    env = {**os.environ, "STUDIO_CODEX": str(ROOT / "tests" / "fake_codex.py"), "STUDIO_CODEX_IMAGES": str(fake_images),
           "STUDIO_OUT": str(fake_images.parent / "shots")}
    srv = subprocess.Popen([sys.executable, str(ROOT / "serve.py"), str(port)], stdout=subprocess.PIPE, env=env)
    assert srv.stdout is not None
    srv.stdout.readline()  # 준비 줄
    origin = f"http://127.0.0.1:{port}"
    outside = []
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
            page = browser.new_page(viewport={"width": 1440, "height": 900}, accept_downloads=True)
            page.on("request", lambda r: None if r.url.startswith((origin, "data:", "blob:")) else outside.append(r.url))
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.goto(origin)

            for name in SAMPLES:
                print(f"[{name}]")
                t0 = time.perf_counter()
                put_file(page, str(SAMPLE_DIR / name))
                page.wait_for_function(OK_TEXT, timeout=5000)
                dt = time.perf_counter() - t0
                check(dt < 3, f"외곽선·3D {dt:.2f}초 (3초 안)")
                n = page.evaluate("studio.state.profile.points.length")
                check(3 <= n <= 24, f"점 {n}개")
                got = page.evaluate("""() => { const p = studio.state.profile, ys = p.points.map(q => q.y);
                    return { axisX: p.axisX, top: Math.min(...ys), bottom: Math.max(...ys) }; }""")
                for k, v in EXPECT[name].items():
                    check(abs(got[k] - v) <= 0.01, f"{k} {got[k]:.3f} (기대 {v:.3f}±0.01)")

                # 점 끌기 → 3D 정점이 바뀌는가
                RMAX = "(() => { const a = studio.viewer.parts.body.mesh.geometry.attributes.position.array; let m = 0; for (let i = 0; i < a.length; i += 3) m += Math.hypot(a[i], a[i + 2]); return m / (a.length / 3); })()"
                before = page.evaluate(RMAX)
                rs0 = page.evaluate("studio.editor.profile.points.map(p => p.r)")
                k, pt = page.evaluate("""() => { const e = studio.editor, r = e.canvas.getBoundingClientRect();
                    const p = e.sorted()[Math.floor(e.profile.points.length / 2)], s = e.toScreen(p);
                    return [e.profile.points.indexOf(p), [r.left + s.x, r.top + s.y]]; }""")
                page.mouse.move(*pt)
                page.mouse.down()
                page.mouse.move(pt[0] + 25, pt[1], steps=4)
                page.mouse.up()
                rs1 = page.evaluate("studio.editor.profile.points.map(p => p.r)")
                after = page.evaluate(RMAX)
                others = all(abs(a - b) < 1e-9 for i, (a, b) in enumerate(zip(rs0, rs1)) if i != k)
                check(rs1[k] > rs0[k] and others, f"오른쪽으로 끈 점만 반지름이 커짐({rs0[k]:.3f} → {rs1[k]:.3f})")
                check(after > before * 1.01, f"3D 병 평균 반지름도 커짐({before:.3f} → {after:.3f})")
                page.click("[data-testid=redo]")  # 다음 확인은 자동 외곽선으로

                # 선 위 더블클릭 = 점 추가, 점 우클릭 = 삭제, 축 끌기 = 점은 사진 위 제자리
                n0 = page.evaluate("studio.editor.profile.points.length")
                mid = page.evaluate("""() => { const e = studio.editor, r = e.canvas.getBoundingClientRect(), pts = e.sorted();
                    let best = 0, gap = 0; for (let i = 0; i < pts.length - 1; i++) { const g = pts[i + 1].y - pts[i].y; if (g > gap) { gap = g; best = i; } }
                    const a = e.toScreen(pts[best]), b = e.toScreen(pts[best + 1]); return [r.left + (a.x + b.x) / 2, r.top + (a.y + b.y) / 2]; }""")
                page.mouse.dblclick(*mid)
                check(page.evaluate("studio.editor.profile.points.length") == n0 + 1, "선 위 더블클릭 → 점 +1")
                pt = page.evaluate("""() => { const e = studio.editor, r = e.canvas.getBoundingClientRect(), s = e.toScreen(e.sorted()[3]); return [r.left + s.x, r.top + s.y]; }""")
                page.mouse.click(*pt, button="right")
                check(page.evaluate("studio.editor.profile.points.length") == n0, "점 우클릭 → 점 -1")
                abs0 = page.evaluate("studio.editor.profile.points.map(p => studio.editor.profile.axisX + p.r)")
                ax = page.evaluate("""() => { const e = studio.editor, r = e.canvas.getBoundingClientRect(), pts = e.sorted();
                    const y = (pts[0].y + pts.at(-1).y) / 2 * e.h + 40; return [r.left + e.profile.axisX * e.w, r.top + y]; }""")
                page.mouse.move(*ax); page.mouse.down(); page.mouse.move(ax[0] - 12, ax[1], steps=4); page.mouse.up()
                abs1 = page.evaluate("studio.editor.profile.points.map(p => studio.editor.profile.axisX + p.r)")
                moved = page.evaluate("studio.editor.profile.axisX")
                check(all(abs(a - b) < 1e-6 for a, b in zip(abs0, abs1)) and abs(moved - got["axisX"]) > 0.005,
                      f"축 끌기 → 축만 이동({got['axisX']:.3f} → {moved:.3f}), 점은 사진 위 제자리")
                page.click("[data-testid=redo]")

                # 조명 왼쪽 → 오른쪽: 그림자 쪽이 바뀌는가 (저장 PNG 로 잰다)
                shots = {}
                for side, az in (("left", -70), ("right", 70)):
                    page.evaluate(f"studio.viewer.setLight({{azimuth: {az}, elevation: 35}})")
                    for cast in (True, False):
                        page.evaluate(f"studio.viewer.bottle.traverse(o => {{ if (o.isMesh) o.castShadow = {'true' if cast else 'false'}; }})")
                        with page.expect_download() as dl:
                            page.click("[data-testid=save]")
                        path = OUT / f"{Path(name).stem}_{side}{'' if cast else '_noshadow'}.png"
                        dl.value.save_as(path)
                        shots[side if cast else side + "_off"] = path
                page.evaluate("studio.viewer.bottle.traverse(o => { if (o.isMesh) o.castShadow = true; })")
                im = Image.open(shots["left"])
                check(im.size == (1080, 1350), f"PNG 크기 {im.size}")
                br = blank_ratio(shots["left"])
                check(br > 0.05, f"빈 화면 아님(배경과 다른 픽셀 {br:.1%})")
                (lx, ln), (rx, rn) = shadow_x(shots["left"], shots["left_off"]), shadow_x(shots["right"], shots["right_off"])
                check(ln > 200 and rn > 200, f"바닥 그림자 픽셀 {ln}·{rn}개(그림자를 끄면 사라짐)")
                check(lx is not None and rx is not None and lx > 0.5 > rx,
                      f"바닥 그림자 무게중심: 왼쪽 조명 {lx or 0:.2f} > 0.5 > 오른쪽 조명 {rx or 0:.2f}")

                # 덧입힌 상태로 2160 크기 저장
                # 덧입히기: 부위별 재질·색, 라벨, 받침, 배경지, 뚜껑 경계
                tab(page, "뚜껑"); card(page, "[data-finish=metal]")
                check(page.evaluate("studio.viewer.parts.cap.mesh.material.metalness") == 1, "뚜껑만 금속으로")
                check(page.evaluate("studio.viewer.parts.body.mesh.material.metalness") != 1, "몸통은 그대로")
                tab(page, "몸통"); card(page, "[data-chip='#9fb2a3']")
                check(page.evaluate("studio.viewer.parts.body.finish") == "matte"
                      and page.evaluate("studio.viewer.parts.body.mesh.material.color.getHexString()") == "9fb2a3",
                      "사진 상태에서 색을 고르면 그 색의 무광으로")
                tab(page, "라벨"); radio(page, "예시 라벨")
                check(page.evaluate("!!studio.viewer.label.mesh"), "예시 라벨이 병에 감김")
                radio(page, "원기둥")
                check(page.evaluate("studio.viewer.products.position.y") > 0.3, "받침을 깔면 제품이 그 위로 올라감")
                card(page, "[data-backdrop=ink]")
                check(page.evaluate("studio.viewer.scene.background.getHexString()") == "3b3a38", "배경지 색 바뀜")
                cap0 = page.evaluate("studio.state.capY")
                capxy = page.evaluate("""() => { const e = studio.editor, r = e.canvas.getBoundingClientRect(), pts = e.sorted();
                    return [r.left + (e.profile.axisX - 0.2) * e.w, r.top + e.capY * e.h]; }""")
                page.mouse.move(*capxy); page.mouse.down(); page.mouse.move(capxy[0], capxy[1] + 20, steps=4); page.mouse.up()
                check(page.evaluate("studio.state.capY") > cap0 + 0.01, f"빨간 선을 끌면 뚜껑 경계가 내려감({cap0:.3f} → {page.evaluate('studio.state.capY'):.3f})")
                pick_size(page, "2160 × 2700")
                with page.expect_download() as dl:
                    page.click("[data-testid=save]")
                p2 = OUT / f"{Path(name).stem}_dressed.png"
                dl.value.save_as(p2)
                check(Image.open(p2).size == (2160, 2700), "덧입힌 상태로 2160×2700 저장")
                # 다음 사진 시험을 위해 처음 상태로
                page.get_by_role("radio", name="없음", exact=True).first.click()
                page.get_by_role("radio", name="없음", exact=True).last.click()
                card(page, "[data-backdrop=paper]")
                for part in ("몸통", "뚜껑"):
                    tab(page, part); card(page, "[data-finish=photo]")
                pick_size(page, "1080 × 1350")
                check(not page.evaluate("studio.viewer.lost"), "WebGL 살아 있음")

            # 제품 없는 사진 → 오류 문구, 앱은 계속
            blank = OUT / "blank.png"
            Image.new("RGB", (600, 750), (205, 205, 205)).save(blank)
            put_file(page, str(blank))
            page.wait_for_function("() => document.querySelector('[data-testid=status]').textContent.includes('찾지 못했어요')", timeout=5000)
            check("찾지 못했어요" in status(page), "빈 사진 → 오류 문구")
            check(not page.evaluate("studio.viewer.bottle.visible"), "실패하면 이전 병이 3D 에서 사라짐")
            page.click("[data-testid=save]")
            check("먼저 사진" in status(page), "실패 뒤 저장은 막힘(이전 병을 저장하지 않음)")
            put_file(page, str(SAMPLE_DIR / SAMPLES[0]))
            try:
                page.wait_for_function(OK_TEXT, timeout=5000)
                check(page.evaluate("studio.viewer.bottle.visible"), "오류 뒤에도 다음 사진이 열림")
            except Exception as e:  # noqa: BLE001 — 시간 초과도 실패로 세고 끝까지 간다
                check(False, f"오류 뒤 다음 사진 열기: {type(e).__name__}")

            box_and_obj(page)

            # 연출 컷: 버튼 → 진행 → 비교 보기(캡처 | 결과) → 저장 → 3D 로 돌아가기 / 취소
            print("[연출 컷]")
            fake_images.mkdir(parents=True, exist_ok=True)
            (fake_images / "mode.txt").write_text("ok")
            page.get_by_role("button", name="연출 컷 만들기").click()
            page.wait_for_selector("[data-testid=compare]", timeout=15000)
            loaded = page.evaluate("[...document.querySelectorAll('[data-testid=compare] img')].map(i => i.complete && i.naturalWidth > 0)")
            check(loaded == [True, True], f"비교 보기에 캡처와 연출 컷 두 장({loaded})")
            check(page.locator("[data-testid=compare]").is_visible() and not page.locator("[data-testid=view3d]").is_visible(),
                  "비교 보기가 3D 자리에 실제로 보임(3D 는 숨김)")
            cap = page.evaluate("document.querySelector('[data-testid=compare] img').naturalWidth")
            check(cap == 1080, f"넘긴 캡처가 1080 폭({cap})")
            prompt = (fake_images / "last_prompt.txt").read_text(encoding="utf-8")
            check("석회암" in prompt and "그림자 방향을 그대로 유지" in prompt, "고른 장면 + 고정 지시가 Codex 로 감")
            with page.expect_download() as dl:
                page.click("[data-testid=shot-save]")
            p_shot = OUT / "shot_fake.png"
            dl.value.save_as(p_shot)
            check(Image.open(p_shot).size == (1, 1), "연출 컷 저장 = 서버가 받은 그림 그대로")
            page.get_by_role("radio", name="3D", exact=True).click()
            check(page.locator("[data-testid=view3d]").is_visible() and page.locator("canvas").nth(1).bounding_box()["width"] > 300,
                  "3D 로 돌아가면 3D 화면이 다시 제 크기로 보임")
            # 비교 보기에서 다시 만들다 실패해도 가운데가 비지 않고 3D 가 보여야 한다(리뷰에서 찾은 버그)
            (fake_images / "mode.txt").write_text("ok")
            page.get_by_role("button", name="연출 컷 만들기").click()
            page.wait_for_selector("[data-testid=compare]", timeout=15000)
            (fake_images / "mode.txt").write_text("fail")
            page.get_by_role("button", name="연출 컷 만들기").click()
            page.wait_for_function("() => document.querySelector('[data-testid=status]').textContent.includes('실패')", timeout=15000)
            check(page.locator("[data-testid=view3d]").is_visible() and not page.locator("[data-testid=compare]").is_visible(),
                  "다시 만들다 실패해도 3D 가 보임(가운데가 비지 않음)")
            (fake_images / "mode.txt").write_text("slow")
            page.get_by_role("button", name="연출 컷 만들기").click()
            page.wait_for_selector("[data-testid=shot-cancel]", timeout=5000)
            page.click("[data-testid=shot-cancel]")
            page.wait_for_function("() => document.querySelector('[data-testid=status]').textContent.includes('취소')", timeout=15000)
            check(page.get_by_role("button", name="연출 컷 만들기").is_visible(), "취소하면 버튼이 돌아옴")

            check(not outside, f"외부 요청 {len(outside)}건 {outside[:3]}")
            check(not errors, f"페이지 오류 {errors[:3]}")
            browser.close()
    finally:
        srv.terminate()
    print("e2e:", "PASS" if not FAILS else f"FAIL {len(FAILS)}")
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())
