"""시험용 가짜 Codex: 진짜 codex exec 처럼 표준입력으로 프롬프트를 받고, 작업 번호 이벤트를 찍고,
STUDIO_CODEX_IMAGES/<작업 번호>/ 에 PNG 하나를 만든다. FAKE_CODEX_MODE 로 실패 모양을 고른다.
  ok(기본) / fail(종료 코드 1) / noimage(그림 없이 성공) / slow(오래 걸림, 취소 시험용) / login(로그인 오류)
"""
import base64, json, os, sys, time, uuid
from pathlib import Path

root = Path(os.environ["STUDIO_CODEX_IMAGES"])
mode_file = root / "mode.txt"  # 시험이 서버를 다시 켜지 않고 모드를 바꾸게 파일로
mode = mode_file.read_text().strip() if mode_file.exists() else os.environ.get("FAKE_CODEX_MODE", "ok")
prompt = sys.stdin.buffer.read().decode("utf-8")
root.mkdir(parents=True, exist_ok=True)
(root / "last_prompt.txt").write_text(prompt, encoding="utf-8")
(root / "last_args.json").write_text(json.dumps(sys.argv[1:], ensure_ascii=False), encoding="utf-8")
tid = str(uuid.uuid4())
print(json.dumps({"type": "thread.started", "thread_id": tid}), flush=True)
if mode == "slow":
    time.sleep(60)
if mode == "fail":
    print("error: something broke", file=sys.stderr); sys.exit(1)
if mode == "login":
    print("Error: 401 Unauthorized - please login", file=sys.stderr); sys.exit(1)
if mode == "ok":
    folder = root / tid
    folder.mkdir()
    # 1×1 주황 PNG
    png = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==")
    (folder / "exec-fake.png").write_bytes(png)
print(json.dumps({"type": "item.completed", "item": {"type": "agent_message", "text": "done"}}), flush=True)
