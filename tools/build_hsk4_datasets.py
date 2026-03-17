from __future__ import annotations

import base64
import copy
import json
import re
import subprocess
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
OCR_SCRIPT = ROOT / "tools" / "ocr_pdf.swift"
OCR_IMAGE_SCRIPT = ROOT / "tools" / "ocr_image.swift"
CACHE_DIR = ROOT / ".ocr-cache"
TEMPLATE_FILE = ROOT / "exam-template.json"
OCR_IMAGE_BIN = CACHE_DIR / "ocr-image-bin"
MAGICK_BIN = Path("/Applications/MAMP/Library/bin/magick")
EXAMS = [
    ("h41001", "H41001", "zh-content-1.json"),
    ("h41002", "H41002", "zh-content-2.json"),
    ("h41003", "H41003", "zh-content-3.json"),
    ("h41004", "H41004", "zh-content-4.json"),
    ("h41005", "H41005", "zh-content-5.json"),
]
MANUAL_ANSWER_OVERRIDES = {
    ("H41005", 3): True,
}
KNOWN_TEXT_FIXES = {
    "女孩子什么喜欢小说里的爱情？": "女孩子为什么喜欢小说里的爱情？",
}
GRID_X_CENTERS = [0.25, 0.363, 0.478, 0.591, 0.705]
GRID_Y_CENTERS = {
    "tf": [0.747, 0.728],
    "lmc": [0.664, 0.645, 0.624],
    "llong": [0.560, 0.541, 0.522, 0.504],
    "rfill": [0.365, 0.347],
    "rorder": [0.283, 0.264],
    "rcomp": [0.200, 0.181, 0.162, 0.143],
}


def encode_ans(value):
    text = str(value)
    if isinstance(value, bool):
        text = "true" if value else "false"
    encoded = base64.b64encode(text.encode("utf-8")).decode("utf-8")
    return encoded[::-1]


def strip_page_artifacts(text: str) -> str:
    kept = []
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if "my-hsk.com" in line:
            continue
        if re.match(r"^H\d{5}\s*-\s*\d+$", line):
            continue
        line = re.sub(r"(?<![A-Za-z])I(?=\d)", "1", line)
        line = re.sub(r"(?<![A-Za-z])l(?=\d)", "1", line)
        kept.append(line)
    return "\n".join(kept).strip()


def normalize_inline(text: str) -> str:
    text = strip_page_artifacts(text)
    text = text.replace("．", ".").replace("／", "/")
    text = re.sub(r"\s+", " ", text)
    text = re.sub(r"\s*([，。！？；：、])\s*", r"\1", text)
    text = re.sub(r"\(\s*\)", "（　　）", text)
    text = re.sub(r"（\s*）", "（　　）", text)
    for wrong, right in KNOWN_TEXT_FIXES.items():
        text = text.replace(wrong, right)
    return text.strip()


def normalize_answer_text(text: str) -> str:
    text = strip_page_artifacts(text)
    text = text.replace("．", ".").replace("／", "/")
    text = re.sub(r"\s+", "", text)
    text = re.sub(r"^[,，]+", "", text).strip()
    for wrong, right in KNOWN_TEXT_FIXES.items():
        text = text.replace(wrong, right)
    return text


def normalize_multiline_segment(text: str) -> str:
    lines = []
    for raw_line in strip_page_artifacts(text).splitlines():
        line = raw_line.strip()
        if not line:
            continue
        line = line.replace("．", ".")
        line = re.sub(r"\s+", " ", line)
        if not lines:
            lines.append(line)
            continue
        if re.match(r"^(男：|女：|问：|A：|B：|C：|D：|\*)", line):
            lines.append(line)
            continue
        lines[-1] += line
    text = "\n".join(lines).strip()
    for wrong, right in KNOWN_TEXT_FIXES.items():
        text = text.replace(wrong, right)
    return text


def extract_between(text: str, start: str, end: str | None = None) -> str:
    start_index = text.find(start)
    if start_index == -1:
        raise ValueError(f"Missing marker: {start}")
    start_index += len(start)
    if end is None:
        return text[start_index:].strip()
    end_index = text.find(end, start_index)
    if end_index == -1:
        raise ValueError(f"Missing marker: {end}")
    return text[start_index:end_index].strip()


