"""한 장 스튜디오 로컬 서버: npm run build 후 python serve.py  →  http://127.0.0.1:8411

빌드 결과(dist/)만 내 PC 에서 연다(127.0.0.1). 3단계에서 Codex 연출 컷 요청을 받는 자리도 여기다.
"""
import functools
import http.server
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DIST = ROOT / "dist"
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8411


PUBLIC = ("/", "/index.html", "/assets/", "/samples/")


class Handler(http.server.SimpleHTTPRequestHandler):
    # 윈도우는 레지스트리 때문에 .js 를 text/plain 으로 줄 때가 있어 모듈이 안 뜬다 → 직접 지정
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
        ".html": "text/html; charset=utf-8", ".png": "image/png", ".json": "application/json", ".woff2": "font/woff2",
    }

    def allowed(self):
        # 다른 사이트가 DNS 를 바꿔치기해 이 서버를 읽는 걸 막고(Host 확인), 앱 파일만 내보낸다(.git 등 제외)
        # 3단계에서 Codex 를 부르는 요청이 붙기 전에 미리 걸어 둔다
        host = (self.headers.get("Host") or "").lower()
        if host not in (f"127.0.0.1:{PORT}", f"localhost:{PORT}"):
            self.send_error(403, "host not allowed")
            return False
        path = self.path.split("?", 1)[0]
        if not (path in PUBLIC[:2] or path.startswith(PUBLIC[2:])) or ".." in path:
            self.send_error(404)
            return False
        return True

    def do_GET(self):
        if self.allowed():
            super().do_GET()

    def do_HEAD(self):
        if self.allowed():
            super().do_HEAD()

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
