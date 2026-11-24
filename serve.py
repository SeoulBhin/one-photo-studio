"""한 장 스튜디오 로컬 서버: npm run build 후 python serve.py  →  http://127.0.0.1:8411

빌드 결과(dist/)를 내 PC 에서만 연다(127.0.0.1). 연출 컷 요청(POST /api/shot)을 받아 Codex CLI 를 부른다.

Codex 를 부르는 요청은 다른 웹페이지가 흉내 낼 수 없게 네 겹으로 막는다.
  1) Host 가 127.0.0.1/localhost:PORT  2) Origin 이 이 앱 주소  3) JSON 본문만
  4) 서버를 켤 때마다 새로 만드는 토큰 — 이 앱의 index.html 에만 끼워 주고, 다른 사이트는 이 페이지를 읽을 수 없다
"""
import functools
import http.server
import json
import os
import re
import secrets
import sys
from pathlib import Path

from shot import Busy, CodexMissing, Shots, decode_png

ROOT = Path(__file__).resolve().parent
DIST = ROOT / "dist"
OUT = Path(os.environ.get("STUDIO_OUT") or ROOT / "out" / "shots")  # 시험은 임시 폴더로
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8411
TOKEN = secrets.token_urlsafe(24)
MAX_BODY = 20 * 1024 * 1024
STATIC = ("/assets/", "/samples/")
SHOTS = Shots(OUT, timeout=int(os.environ.get("STUDIO_SHOT_TIMEOUT", "300")))  # 시험에선 짧게


class Handler(http.server.SimpleHTTPRequestHandler):
    # 윈도우는 레지스트리 때문에 .js 를 text/plain 으로 줄 때가 있어 모듈이 안 뜬다 → 직접 지정
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
        ".html": "text/html; charset=utf-8", ".png": "image/png", ".json": "application/json", ".woff2": "font/woff2",
    }

    timeout = 30  # 반쯤 보내고 멈춘 연결이 스레드를 계속 붙잡지 않게

    def host_ok(self):
        # 다른 사이트가 DNS 를 바꿔치기해 이 서버를 읽는 걸 막는다
        host = (self.headers.get("Host") or "").lower()
        if host not in (f"127.0.0.1:{PORT}", f"localhost:{PORT}"):
            self.send_error(403, "host not allowed")
            return False
        return True

    def path_only(self):
        return self.path.split("?", 1)[0]

    # ── 읽기
    def do_GET(self):
        if not self.host_ok():
            return
        path = self.path_only()
        if path.startswith("/api/shot/"):
            self.api_get(path)
        elif path in ("/", "/index.html"):
            self.send_index()
        elif path.startswith(STATIC) and ".." not in path:
            super().do_GET()
        else:
            self.send_error(404)

    def do_HEAD(self):
        path = self.path_only()
        if self.host_ok():
            if path.startswith(STATIC) and ".." not in path:
                super().do_HEAD()
            else:
                self.send_error(404)

    def send_index(self):
        html = (DIST / "index.html").read_text(encoding="utf-8")
        html = html.replace("</head>", f'<meta name="studio-token" content="{TOKEN}">\n</head>', 1)
        self.send_bytes(200, html.encode("utf-8"), "text/html; charset=utf-8")

    def api_get(self, path):
        # 결과·캡처 조회에도 토큰(머리글, 또는 이미지 주소의 ?t=)
        query = self.path.split("?", 1)[1] if "?" in self.path else ""
        params = dict(p.split("=", 1) for p in query.split("&") if "=" in p)
        given = self.headers.get("X-Studio-Token") or params.get("t", "")
        if not secrets.compare_digest(given, TOKEN):
            self.json(403, {"error": "토큰이 맞지 않아요"})
            return
        m = re.fullmatch(r"/api/shot/([0-9_a-f]+)(/image|/capture)?", path)
        job = SHOTS.get(m.group(1)) if m else None
        if not m or not job:
            self.json(404, {"error": "없는 작업이에요"})
            return
        if m.group(2):
            f = job.dir / ("shot.png" if m.group(2) == "/image" else "capture.png")
            if not f.exists():
                self.json(404, {"error": "아직 그림이 없어요"})
                return
            self.send_bytes(200, f.read_bytes(), "image/png")
            return
        self.json(200, job.info())

    # ── 쓰기: 연출 컷 시작·취소
    def do_POST(self):
        if not self.host_ok():
            return
        origin = self.headers.get("Origin") or ""
        if origin not in (f"http://127.0.0.1:{PORT}", f"http://localhost:{PORT}"):
            self.json(403, {"error": "다른 주소에서 온 요청이에요"})
            return
        if not secrets.compare_digest(self.headers.get("X-Studio-Token") or "", TOKEN):
            self.json(403, {"error": "토큰이 맞지 않아요. 페이지를 새로고침해 주세요"})
            return
        if (self.headers.get("Content-Type") or "").split(";")[0].strip() != "application/json":
            self.json(400, {"error": "JSON 요청만 받아요"})
            return
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = -1
        if length < 0 or length > MAX_BODY:
            self.json(413, {"error": "캡처가 너무 커요"})
            return
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
            if not isinstance(body, dict):
                raise ValueError
        except ValueError:
            self.json(400, {"error": "JSON 을 읽을 수 없어요"})
            return
        path = self.path_only()
        if path == "/api/shot":
            self.api_start(body)
            return
        m = re.fullmatch(r"/api/shot/([0-9_a-f]+)/cancel", path)
        if m:
            ok = SHOTS.cancel(m.group(1))
            self.json(200 if ok else 409, {"cancelled": ok})
            return
        self.json(404, {"error": "없는 주소예요"})

    def api_start(self, body):
        try:
            png = decode_png(body.get("image"))
        except ValueError as e:
            self.json(400, {"error": str(e)})
            return
        scene = body.get("scene") if isinstance(body.get("scene"), str) else ""
        try:
            job = SHOTS.start(png, scene)
        except Busy as e:
            self.json(409, {"error": str(e)})
            return
        except CodexMissing as e:
            self.json(503, {"error": str(e)})
            return
        self.json(202, job.info())

    def json(self, code, obj):
        self.send_bytes(code, json.dumps(obj, ensure_ascii=False).encode("utf-8"), "application/json; charset=utf-8")

    def send_bytes(self, code, data, ctype):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, format, *args):  # noqa: A002 — 부모 이름 그대로
        pass


def main():
    if not (DIST / "index.html").exists():
        sys.exit("dist/ 가 없어요. 먼저 npm install 과 npm run build 를 하세요")
    handler = functools.partial(Handler, directory=str(DIST))
    with http.server.ThreadingHTTPServer(("127.0.0.1", PORT), handler) as srv:
        print(f"한 장 스튜디오: http://127.0.0.1:{PORT}", flush=True)
        try:
            srv.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
