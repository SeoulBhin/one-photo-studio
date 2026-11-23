"""한 장 스튜디오 로컬 서버: python serve.py  →  http://127.0.0.1:8411

내 PC 에서만 연다(127.0.0.1). 3단계에서 Codex 연출 컷 요청을 받는 자리도 여기다.
"""
import functools
import http.server
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8411


class Handler(http.server.SimpleHTTPRequestHandler):
    # 윈도우는 레지스트리 때문에 .js 를 text/plain 으로 줄 때가 있어 모듈이 안 뜬다 → 직접 지정
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
        ".html": "text/html; charset=utf-8", ".png": "image/png", ".json": "application/json",
    }

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, format, *args):  # noqa: A002 — 부모 이름 그대로
        pass


def main():
    handler = functools.partial(Handler, directory=str(ROOT))
    with http.server.ThreadingHTTPServer(("127.0.0.1", PORT), handler) as srv:
        print(f"한 장 스튜디오: http://127.0.0.1:{PORT}", flush=True)
        try:
            srv.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
