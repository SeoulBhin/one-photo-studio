"""연출 컷: 3D 캡처를 내 PC 의 Codex CLI 에 넘겨 광고 사진(연출 컷)을 받는다. 한 번에 하나만 돈다.

Codex 는 읽기 전용(-s read-only)·내 설정 파일 무시(--ignore-user-config, MCP 연결이 빠진다)로 부르고
그림 생성만 맡긴다. 프롬프트는 명령줄이 아니라 표준입력으로 넘긴다(윈도의 codex.CMD 는 인자가 cmd.exe 를
거쳐 & | % 같은 글자가 해석될 수 있다). 결과 그림은 Codex 가 작업 번호(thread_id) 이름의 폴더에 만들어 두므로
서버가 그 폴더에서 가져온다 — 따로 돌리는 다른 Codex 작업의 그림과 섞이지 않는다.
"""
import base64
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path

MAX_SCENE = 600            # 장면 글 길이
TIMEOUT = 300              # 초. 보통 1분대
PNG_HEAD = b"\x89PNG\r\n\x1a\n"

FIXED = (
    "첨부한 이미지는 제품 연출 사진의 구도 참조용 3D 캡처다. "
    "카메라 앵글, 제품의 위치와 크기, 제품의 모양과 색, 조명이 들어오는 방향과 그림자 방향을 그대로 유지한 채 "
    "아래 장면의 제품 광고 사진을 이미지 생성 도구로 한 장 만들어라. "
    "실제 브랜드 이름이나 로고는 넣지 않는다. 파일 저장이나 명령 실행은 하지 않는다."
)


class Busy(Exception):
    """이미 연출 컷 하나가 만들어지는 중"""


class CodexMissing(Exception):
    """codex 명령을 찾지 못함"""


def build_prompt(scene):
    scene = (scene or "").strip()[:MAX_SCENE]
    return FIXED + "\n장면: " + (scene or "밝은 회색 스튜디오, 부드러운 조명")


def decode_png(data_url):
    """'data:image/png;base64,...' → PNG 바이트. PNG 가 아니면 ValueError"""
    if not isinstance(data_url, str) or not data_url.startswith("data:image/png;base64,"):
        raise ValueError("PNG 캡처가 아니에요")
    try:
        raw = base64.b64decode(data_url.split(",", 1)[1], validate=True)
    except Exception as e:  # noqa: BLE001
        raise ValueError("캡처를 읽을 수 없어요") from e
    if not raw.startswith(PNG_HEAD):
        raise ValueError("PNG 캡처가 아니에요")
    return raw


def codex_command():
    """실행할 codex. 시험에선 STUDIO_CODEX 로 가짜 Codex(.py)를 끼운다"""
    fake = os.environ.get("STUDIO_CODEX")
    if fake:
        return [sys.executable, fake] if fake.endswith(".py") else [fake]
    exe = shutil.which("codex")
    if not exe:
        raise CodexMissing("codex 명령을 찾지 못했어요. Codex CLI 를 설치하고 로그인해 주세요")
    return [exe]


def images_root():
    if os.environ.get("STUDIO_CODEX_IMAGES"):
        return Path(os.environ["STUDIO_CODEX_IMAGES"])
    home = Path(os.environ.get("CODEX_HOME") or Path.home() / ".codex")
    return home / "generated_images"


def build_args(exe, job_dir):
    return [*exe, "exec", "--skip-git-repo-check", "--ignore-user-config", "-s", "read-only", "--json",
            "-C", str(job_dir), "-", "-i", str(job_dir / "capture.png")]


def find_result(thread_id, since):
    """작업 번호 폴더에서 시작 뒤 생긴 가장 새 PNG"""
    if not thread_id or not re.fullmatch(r"[A-Za-z0-9-]{8,64}", thread_id):
        return None
    folder = images_root() / thread_id
    if not folder.is_dir():
        return None
    pngs = [p for p in folder.glob("*.png") if p.stat().st_mtime >= since - 1]
    return max(pngs, key=lambda p: p.stat().st_mtime) if pngs else None


def human_error(stderr, code):
    text = (stderr or "").strip()
    low = text.lower()
    if "login" in low or "unauthorized" in low or "401" in low:
        return "Codex 로그인이 필요해요. 터미널에서 codex login 을 해 주세요"
    last = text.splitlines()[-1][:200] if text else ""
    return f"Codex 가 실패했어요(종료 코드 {code})" + (f": {last}" if last else "")