def extract_between_regex(text: str, start_pattern: str, end_pattern: str | None = None) -> str:
    start_match = re.search(start_pattern, text, re.S)
    if not start_match:
        raise ValueError(f"Missing regex marker: {start_pattern}")
    start_index = start_match.end()
    if end_pattern is None:
        return text[start_index:].strip()
    end_match = re.search(end_pattern, text[start_index:], re.S)
    if not end_match:
        raise ValueError(f"Missing regex marker: {end_pattern}")
    return text[start_index : start_index + end_match.start()].strip()


def extract_numbered_items(text: str) -> dict[int, str]:
    pattern = re.compile(r"(?m)(\d{1,3})[.．,，]\s*")
    matches = list(pattern.finditer(text))
    items = {}
    for idx, match in enumerate(matches):
        qid = int(match.group(1))
        start = match.end()
        end = matches[idx + 1].start() if idx + 1 < len(matches) else len(text)
        items[qid] = text[start:end].strip()
    return items


def split_alternatives(text: str) -> list[str]:
    return [part for part in re.split(r"\s*/\s*", text) if part]


def parse_abcd_options(text: str, start_qid: int, end_qid: int) -> dict[int, list[str]]:
    body = normalize_inline(text)
    pattern = re.compile(
        r"(\d{1,3})[.．]?\s*A\s*(.*?)\s*B\s*(.*?)\s*C\s*(.*?)\s*D\s*(.*?)(?=(?:\s+\d{1,3}[.．])|$)",
        re.S,
    )
    results = {}
    for match in pattern.finditer(body):
        qid = int(match.group(1))
        if start_qid <= qid <= end_qid:
            results[qid] = [normalize_inline(match.group(i)) for i in range(2, 6)]
    return results


def parse_word_bank(text: str) -> list[str]:
    bank = []
    for _, value in re.findall(r"([A-F])\s*([^A-F]+?)(?=(?:\s*[A-F]\s*)|$)", normalize_inline(text)):
        bank.append(normalize_inline(value))
    if len(bank) != 6:
        raise ValueError(f"Expected 6 word-bank entries, got {len(bank)} from: {text}")
    return bank


def levenshtein(a: str, b: str) -> int:
    if a == b:
        return 0
    if not a:
        return len(b)
    if not b:
        return len(a)
    prev = list(range(len(b) + 1))
    for i, ch_a in enumerate(a, start=1):
        curr = [i]
        for j, ch_b in enumerate(b, start=1):
            cost = 0 if ch_a == ch_b else 1
            curr.append(min(curr[-1] + 1, prev[j] + 1, prev[j - 1] + cost))
        prev = curr
    return prev[-1]


def best_substring_match(token: str, answer_core: str) -> str:
    if token in answer_core:
        return token
    best = token
    best_score = (len(token) + 2, 99, 99)
    for size in range(max(1, len(token) - 1), min(len(answer_core), len(token) + 1) + 1):
        for start in range(0, len(answer_core) - size + 1):
            candidate = answer_core[start : start + size]
            dist = levenshtein(token, candidate)
            score = (dist, abs(len(candidate) - len(token)), 0 if len(candidate) == len(token) else 1)
            if score < best_score:
                best = candidate
                best_score = score
    return best if best_score[0] <= 1 else token


def correct_reorder_tokens(tokens: list[str], answer_text: str) -> list[str]:
    answer_core = re.sub(r"[。！？；，、\s]", "", answer_text)
    fixed = []
    for token in tokens:
        norm = re.sub(r"\s+", "", token)
        if not norm:
            continue
        fixed.append(best_substring_match(norm, answer_core))
    return fixed


def run_ocr(pdf_path: Path, cache_path: Path) -> dict:
    if not cache_path.exists():
        CACHE_DIR.mkdir(exist_ok=True)
        completed = subprocess.run(
            ["xcrun", "swift", str(OCR_SCRIPT), str(pdf_path)],
            cwd=ROOT,
            check=True,
            capture_output=True,
            text=True,
        )
        cache_path.write_text(completed.stdout, encoding="utf-8")
    return json.loads(cache_path.read_text(encoding="utf-8"))


