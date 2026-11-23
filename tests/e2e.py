"""한 장 스튜디오 e2e: python tests/e2e.py   (헤드리스 크로미움, 서버는 시험이 직접 띄운다)

protects: 사진 넣기 → 외곽선 → 3D → 점 편집 → 겉면 토글 → 조명 이동 → PNG 저장, 화면에서 사람이 하는 순서 그대로
fails_when: 3초 안에 외곽선·3D 가 안 뜸 / 점을 끌어도 3D 모양이 그대로 / 조명을 왼쪽↔오른쪽으로 옮겨도 그림자 쪽이 안 바뀜 /
            저장 PNG 크기가 고른 값과 다름·빈 화면 / 예시 사진 외곽선이 확인한 값에서 벗어남 / 실패 뒤 이전 병이 남음 / 조작 중 WebGL 이 죽음 / 외부 주소로 요청이 나감
no_claim: 보기 좋은지(저장 PNG 는 out/ 에 남겨 눈으로 본다), 실제 GPU 브라우저 동작(헤드리스는 소프트웨어 렌더링)
"""
import socket
import subprocess
import sys
import time
from pathlib import Path

from PIL import Image
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
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


def check(cond, msg):
    print(("  ok   " if cond else "  FAIL ") + msg)
    if not cond:
        FAILS.append(msg)


def main():
    OUT.mkdir(exist_ok=True)
    port = free_port()
    srv = subprocess.Popen([sys.executable, str(ROOT / "serve.py"), str(port)], stdout=subprocess.PIPE)
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
                page.set_input_files("#file", str(ROOT / "samples" / name))
                page.wait_for_function("() => document.querySelector('#status').textContent.includes('외곽선을 땄어요')", timeout=5000)
                dt = time.perf_counter() - t0
                check(dt < 3, f"외곽선·3D {dt:.2f}초 (3초 안)")
                n = page.evaluate("studio.state.profile.points.length")
                check(3 <= n <= 24, f"점 {n}개")
                got = page.evaluate("""() => { const p = studio.state.profile, ys = p.points.map(q => q.y);
                    return { axisX: p.axisX, top: Math.min(...ys), bottom: Math.max(...ys) }; }""")
                for k, v in EXPECT[name].items():
                    check(abs(got[k] - v) <= 0.01, f"{k} {got[k]:.3f} (기대 {v:.3f}±0.01)")

                # 점 끌기 → 3D 정점이 바뀌는가
                RMAX = "(() => { const a = studio.viewer.mesh.geometry.attributes.position.array; let m = 0; for (let i = 0; i < a.length; i += 3) m += Math.hypot(a[i], a[i + 2]); return m / (a.length / 3); })()"
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
                page.click("#redo")  # 다음 확인은 자동 외곽선으로

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
                page.click("#redo")

                # 조명 왼쪽 → 오른쪽: 그림자 쪽이 바뀌는가 (저장 PNG 로 잰다)
                shots = {}
                for side, az in (("left", -70), ("right", 70)):
                    page.evaluate(f"studio.viewer.setLight({{azimuth: {az}, elevation: 35}})")
                    for cast in (True, False):
                        page.evaluate(f"studio.viewer.mesh.castShadow = {'true' if cast else 'false'}")
                        with page.expect_download() as dl:
                            page.click("#save")
                        path = OUT / f"{Path(name).stem}_{side}{'' if cast else '_noshadow'}.png"
                        dl.value.save_as(path)
                        shots[side if cast else side + "_off"] = path
                page.evaluate("studio.viewer.mesh.castShadow = true")
                im = Image.open(shots["left"])
                check(im.size == (1080, 1350), f"PNG 크기 {im.size}")
                br = blank_ratio(shots["left"])
                check(br > 0.05, f"빈 화면 아님(배경과 다른 픽셀 {br:.1%})")
                (lx, ln), (rx, rn) = shadow_x(shots["left"], shots["left_off"]), shadow_x(shots["right"], shots["right_off"])
                check(ln > 200 and rn > 200, f"바닥 그림자 픽셀 {ln}·{rn}개(그림자를 끄면 사라짐)")
                check(lx is not None and rx is not None and lx > 0.5 > rx,
                      f"바닥 그림자 무게중심: 왼쪽 조명 {lx or 0:.2f} > 0.5 > 오른쪽 조명 {rx or 0:.2f}")

                # 단색으로 바꿔 저장, 2160 크기
                page.check("input[value=solid]")
                page.select_option("#size", "2160x2700")
                with page.expect_download() as dl:
                    page.click("#save")
                p2 = OUT / f"{Path(name).stem}_solid.png"
                dl.value.save_as(p2)
                check(Image.open(p2).size == (2160, 2700), "단색 2160×2700 저장")
                page.check("input[value=photo]")
                page.select_option("#size", "1080x1350")
                check(not page.evaluate("studio.viewer.lost"), "WebGL 살아 있음")

            # 제품 없는 사진 → 오류 문구, 앱은 계속
            blank = OUT / "blank.png"
            Image.new("RGB", (600, 750), (205, 205, 205)).save(blank)
            page.set_input_files("#file", str(blank))
            page.wait_for_function("() => document.querySelector('#status').classList.contains('bad')", timeout=5000)
            check("찾지 못했어요" in (page.text_content("#status") or ""), "빈 사진 → 오류 문구")
            check(not page.evaluate("studio.viewer.mesh.visible"), "실패하면 이전 병이 3D 에서 사라짐")
            page.click("#save")
            check("먼저 사진" in (page.text_content("#status") or ""), "실패 뒤 저장은 막힘(이전 병을 저장하지 않음)")
            page.set_input_files("#file", str(ROOT / "samples" / SAMPLES[0]))
            try:
                page.wait_for_function("() => document.querySelector('#status').textContent.includes('외곽선을 땄어요')", timeout=5000)
                check(page.evaluate("studio.viewer.mesh.visible"), "오류 뒤에도 다음 사진이 열림")
            except Exception as e:  # noqa: BLE001 — 시간 초과도 실패로 세고 끝까지 간다
                check(False, f"오류 뒤 다음 사진 열기: {type(e).__name__}")

            check(not outside, f"외부 요청 {len(outside)}건 {outside[:3]}")
            check(not errors, f"페이지 오류 {errors[:3]}")
            browser.close()
    finally:
        srv.terminate()
    print("e2e:", "PASS" if not FAILS else f"FAIL {len(FAILS)}")
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())
