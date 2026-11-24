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
sys.path.insert(0, str(ROOT))
import shot  # noqa: E402
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
               "STUDIO_CODEX_IMAGES": str(cls.images), "PYTHONUTF8": "1", "STUDIO_SHOT_TIMEOUT": "6",
               "STUDIO_OUT": str(Path(cls.tmp.name) / "shots")}
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

    def setUp(self):
        # 앞 시험이 남긴 작업이 돌고 있으면 끝날 때까지 기다린다(한 실패가 뒤 시험을 409 로 줄줄이 무너뜨리지 않게)
        for _ in range(100):
            if not any(j.get("state") == "running" for j in self._running()):
                return
            time.sleep(0.1)

    def _running(self):
        shots = Path(self.tmp.name) / "shots"
        out = []
        for d in shots.glob("*") if shots.exists() else []:
            status, body = self.req("GET", f"/api/shot/{d.name}", headers={"X-Studio-Token": self.token})
            if status == 200:
                out.append(json.loads(body))
        return out

    def wait(self, job_id, limit=20):
        t = time.time()
        while time.time() - t < limit:
            info = json.loads(self.req("GET", f"/api/shot/{job_id}", headers={"X-Studio-Token": self.token})[1])
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
        job_dir = Path(self.tmp.name) / "shots" / info["id"]
        work = shot.work_dir(info["id"])
        # 옵션 전체를 그대로 비교한다: 샌드박스 우회 같은 옵션이 끼어들면 바로 실패
        self.assertEqual(args, ["exec", "--skip-git-repo-check", "--ignore-user-config", "-s", "read-only",
                                "-c", "features.experimental_windows_sandbox=true", "-c", "features.elevated_windows_sandbox=true",
                                "--json", "-C", str(work), "-", "-i", str(work / "capture.png")])
        self.assertNotIn(str(ROOT), str(work), "Codex 작업 폴더는 저장소 밖(AGENTS.md 안 읽게)")
        self.assertTrue((job_dir / "codex.jsonl").exists() and (job_dir / "capture.png").exists())
        self.assertEqual(self.req("GET", f"/api/shot/{info['id']}/image")[0], 403, "토큰 없이 결과 조회 막힘")
        self.assertEqual(self.req("GET", f"/api/shot/{info['id']}")[0], 403, "토큰 없이 상태 조회 막힘")
        status, png = self.req("GET", f"/api/shot/{info['id']}/image?t={self.token}")
        self.assertEqual(status, 200)
        self.assertTrue(png.startswith(b"\x89PNG"))
        self.assertEqual(self.req("GET", f"/api/shot/{info['id']}/capture?t={self.token}")[0], 200)

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
        for m, words in (("fail", "something broke"), ("login", "로그인")):
            with self.subTest(m):
                self.mode(m)
                info = self.wait(self.start())
                self.assertEqual(info["state"], "error")
                self.assertIn(words, info["error"])

    def test_06_early_exit_does_not_hang(self):
        # Codex 가 프롬프트를 받기도 전에 꺼져도 작업이 "진행 중"으로 멈추지 않고, 다음 요청을 받는다
        self.mode("early")
        info = self.wait(self.start(), limit=10)
        self.assertEqual(info["state"], "error")
        self.mode("ok")
        self.assertEqual(self.wait(self.start())["state"], "done", "다음 요청이 409 로 막히면 안 됨")

    def test_07_timeout(self):
        self.mode("slow")
        info = self.wait(self.start(), limit=20)
        self.assertEqual(info["state"], "error")
        self.assertIn("안에 끝나지 않아", info["error"])

    def test_08_static_rules_kept(self):
        self.assertEqual(self.req("GET", "/serve.py")[0], 404)
        self.assertEqual(self.req("GET", "/api/shot/zzz")[0], 403, "토큰 없이는 무엇도 안 알려 줌")
        self.assertEqual(self.req("GET", "/", host="attacker.example")[0], 403)


if __name__ == "__main__":
    unittest.main()
