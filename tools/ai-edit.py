#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""로컬 Ollama에게 파일의 한 구간만 고쳐 달라고 시키는 도구.

index.html / admin.html은 통째로 넘기기엔 너무 커서, 고칠 구간만 잘라 보낸다.
돌아온 코드는 바로 쓰지 않고 검증(중괄호 짝, node --check, div 짝)을 통과한
뒤에야 --apply로 반영한다. 기본은 미리보기(diff)만 출력한다.

  python3 tools/ai-edit.py -f index.html -s 1588 -e 1597 -t "주석을 한 줄로 줄여줘"
  python3 tools/ai-edit.py -f index.html -s 1588 -e 1597 -t "..." --apply
"""
import argparse, difflib, json, os, re, subprocess, sys, tempfile, time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OLLAMA = "http://localhost:11434/api/generate"

SYSTEM = """너는 코드 편집기다. 주어진 코드 조각을 지시대로 고쳐서 돌려준다.

규칙:
- 출력은 오직 ```로 감싼 코드 블록 하나. 설명, 인사, 요약 금지.
- 받은 조각 전체를 고친 상태로 다시 출력한다. 일부만 출력하거나 "..." 로 생략하지 않는다.
- 들여쓰기(공백 개수)를 원본 그대로 유지한다.
- 지시와 무관한 줄은 한 글자도 바꾸지 않는다.
- 변수명·함수명은 지시가 없으면 절대 바꾸지 않는다.
- 주석은 한국어로 쓴다."""

PROMPT = """아래는 {fname} 파일의 {start}~{end}번째 줄이다.

[지시]
{task}

[코드]
```
{code}
```

지시대로 고친 코드 전체를 ``` 코드 블록 하나로만 출력해라."""


def ask(model, prompt, timeout=600):
    body = json.dumps({
        "model": model,
        "prompt": prompt,
        "system": SYSTEM,
        "think": False,           # qwen3의 <think> 장황한 추론을 끈다
        "stream": False,
        "options": {"temperature": 0.1, "num_ctx": 16384},
    }).encode()
    req = urllib.request.Request(OLLAMA, data=body,
                                 headers={"Content-Type": "application/json"})
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=timeout) as r:
        out = json.loads(r.read())
    return out.get("response", ""), time.time() - t0


def extract_code(text):
    # think를 껐어도 모델이 섞어 보내는 경우가 있어 한 번 걷어낸다
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.S)
    blocks = re.findall(r"```[a-zA-Z0-9]*\n(.*?)```", text, flags=re.S)
    if blocks:
        return max(blocks, key=len).rstrip("\n")
    return None


def validate(path, text):
    """검증 결과를 문제 목록으로 돌려준다. 빈 목록이면 통과."""
    problems = []
    if path.endswith(".html"):
        depth_bad = 0
        for m in re.finditer(r"<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>", text, flags=re.S):
            code = m.group(1)
            if code.count("{") != code.count("}"):
                depth_bad += 1
            with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False) as fh:
                fh.write(code)
                tmp = fh.name
            r = subprocess.run(["node", "--check", tmp], capture_output=True, text=True)
            os.unlink(tmp)
            if r.returncode != 0:
                problems.append("구문 오류: " + r.stderr.strip().split("\n")[0])
        if depth_bad:
            problems.append("중괄호 짝이 맞지 않는 script 블록 %d개" % depth_bad)
        if text.count("<div") != text.count("</div>"):
            problems.append("<div> %d개 / </div> %d개" % (text.count("<div"), text.count("</div>")))
    elif path.endswith(".js"):
        with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False) as fh:
            fh.write(text)
            tmp = fh.name
        r = subprocess.run(["node", "--check", tmp], capture_output=True, text=True)
        os.unlink(tmp)
        if r.returncode != 0:
            problems.append("구문 오류: " + r.stderr.strip().split("\n")[0])
    return problems


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("-f", "--file", required=True)
    ap.add_argument("-s", "--start", type=int, required=True, help="시작 줄 (1부터)")
    ap.add_argument("-e", "--end", type=int, required=True, help="끝 줄 (포함)")
    ap.add_argument("-t", "--task", required=True)
    ap.add_argument("-m", "--model", default="qwen3:14b")
    ap.add_argument("--apply", action="store_true", help="검증을 통과하면 실제로 반영")
    ap.add_argument("--retries", type=int, default=2)
    a = ap.parse_args()

    path = a.file if os.path.isabs(a.file) else os.path.join(ROOT, a.file)
    with open(path, encoding="utf-8") as fh:
        lines = fh.read().split("\n")
    if not (1 <= a.start <= a.end <= len(lines)):
        sys.exit("줄 번호가 파일 범위를 벗어남 (파일은 %d줄)" % len(lines))

    region = "\n".join(lines[a.start - 1:a.end])
    prompt = PROMPT.format(fname=os.path.basename(path), start=a.start, end=a.end,
                           task=a.task, code=region)

    for attempt in range(1, a.retries + 2):
        raw, secs = ask(a.model, prompt)
        new_region = extract_code(raw)
        if new_region is None:
            print("[%d회] 코드 블록을 못 찾음 (%.0f초)" % (attempt, secs), file=sys.stderr)
            continue
        if new_region.strip() == region.strip():
            print("[%d회] 바뀐 것이 없음 (%.0f초)" % (attempt, secs), file=sys.stderr)
            continue
        candidate = "\n".join(lines[:a.start - 1] + new_region.split("\n") + lines[a.end:])
        problems = validate(path, candidate)
        if problems:
            print("[%d회] 검증 실패 (%.0f초): %s" % (attempt, secs, "; ".join(problems)), file=sys.stderr)
            continue
        break
    else:
        sys.exit("실패 — %d번 시도했지만 쓸 만한 결과가 없음" % (a.retries + 1))

    diff = difflib.unified_diff(region.split("\n"), new_region.split("\n"),
                                fromfile="%s:%d (원본)" % (a.file, a.start),
                                tofile="%s:%d (Ollama)" % (a.file, a.start),
                                lineterm="", n=3)
    print("\n".join(diff))
    print("\n검증 통과 · %s · %.0f초" % (a.model, secs))

    if a.apply:
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(candidate)
        print("반영함: %s" % a.file)
    else:
        print("미리보기만 함. 반영하려면 --apply")


if __name__ == "__main__":
    main()
