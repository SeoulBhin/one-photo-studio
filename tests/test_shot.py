"""shot.py 단위 시험: python -m unittest tests/test_shot.py

protects: Codex 가 프롬프트를 받기도 전에 이미 꺼져 있어도 작업이 끝나고(error), 다음 요청을 받는다
fails_when: 표준입력 쓰기에서 난 예외로 작업 스레드가 죽어 상태가 영원히 running → 이후 모든 요청이 Busy(409)
no_claim: 진짜 Codex 동작, 서버 요청 검사(test_server.py)
"""
import base64
import os
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import shot  # noqa: E402

PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==")
REAL_POPEN = subprocess.Popen


def exited_popen(args, **kw):
    # 이미 꺼진 프로세스를 돌려준다(잘못된 옵션·로그인 오류로 Codex 가 바로 끝난 상황)
    p = REAL_POPEN([sys.executable, "-c", "import sys; sys.exit(2)"], **kw)
    p.wait()
    return p


class EarlyExitTest(unittest.TestCase):
    def test_job_finishes_and_next_request_is_accepted(self):
        with tempfile.TemporaryDirectory() as tmp:
            os.environ["STUDIO_CODEX"] = str(Path(__file__).with_name("fake_codex.py"))
            os.environ["STUDIO_CODEX_IMAGES"] = str(Path(tmp) / "img")
            shots = shot.Shots(Path(tmp) / "out", timeout=30)
            shot.subprocess.Popen = exited_popen
            try:
                job = shots.start(PNG, "장면")
                t = time.time()
                while job.state == "running" and time.time() - t < 5:
                    time.sleep(0.05)
                self.assertEqual(job.state, "error", "이미 꺼진 Codex 에서 작업이 running 으로 멈춤")
                job2 = shots.start(PNG, "다음")  # Busy 가 나면 실패
                t = time.time()
                while job2.state == "running" and time.time() - t < 5:  # 임시 폴더를 지우기 전에 끝나길 기다림
                    time.sleep(0.05)
            finally:
                shot.subprocess.Popen = REAL_POPEN


if __name__ == "__main__":
    unittest.main()
