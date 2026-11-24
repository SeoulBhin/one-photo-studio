"""연출 컷 서버 시험: python -m unittest tests/test_server.py   (먼저 npm run build)

진짜 Codex 대신 tests/fake_codex.py 를 끼워 서버를 띄우고 요청을 보낸다.
protects: Codex 를 부르는 요청은 이 앱(같은 주소·토큰)만 보낼 수 있다 / 캡처·장면 글이 그대로 Codex 에 간다 /
          Codex 는 설정 무시·읽기 전용으로 불린다 / 결과 그림을 작업 번호 폴더에서 찾아온다 / 한 번에 하나, 취소, 실패를 사람 말로
fails_when: 토큰·Origin·Host·형식이 틀린 요청에 Codex 가 불림 / 장면 글의 특수 문자가 바뀜 / 다른 폴더의 그림을 집음 /
            두 번째 요청이 겹쳐 돎 / 취소해도 안 멈춤 / 실패가 완료로 보임
no_claim: 진짜 Codex 의 그림 품질·시간(손으로 확인), 화면 동작(e2e)
"""
import base64
import http.client
import json
import os
import re
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ONE_PX = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=="
PNG = "data:image/png;base64," + ONE_PX


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class ServerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.images = Path(cls.tmp.name) / "generated_images"
        cls.port = free_port()
        env = {**os.environ, "STUDIO_CODEX": str(ROOT / "tests" / "fake_codex.py"),
               "STUDIO_CODEX_IMAGES": str(cls.images), "PYTHONUTF8": "1"}
        cls.srv = subprocess.Popen([sys.executable, str(ROOT / "serve.py"), str(cls.port)], env=env, stdout=subprocess.PIPE)
        assert cls.srv.stdout
        cls.srv.stdout.readline()
        cls.origin = f"http://127.0.0.1:{cls.port}"
        html = cls.req("GET", "/")[1].decode()
        m = re.search(r'name="studio-token" content="([^"]+)"', html)
        assert m, "index.html 에 토큰이 없음"
        cls.token = m.group(1)

    @classmethod
    def tearDownClass(cls):
        cls.srv.terminate()
        cls.srv.wait()
        cls.tmp.cleanup()

    @classmethod
    def req(cls, method, path, body=None, headers=None, host=None):
        c = http.client.HTTPConnection("127.0.0.1", cls.port, timeout=10)
        h = {"Host": host or f"127.0.0.1:{cls.port}", **(headers or {})}
        data = json.dumps(body).encode() if isinstance(body, dict) else body
        c.request(method, path, body=data, headers=h)
        r = c.getresponse()
        return r.status, r.read()

    def post(self, path, body, **over):
        headers = {"Origin": self.origin, "X-Studio-Token": self.token, "Content-Type": "application/json"}
        headers.update(over)
        return self.req("POST", path, body, headers)

    def mode(self, m):
        self.images.mkdir(parents=True, exist_ok=True)
        (self.images / "mode.txt").write_text(m)
        (self.images / "last_prompt.txt").unlink(missing_ok=True)

    def start(self, scene="x"):
        status, body = self.post("/api/shot", {"image": PNG, "scene": scene})
        self.assertEqual(status, 202, body)
        return json.loads(body)["id"]

    def wait(self, job_id, limit=20):
        t = time.time()
        while time.time() - t < limit:
            info = json.loads(self.req("GET", f"/api/shot/{job_id}")[1])
            if info["state"] != "running":
                return info
            time.sleep(0.2)
        self.fail("시간 안에 안 끝남")

    def called(self):
        return (self.images / "last_prompt.txt").exists()

    def test_01_blocked_requests_never_call_codex(self):
        self.mode("ok")
        cases = [
            ("토큰 없음", {"X-Studio-Token": ""}, 403),
            ("토큰 틀림", {"X-Studio-Token": "x" * 32}, 403),
            ("다른 Origin", {"Origin": "http://evil.example"}, 403),
            ("Origin 없음", {"Origin": ""}, 403),
            ("JSON 아님", {"Content-Type": "text/plain"}, 400),
        ]
        for name, over, code in cases:
            with self.subTest(name):
                self.assertEqual(self.post("/api/shot", {"image": PNG, "scene": "x"}, **over)[0], code)
        status, _ = self.req("POST", "/api/shot", {"image": PNG}, {"Origin": self.origin, "X-Studio-Token": self.token,
                             "Content-Type": "application/json"}, host="attacker.example")
        self.assertEqual(status, 403, "다른 Host")
        self.assertEqual(self.post("/api/shot", {"image": "data:image/jpeg;base64,AAAA"})[0], 400, "PNG 아님")
        fake = "data:image/png;base64," + base64.b64encode(b"not png").decode()
        self.assertEqual(self.post("/api/shot", {"image": fake})[0], 400, "PNG 머리 아님")
        self.assertEqual(self.post("/api/shot", b"{}", **{"Content-Length": str(30 * 1024 * 1024)})[0], 413, "너무 큼")
        self.assertFalse(self.called(), "막아야 할 요청에서 Codex 가 불림")

    def test_02_ok_flow_prompt_args_and_result(self):
        self.mode("ok")
        scene = '대리석 위 "새벽" 빛 & 물결 | 100% %PATH% 그림자\n둘째 줄'
        info = self.wait(self.start(scene))
        self.assertEqual(info["state"], "done", info)
        prompt = (self.images / "last_prompt.txt").read_text(encoding="utf-8")
        self.assertIn(scene, prompt, "장면 글이 글자 그대로 가야 함")
        self.assertIn("그림자 방향을 그대로 유지", prompt)
        args = json.loads((self.images / "last_args.json").read_text(encoding="utf-8"))
        for flag in ("--ignore-user-config", "--skip-git-repo-check", "--json"):
            self.assertIn(flag, args)
        self.assertEqual(args[args.index("-s") + 1], "read-only")
        self.assertLess(args.index("-"), args.index("-i"), "프롬프트(표준입력 '-')가 -i 앞")
        status, png = self.req("GET", f"/api/shot/{info['id']}/image")
        self.assertEqual(status, 200)
        self.assertTrue(png.startswith(b"\x89PNG"))
        self.assertEqual(self.req("GET", f"/api/shot/{info['id']}/capture")[0], 200)

    def test_03_other_folders_are_ignored(self):
        # Codex 를 따로 돌려 생긴 다른 작업 폴더의 그림은 집으면 안 된다
        self.mode("noimage")
        other = self.images / "11111111-2222-3333-4444-555555555555"
        other.mkdir(parents=True, exist_ok=True)
        (other / "exec-other.png").write_bytes(base64.b64decode(ONE_PX))
        info = self.wait(self.start())
        self.assertEqual(info["state"], "error")
        self.assertIn("그림을 만들지 않았어요", info["error"])

    def test_04_busy_and_cancel(self):
        self.mode("slow")
        first = self.start()
        time.sleep(0.5)
        self.assertEqual(self.post("/api/shot", {"image": PNG, "scene": "y"})[0], 409, "두 번째는 409")
        t = time.time()
        self.assertEqual(self.post(f"/api/shot/{first}/cancel", {})[0], 200)
        info = self.wait(first, limit=15)
        self.assertEqual(info["state"], "cancelled")
        self.assertLess(time.time() - t, 15)

    def test_05_failures_in_plain_words(self):
        for m, words in (("fail", "실패했어요"), ("login", "로그인")):
            with self.subTest(m):
                self.mode(m)
                info = self.wait(self.start())
                self.assertEqual(info["state"], "error")
                self.assertIn(words, info["error"])

    def test_06_static_rules_kept(self):
        self.assertEqual(self.req("GET", "/serve.py")[0], 404)
        self.assertEqual(self.req("GET", "/api/shot/zzz")[0], 404)
        self.assertEqual(self.req("GET", "/", host="attacker.example")[0], 403)


if __name__ == "__main__":
    unittest.main()