def kill_tree(proc):
    if proc.poll() is not None:
        return
    if os.name == "nt":
        # codex.CMD 는 cmd → node 로 이어져 proc.kill() 만으론 node 가 남는다
        subprocess.run(["taskkill", "/T", "/F", "/PID", str(proc.pid)], capture_output=True)
    else:
        proc.kill()


class Job:
    def __init__(self, job_id, folder, scene):
        self.id, self.dir, self.scene = job_id, folder, scene
        self.state, self.error, self.thread_id = "running", None, None
        self.started, self.ended = time.time(), None
        self.proc, self.cancelled = None, False

    def info(self):
        end = self.ended or time.time()
        out = {"id": self.id, "state": self.state, "elapsed": round(end - self.started, 1)}
        if self.error:
            out["error"] = self.error
        return out


class Shots:
    def __init__(self, out_dir, timeout=TIMEOUT):
        self.out = Path(out_dir)
        self.timeout = timeout
        self.lock = threading.Lock()
        self.jobs = {}
        self.current = None

    def start(self, png, scene):
        exe = codex_command()  # 없으면 CodexMissing — 아무것도 만들기 전에
        with self.lock:
            if self.current and self.current.state == "running":
                raise Busy("이미 연출 컷을 만드는 중이에요")
            job_id = time.strftime("%Y%m%d_%H%M%S") + "_" + uuid.uuid4().hex[:6]
            folder = self.out / job_id
            folder.mkdir(parents=True)
            (folder / "capture.png").write_bytes(png)
            job = Job(job_id, folder, scene)
            self.jobs[job_id] = self.current = job
        threading.Thread(target=self._run, args=(job, exe), daemon=True).start()
        return job

    def _run(self, job, exe):
        try:
            job.proc = subprocess.Popen(build_args(exe, job.dir), cwd=job.dir, stdin=subprocess.PIPE,
                                        stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        except OSError as e:
            self._finish(job, "error", f"Codex 를 실행하지 못했어요: {e}")
            return
        proc = job.proc
        assert proc.stdin and proc.stdout and proc.stderr
        if job.cancelled:                # 시작 직전에 취소가 들어온 경우
            kill_tree(proc)
        proc.stdin.write(build_prompt(job.scene).encode("utf-8"))
        proc.stdin.close()
        err = []
        threading.Thread(target=lambda: err.append(proc.stderr.read()), daemon=True).start()
        timer = threading.Timer(self.timeout, lambda: self._timeout(job))
        timer.start()
        with open(job.dir / "codex.jsonl", "wb") as log:
            for line in proc.stdout:
                log.write(line)
                if job.thread_id is None:
                    try:
                        ev = json.loads(line)
                        if ev.get("type") == "thread.started":
                            job.thread_id = ev.get("thread_id")
                    except ValueError:
                        pass
        code = proc.wait()
        timer.cancel()
        if job.state != "running":       # 시간 초과로 이미 끝냄
            return
        if job.cancelled:
            self._finish(job, "cancelled", None)
            return
        stderr = (err[0] if err else b"").decode("utf-8", "replace")
        (job.dir / "codex.stderr.txt").write_text(stderr, encoding="utf-8")
        if code != 0:
            self._finish(job, "error", human_error(stderr, code))
            return
        png = find_result(job.thread_id, job.started)
        if not png:
            self._finish(job, "error", "Codex 가 그림을 만들지 않았어요. 장면 글을 바꿔 다시 해 보세요")
            return
        shutil.copyfile(png, job.dir / "shot.png")
        self._finish(job, "done", None)

    def _timeout(self, job):
        if job.state == "running" and job.proc:
            kill_tree(job.proc)
            self._finish(job, "error", f"{self.timeout // 60}분 안에 끝나지 않아 멈췄어요")

    def _finish(self, job, state, error):
        with self.lock:
            if job.state != "running":
                return
            job.state, job.error, job.ended = state, error, time.time()

    def cancel(self, job_id):
        job = self.jobs.get(job_id)
        if not job or job.state != "running":
            return False
        job.cancelled = True
        if job.proc:
            kill_tree(job.proc)
        return True

    def get(self, job_id):
        return self.jobs.get(job_id) if re.fullmatch(r"[0-9_a-f]{8,40}", job_id or "") else None