def load_exam_ocr(folder: str, code: str) -> tuple[dict, dict, dict]:
    base = ROOT / folder
    test = run_ocr(base / f"{code} test.pdf", CACHE_DIR / f"{code.lower()}-test.json")
    answers = run_ocr(base / f"{code} answers.pdf", CACHE_DIR / f"{code.lower()}-answers.json")
    listening = run_ocr(base / f"{code} listening.pdf", CACHE_DIR / f"{code.lower()}-listening.json")
    return test, answers, listening


def ensure_ocr_image_binary() -> Path:
    CACHE_DIR.mkdir(exist_ok=True)
    if not OCR_IMAGE_BIN.exists() or OCR_IMAGE_BIN.stat().st_mtime < OCR_IMAGE_SCRIPT.stat().st_mtime:
        subprocess.run(
            ["xcrun", "swiftc", str(OCR_IMAGE_SCRIPT), "-o", str(OCR_IMAGE_BIN)],
            cwd=ROOT,
            check=True,
        )
    return OCR_IMAGE_BIN


def render_pdf_page(pdf_path: Path, page_index: int, output_path: Path) -> Path:
    if not output_path.exists():
        output_path.parent.mkdir(exist_ok=True)
        subprocess.run(
            [
                str(MAGICK_BIN),
                "-density",
                "300",
                f"{pdf_path}[{page_index}]",
                "-quality",
                "100",
                str(output_path),
            ],
            cwd=ROOT,
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    return output_path


def ocr_image_file(image_path: Path) -> str:
    binary = ensure_ocr_image_binary()
    completed = subprocess.run(
        [str(binary), str(image_path)],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(completed.stdout)["text"]


def answer_grid_position(qid: int) -> tuple[float, float]:
    if 1 <= qid <= 10:
        offset = qid - 1
        return GRID_X_CENTERS[offset % 5], GRID_Y_CENTERS["tf"][offset // 5]
    if 11 <= qid <= 25:
        offset = qid - 11
        return GRID_X_CENTERS[offset % 5], GRID_Y_CENTERS["lmc"][offset // 5]
    if 26 <= qid <= 45:
        offset = qid - 26
        return GRID_X_CENTERS[offset % 5], GRID_Y_CENTERS["llong"][offset // 5]
    if 46 <= qid <= 55:
        offset = qid - 46
        return GRID_X_CENTERS[offset % 5], GRID_Y_CENTERS["rfill"][offset // 5]
    if 56 <= qid <= 65:
        offset = qid - 56
        return GRID_X_CENTERS[offset % 5], GRID_Y_CENTERS["rorder"][offset // 5]
    if 66 <= qid <= 85:
        offset = qid - 66
        return GRID_X_CENTERS[offset % 5], GRID_Y_CENTERS["rcomp"][offset // 5]
    raise ValueError(f"Unsupported answer-grid qid: {qid}")


def answer_grid_kind(qid: int) -> str:
    if 1 <= qid <= 10:
        return "tf"
    if 11 <= qid <= 25:
        return "lmc"
    if 26 <= qid <= 45:
        return "llong"
    if 46 <= qid <= 55:
        return "rfill"
    if 56 <= qid <= 65:
        return "rorder"
    if 66 <= qid <= 85:
        return "rcomp"
    raise ValueError(f"Unsupported answer-grid qid: {qid}")


def parse_tf_value(raw_text: str) -> bool | None:
    text = normalize_inline(raw_text).upper()
    text = re.sub(r"^\d+[.．,，]?", "", text).strip()
    if not text:
        return None
    return False if "X" in text else True


def parse_answer_token(raw_text: str, qid: int):
    text = normalize_inline(raw_text).upper().replace(" ", "")
    if qid <= 10:
        value = parse_tf_value(text)
        return value
    if 56 <= qid <= 65:
        match = re.search(r"([ABC]{3})", text)
        return match.group(1) if match else None
    match = re.search(r"([A-F])", text)
    return ord(match.group(1)) - ord("A") if match else None


def recover_answer_from_crop(answer_pdf: Path, code: str, qid: int):
    attempts = [
        (1.0, 1.0, 0.0, 0.0),
        (1.2, 1.2, 0.0, 0.0),
        (1.2, 1.2, 0.0, 0.01),
        (1.2, 1.2, 0.0, -0.01),
        (1.2, 1.2, 0.01, 0.0),
        (1.2, 1.2, -0.01, 0.0),
        (1.35, 1.5, 0.0, 0.01),
    ]
    last_text = ""
    for width_scale, height_scale, dx, dy in attempts:
        cropped_text = crop_answer_cell(
            answer_pdf,
            code,
            qid,
            width_scale=width_scale,
            height_scale=height_scale,
            dx=dx,
            dy=dy,
        )
        last_text = cropped_text
        parsed = parse_answer_token(cropped_text, qid)
        if parsed is not None:
            return parsed
    raise ValueError(f"Unable to recover answer for {code} q{qid} from crop OCR: {last_text!r}")


def crop_answer_cell(
    answer_pdf: Path,
    code: str,
    qid: int,
    *,
    width_scale: float = 1.0,
    height_scale: float = 1.0,
    dx: float = 0.0,
    dy: float = 0.0,
) -> str:
    page_png = render_pdf_page(answer_pdf, 0, CACHE_DIR / f"{code.lower()}-answers-p1.png")
    image = Image.open(page_png)
    width, height = image.size
    x_center, y_center = answer_grid_position(qid)
    kind = answer_grid_kind(qid)
    crop_width = int(width * (0.13 if qid >= 56 else 0.11) * width_scale)
    crop_height = int(height * (0.045 if kind == "tf" else 0.032) * height_scale)
    x_px = int(width * (x_center + dx))
    y_px = int(height * (1 - (y_center + dy)))
    left = max(0, x_px - crop_width // 2)
    right = min(width, x_px + crop_width // 2)
    top = max(0, y_px - crop_height // 2)
    bottom = min(height, y_px + crop_height // 2)
    crop = image.crop((left, top, right, bottom))
    crop = crop.resize((crop.width * 4, crop.height * 4))
    crop_path = CACHE_DIR / f"{code.lower()}-answer-q{qid}-{width_scale}-{height_scale}-{dx}-{dy}.png"
    crop.save(crop_path)
    return ocr_image_file(crop_path)


def parse_answer_keys(
    answers_ocr: dict,
    answer_pdf: Path,
    code: str,
) -> tuple[dict[int, object], dict[int, list[str]], dict[int, str]]:
    page1 = strip_page_artifacts(answers_ocr["pages"][0]["text"])
    page2 = strip_page_artifacts(answers_ocr["pages"][1]["text"])
    page1_lines = answers_ocr["pages"][0]["lines"]

    answer_map: dict[int, object] = {}

    in_tf_section = False
    tf_values = []
    for line in page1_lines:
        text = line["text"].strip()
        if text == "第一部分":
            in_tf_section = True
            continue
        if text == "第二部分":
            break
        if not in_tf_section:
            continue
        if re.search(r"\d", text):
            value = parse_tf_value(text)
            tf_values.append(value)
    for qid, value in enumerate(tf_values[:10], start=1):
        if value is not None:
            answer_map[qid] = value

    for raw_num, raw_answer in re.findall(r"(\d{1,3})[.．]\s*([A-Fa-fXxVv/]{1,3})", page1):
        qid = int(raw_num)
        token = raw_answer.upper()
        if 1 <= qid <= 10:
            continue
        elif 56 <= qid <= 65:
            answer_map[qid] = token
        else:
            answer_map[qid] = ord(token) - ord("A")

    alt_reorder: dict[int, list[str]] = {}
    writing_samples: dict[int, str] = {}

    part1 = extract_between(page2, "第一部分", "第二部分")
    for qid, raw_text in extract_numbered_items(part1).items():
        normalized = normalize_answer_text(raw_text)
        if qid < 86 or qid > 95:
            continue
        alternatives = split_alternatives(normalized)
        answer_map[qid] = alternatives[0]
        alt_reorder[qid] = alternatives[1:]

    part2 = extract_between(page2, "第二部分", None).replace("（参考答案）", "")
    for qid, raw_text in extract_numbered_items(part2).items():
        normalized = normalize_answer_text(raw_text)
        if 96 <= qid <= 100:
            writing_samples[qid] = normalized

    for qid in range(1, 86):
        if qid in answer_map:
            continue
        if (code, qid) in MANUAL_ANSWER_OVERRIDES:
            answer_map[qid] = MANUAL_ANSWER_OVERRIDES[(code, qid)]
            continue
        answer_map[qid] = recover_answer_from_crop(answer_pdf, code, qid)

    return answer_map, alt_reorder, writing_samples


def parse_tf_questions(listening_ocr: dict, answer_map: dict[int, object]) -> list[dict]:
    block = "\n".join(strip_page_artifacts(page["text"]) for page in listening_ocr["pages"][:2])
    block = extract_between_regex(block, r"现在开始第\s*1\s*题[:：]", r"\n第二部分")
    pattern = re.compile(r"(?s)(\d{1,2})[.．,，]\s*(.*?)\n\*\s*(.*?)(?=(?:\n\d{1,2}[.．,，])|$)")
    results = []
    for match in pattern.finditer(block):
        qid = int(match.group(1))
        if not 1 <= qid <= 10:
            continue
        audio = normalize_multiline_segment(match.group(2))
        stmt = normalize_inline(match.group(3))
        answer = answer_map[qid]
        results.append(
            {
                "id": qid,
                "audio": audio,
                "stmt": stmt,
                "ans": encode_ans(answer),
                "exp": f"参考答案：{'对' if answer else '错'}。",
            }
        )
    return results


def parse_listening_dialogues(listening_ocr: dict, test_ocr: dict, answer_map: dict[int, object]) -> tuple[list[dict], list[dict]]:
    transcript = "\n".join(strip_page_artifacts(page["text"]) for page in listening_ocr["pages"])
    test_text = "\n".join(strip_page_artifacts(page["text"]) for page in test_ocr["pages"])

    part2_block = extract_between_regex(transcript, r"现在开始第\s*11\s*题[:：]", r"\n第三部分")
    part2_options = parse_abcd_options(test_text, 11, 25)
    dialogue_pattern = re.compile(r"(?s)(\d{1,2})[.．,，]\s*(.*?问：.*?)(?=(?:\n\d{1,2}[.．,，])|$)")
    mc = []
    for match in dialogue_pattern.finditer(part2_block):
        qid = int(match.group(1))
        if not 11 <= qid <= 25:
            continue
        mc.append(
            {
                "id": qid,
                "audio": normalize_multiline_segment(match.group(2)),
                "opts": part2_options[qid],
                "ans": encode_ans(answer_map[qid]),
                "exp": f"正确答案：{'ABCD'[answer_map[qid]]} {part2_options[qid][answer_map[qid]]}",
            }
        )

    part3_options = parse_abcd_options(test_text, 26, 45)
    part3_block = extract_between_regex(transcript, r"现在开始第\s*26\s*题[:：]", r"听力考试现在结束。")

    long_items = []
    individual_block = extract_between_regex(part3_block, r"", r"\n第36\s*到37\s*题是根据下面一段话：")
    for match in dialogue_pattern.finditer(individual_block):
        qid = int(match.group(1))
        if not 26 <= qid <= 35:
            continue
        long_items.append(
            {
                "id": qid,
                "audio": normalize_multiline_segment(match.group(2)),
                "opts": part3_options[qid],
                "ans": encode_ans(answer_map[qid]),
                "exp": f"正确答案：{'ABCD'[answer_map[qid]]} {part3_options[qid][answer_map[qid]]}",
            }
        )

    passage_pattern = re.compile(
        r"(?s)第(\d{1,2})\s*到\s*(\d{1,2})\s*题是根据下面一段话：\n(.*?)(?=(?:\n第\d{1,2}\s*到\d{1,2}\s*题是根据下面一段话：)|$)"
    )
    for passage_match in passage_pattern.finditer(part3_block):
        start_qid = int(passage_match.group(1))
        block = passage_match.group(3).strip()
        first_question = re.search(r"(?m)^(\d{1,2})[.．]\s*", block)
        if not first_question:
            continue
        passage = normalize_multiline_segment(block[: first_question.start()])
        questions_block = block[first_question.start() :]
        for qid, question_text in extract_numbered_items(questions_block).items():
            if not start_qid <= qid <= start_qid + 1:
                continue
            prompt = normalize_inline(question_text)
            long_items.append(
                {
                    "id": qid,
                    "audio": f"{passage}\n问：{prompt}",
                    "opts": part3_options[qid],
                    "ans": encode_ans(answer_map[qid]),
                    "exp": f"正确答案：{'ABCD'[answer_map[qid]]} {part3_options[qid][answer_map[qid]]}",
                }
            )

    return mc, sorted(long_items, key=lambda item: item["id"])


def parse_reading_fill(test_ocr: dict, answer_map: dict[int, object]) -> list[dict]:
    text = "\n".join(strip_page_artifacts(page["text"]) for page in test_ocr["pages"])
    block = extract_between_regex(text, r"第46-50\s*题：选词填空。", r"\n第二部分")
    second_marker = re.search(r"第51-55\s*题：选词填空。", block)
    if not second_marker:
        raise ValueError("Missing reading fill second set marker")
    first_set = block[: second_marker.start()].strip()
    second_set = block[second_marker.end() :].strip()

    def build_set(raw_block: str, q_start: int, q_end: int) -> list[dict]:
        bank_text = extract_between(raw_block, "", "例如：")
        bank = parse_word_bank(bank_text)
        question_text = extract_between(raw_block, "例如：", None)
        items = []
        for qid, raw in extract_numbered_items(question_text).items():
            if not q_start <= qid <= q_end:
                continue
            text_value = normalize_multiline_segment(raw).replace("\n", " ")
            text_value = normalize_inline(text_value)
            answer_idx = answer_map[qid]
            items.append(
                {
                    "id": qid,
                    "text": text_value,
                    "wordBank": bank,
                    "ans": encode_ans(answer_idx),
                    "exp": f"正确答案：{'ABCDEF'[answer_idx]} {bank[answer_idx]}",
                }
            )
        return items

    return build_set(first_set, 46, 50) + build_set(second_set, 51, 55)


def parse_reading_order(test_ocr: dict, answer_map: dict[int, object]) -> list[dict]:
    text = "\n".join(strip_page_artifacts(page["text"]) for page in test_ocr["pages"])
    block = extract_between_regex(text, r"第56-65\s*题：排列顺序。", r"\n第三部分")
    body = normalize_inline(block)
    pattern = re.compile(
        r"(\d{2})[.．]?\s*A\s*(.*?)\s*B\s*(.*?)\s*C\s*(.*?)(?=(?:\s+\d{2}[.．])|$)",
        re.S,
    )
    items = []
    for match in pattern.finditer(body):
        qid = int(match.group(1))
        if not 56 <= qid <= 65:
            continue
        sents = [normalize_inline(match.group(i)) for i in range(2, 5)]
        answer = answer_map[qid]
        items.append(
            {
                "id": qid,
                "sents": sents,
                "labels": ["A", "B", "C"],
                "ans": encode_ans(answer),
                "exp": f"正确顺序：{answer}",
            }
        )
    return items


def parse_reading_comp(test_ocr: dict, answer_map: dict[int, object]) -> list[dict]:
    text = "\n".join(strip_page_artifacts(page["text"]) for page in test_ocr["pages"])
    block = extract_between_regex(text, r"第66-85\s*题：请选出正确答案。", r"\n三、书写")
    items = []

    simple_block = extract_between(block, "", "80-81.")
    simple_pattern = re.compile(
        r"(?s)(\d{2})[.．]\s*(.*?)\n\*\s*(.*?)\s*A\s*(.*?)\s*B\s*(.*?)\s*C\s*(.*?)\s*D\s*(.*?)(?=(?:\n\d{2}[.．])|$)"
    )
    for match in simple_pattern.finditer(simple_block):
        qid = int(match.group(1))
        passage = normalize_multiline_segment(match.group(2)).replace("\n", "")
        question = normalize_inline(match.group(3))
        opts = [normalize_inline(match.group(i)) for i in range(4, 8)]
        answer_idx = answer_map[qid]
        items.append(
            {
                "id": qid,
                "passage": passage,
                "question": question,
                "opts": opts,
                "ans": encode_ans(answer_idx),
                "exp": f"正确答案：{'ABCD'[answer_idx]} {opts[answer_idx]}",
            }
        )

    grouped_block = block
    group_pattern = re.compile(r"(?ms)^(\d{2})-(\d{2})[.．]?\s*(.*?)(?=(?:^\d{2}-\d{2}[.．]?)|\Z)")
    for group_match in group_pattern.finditer(grouped_block):
        start_qid = int(group_match.group(1))
        end_qid = int(group_match.group(2))
        group_body = group_match.group(3).strip()
        raw_lines = [line.strip() for line in group_body.splitlines() if line.strip()]
        question_starts = [
            idx
            for idx in range(len(raw_lines) - 1)
            if not re.match(r"^[A-D]\s*", raw_lines[idx]) and re.match(r"^A\s*", raw_lines[idx + 1])
        ]
        if len(question_starts) != end_qid - start_qid + 1:
            raise ValueError(f"Grouped reading questions mismatch at {start_qid}-{end_qid}")
        passage = normalize_multiline_segment("\n".join(raw_lines[: question_starts[0]])).replace("\n", "")
        for offset, start_idx in enumerate(question_starts):
            qid = start_qid + offset
            end_idx = question_starts[offset + 1] if offset + 1 < len(question_starts) else len(raw_lines)
            question_line = re.sub(r"^[*★大]\s*", "", raw_lines[start_idx]).strip()
            options_text = " ".join(raw_lines[start_idx + 1 : end_idx])
            options_match = re.search(
                r"A\s*(.*?)\s*B\s*(.*?)\s*C\s*(.*?)\s*D\s*(.*)",
                normalize_inline(options_text),
                re.S,
            )
            if not options_match:
                raise ValueError(f"Unable to parse grouped reading options at {qid}")
            question = normalize_inline(question_line)
            opts = [normalize_inline(options_match.group(i)) for i in range(1, 5)]
            answer_idx = answer_map[qid]
            items.append(
                {
                    "id": qid,
                    "passage": passage,
                    "question": question,
                    "opts": opts,
                    "ans": encode_ans(answer_idx),
                    "exp": f"正确答案：{'ABCD'[answer_idx]} {opts[answer_idx]}",
                }
            )

    return sorted(items, key=lambda item: item["id"])


def parse_writing_reorder(
    test_ocr: dict,
    answer_map: dict[int, object],
    alt_reorder: dict[int, list[str]],
) -> list[dict]:
    lines = test_ocr["pages"][14]["lines"]
    grouped: dict[int, list[str]] = {}
    current_qid: int | None = None

    for raw_line in lines:
        text = strip_page_artifacts(raw_line["text"])
        if not text or text.startswith("例如") or text.startswith("那座桥有"):
            continue
        if text in {"三、书写", "第一部分", "第 86-95 题：完成句子。", "800年的", "历史 有了"}:
            continue
        match = re.match(r"^(\d{2})[.．]?\s*(.*)$", text)
        if match:
            current_qid = int(match.group(1))
            grouped.setdefault(current_qid, [])
            rest = match.group(2).strip()
            if rest:
                grouped[current_qid].extend(part for part in re.split(r"\s+", rest) if part)
            continue
        if current_qid is not None:
            grouped[current_qid].extend(part for part in re.split(r"\s+", text) if part)

    items = []
    for qid in range(86, 96):
        tokens = grouped[qid]
        primary = answer_map[qid]
        tokens = correct_reorder_tokens(tokens, primary)
        entry = {
            "id": qid,
            "words": tokens,
            "ans": encode_ans(primary),
            "exp": f"参考答案：{primary}",
        }
        if alt_reorder.get(qid):
            entry["altAnswers"] = alt_reorder[qid]
            entry["exp"] = f"参考答案：{primary}；也可写：{' / '.join(alt_reorder[qid])}"
        items.append(entry)
    return items


def parse_writing_sentence(test_ocr: dict, writing_samples: dict[int, str]) -> list[dict]:
    text = strip_page_artifacts(test_ocr["pages"][15]["text"])
    body = extract_between(text, "第96-100题：看图，用词造句。", None)
    pattern = re.compile(r"(\d{2,3})[.．]\s*([^\d\n]+?)(?=(?:\s+\d{2,3}[.．])|$)")
    prompts = {}
    for match in pattern.finditer(normalize_inline(body)):
        qid = int(match.group(1))
        prompts[qid] = normalize_inline(match.group(2))

    items = []
    for qid in range(96, 101):
        word = prompts[qid]
        sample = writing_samples[qid]
        items.append(
            {
                "id": qid,
                "word": word,
                "hint": f"用“{word}”造一个句子",
                "sample": sample,
                "exp": f"参考答案：{sample}",
            }
        )
    return items


def validate_exam_data(exam_data: dict) -> None:
    expected_counts = {
        ("listening", "tf"): 10,
        ("listening", "mc"): 15,
        ("listening", "long"): 20,
        ("reading", "fill"): 10,
        ("reading", "order"): 10,
        ("reading", "comp"): 20,
        ("writing", "reorder"): 10,
        ("writing", "sentence"): 5,
    }
    all_ids = []
    for (section, part), expected in expected_counts.items():
        items = exam_data[section][part]
        if len(items) != expected:
            raise ValueError(f"{section}.{part} expected {expected}, got {len(items)}")
        all_ids.extend(item["id"] for item in items)
    if sorted(all_ids) != list(range(1, 101)):
        raise ValueError("Question IDs are not complete from 1 to 100")


def build_exam(folder: str, code: str) -> dict:
    test_ocr, answers_ocr, listening_ocr = load_exam_ocr(folder, code)
    answer_map, alt_reorder, writing_samples = parse_answer_keys(
        answers_ocr,
        ROOT / folder / f"{code} answers.pdf",
        code,
    )

    exam_data = {
        "listening": {},
        "reading": {},
        "writing": {},
    }
    exam_data["listening"]["tf"] = parse_tf_questions(listening_ocr, answer_map)
    mc_items, long_items = parse_listening_dialogues(listening_ocr, test_ocr, answer_map)
    exam_data["listening"]["mc"] = mc_items
    exam_data["listening"]["long"] = long_items
    exam_data["reading"]["fill"] = parse_reading_fill(test_ocr, answer_map)
    exam_data["reading"]["order"] = parse_reading_order(test_ocr, answer_map)
    exam_data["reading"]["comp"] = parse_reading_comp(test_ocr, answer_map)
    exam_data["writing"]["reorder"] = parse_writing_reorder(test_ocr, answer_map, alt_reorder)
    exam_data["writing"]["sentence"] = parse_writing_sentence(test_ocr, writing_samples)

    validate_exam_data(exam_data)
    return exam_data


def main() -> None:
    template = json.loads(TEMPLATE_FILE.read_text(encoding="utf-8"))
    for folder, code, output_name in EXAMS:
        content = copy.deepcopy(template)
        content["page"]["title"] = f"HSK 4 模拟考试 - {code} 卷"
        content["page"]["subtitle"] = f"新汉语水平考试（四级）· {code} 卷 · 完整版 100 题"
        content["page"]["footerTitle"] = f"HSK 4 模拟考试 {code}"
        content["examData"] = build_exam(folder, code)
        output_path = ROOT / output_name
        output_path.write_text(
            json.dumps(content, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        print(f"Wrote {output_name}")


if __name__ == "__main__":
    main()
