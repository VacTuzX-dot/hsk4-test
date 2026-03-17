import json
import base64
import copy
import random
import re


# Base64 encoder/decoder matching the JS behavior
def encode_ans(val):
    s = str(val)
    if isinstance(val, bool):
        s = "true" if val else "false"
    # btoa in JS is base64 encoding
    b64 = base64.b64encode(s.encode("utf-8")).decode("utf-8")
    # reverse it
    return "".join(reversed(b64))


def decode_ans(encoded):
    if not isinstance(encoded, str):
        return encoded
    try:
        b64 = "".join(reversed(encoded))
        decoded = base64.b64decode(b64.encode("utf-8")).decode("utf-8")
        if decoded == "true":
            return True
        if decoded == "false":
            return False
        if decoded.isdigit():
            return int(decoded)
        return decoded
    except Exception:
        return encoded


themes = [
    {
        "name": "business",
        "file": "zh-content-2.json",
        "replacements": {
            "学校": "公司",
            "学生": "员工",
            "老师": "经理",
            "校长": "董事长",
            "考试": "会议",
            "考": "开",
            "学习": "工作",
            "成绩": "业绩",
            "复习": "加班",
            "出国留学": "出国出差",
            "图书": "文件",
            "阅读": "审核",
            "毕业": "升职",
            "大学": "部门",
            "同学": "同事",
            "教育": "管理",
            "教室": "会议室",
        },
    },
    {
        "name": "travel",
        "file": "zh-content-3.json",
        "replacements": {
            "学校": "机场",
            "学生": "旅客",
            "老师": "导游",
            "校长": "机长",
            "考试": "航班",
            "学习": "旅游",
            "成绩": "风景",
            "复习": "休息",
            "出国留学": "出国旅游",
            "图书": "护照",
            "阅读": "游览",
            "毕业": "到达",
            "大学": "航班",
            "同学": "游客",
            "教育": "服务",
            "教室": "候机室",
            "公司": "旅行社",
        },
    },
    {
        "name": "health",
        "file": "zh-content-4.json",
        "replacements": {
            "学校": "医院",
            "学生": "病人",
            "老师": "医生",
            "校长": "院长",
            "考试": "检查",
            "学习": "治疗",
            "成绩": "健康",
            "复习": "吃药",
            "出国留学": "去大医院",
            "图书": "病历",
            "阅读": "休息",
            "毕业": "出院",
            "大学": "病房",
            "同学": "护士",
            "教育": "治疗",
            "教室": "手术室",
            "公司": "诊所",
        },
    },
    {
        "name": "shopping",
        "file": "zh-content-5.json",
        "replacements": {
            "学校": "商场",
            "学生": "顾客",
            "老师": "店长",
            "校长": "老板",
            "考试": "活动",
            "学习": "购物",
            "成绩": "质量",
            "复习": "挑选",
            "出国留学": "买奢侈品",
            "图书": "商品",
            "阅读": "消费",
            "毕业": "结账",
            "大学": "超市",
            "同学": "买家",
            "教育": "打折",
            "教室": "专柜",
            "公司": "店铺",
        },
    },
]


def apply_replacements(text, replacements):
    if not isinstance(text, str):
        return text
    for k, v in replacements.items():
        text = text.replace(k, v)
    return text


def process_tf(q, theme):
    q["audio"] = apply_replacements(q.get("audio", ""), theme["replacements"])
    q["stmt"] = apply_replacements(q.get("stmt", ""), theme["replacements"])
    q["exp"] = apply_replacements(q.get("exp", ""), theme["replacements"])

    current_ans = decode_ans(q["ans"])

    # 50% chance to negate the statement and flip the answer
    if random.choice([True, False]):
        if "不" in q["stmt"]:
            q["stmt"] = q["stmt"].replace("不", "", 1)
        elif "没" in q["stmt"]:
            q["stmt"] = q["stmt"].replace("没", "", 1)
        else:
            # Simple heuristic, just prepend '不' or '没有' before the predicate or at start
            q["stmt"] = (
                "不" + q["stmt"]
                if len(q["stmt"]) < 10
                else q["stmt"].replace("是", "不是", 1)
            )

        current_ans = not current_ans
        q["exp"] = "Statement altered. " + q["exp"]

    q["ans"] = encode_ans(current_ans)


def process_mc(q, theme):
    q["audio"] = apply_replacements(q.get("audio", ""), theme["replacements"])
    if "passage" in q:
        q["passage"] = apply_replacements(q["passage"], theme["replacements"])
    if "question" in q:
        q["question"] = apply_replacements(q["question"], theme["replacements"])
    q["exp"] = apply_replacements(q.get("exp", ""), theme["replacements"])

    if "opts" in q:
        opts = [apply_replacements(o, theme["replacements"]) for o in q["opts"]]
        current_ans_idx = decode_ans(q["ans"])

        if isinstance(current_ans_idx, int) and 0 <= current_ans_idx < len(opts):
            correct_opt = opts[current_ans_idx]
            # Shuffle options
            random.shuffle(opts)
            new_ans_idx = opts.index(correct_opt)
            q["opts"] = opts
            q["ans"] = encode_ans(new_ans_idx)


def process_fill(q, theme, global_word_bank):
    q["text"] = apply_replacements(q.get("text", ""), theme["replacements"])
    q["exp"] = apply_replacements(q.get("exp", ""), theme["replacements"])

    # global_word_bank should be a single list mapped for this sub-section
    # Wait, in the original JSON, wordBank is duplicated for each question in a part!
    # Let's shuffle the wordBank and update ans index
    if "wordBank" in q:
        opts = [apply_replacements(o, theme["replacements"]) for o in q["wordBank"]]
        current_ans_idx = decode_ans(q["ans"])

        if isinstance(current_ans_idx, int) and 0 <= current_ans_idx < len(opts):
            correct_opt = opts[current_ans_idx]
            random.shuffle(opts)
            new_ans_idx = opts.index(correct_opt)
            q["wordBank"] = opts
            q["ans"] = encode_ans(new_ans_idx)


def process_order(q, theme):
    q["sents"] = [
        apply_replacements(s, theme["replacements"]) for s in q.get("sents", [])
    ]
    q["exp"] = apply_replacements(q.get("exp", ""), theme["replacements"])

    current_ans_str = decode_ans(q["ans"])  # e.g. "BAC"
    if isinstance(current_ans_str, str) and len(current_ans_str) == len(q["sents"]):
        # Shuffle the sentences directly!
        combined = list(zip(q["labels"], q["sents"]))
        random.shuffle(combined)

        new_labels, new_sents = zip(*combined)

        # We need to map the old correct order (e.g. BAC) to the new labels.
        # But wait, the standard HSK UI expects labels to ALWAYS be ["A", "B", "C"]
        # So we must keep labels as A, B, C, but the sentences at A, B, C change.

        # Let's find out the original correct sentence sequence.
        orig_sents = q["sents"]  # these are already updated texts
        # the original labels are ["A", "B", "C"]
        # If current_ans_str is "BAC", then correct sentences are orig_sents[1], orig_sents[0], orig_sents[2]

        letter_to_index = {l: i for i, l in enumerate(q["labels"])}
        correct_sent_seq = [q["sents"][letter_to_index[l]] for l in current_ans_str]

        # Now we shuffle the sentences
        random.shuffle(q["sents"])

        # Now what are the new letters for the correct_sent_seq?
        new_sent_to_letter = {s: q["labels"][i] for i, s in enumerate(q["sents"])}

        new_ans_str = "".join([new_sent_to_letter[s] for s in correct_sent_seq])
        q["ans"] = encode_ans(new_ans_str)


def process_reorder(q, theme):
    if "words" in q:
        q["words"] = [apply_replacements(w, theme["replacements"]) for w in q["words"]]
        # Usually answers for reorder are the actual combined string
        current_ans_str = decode_ans(q["ans"])
        if isinstance(current_ans_str, str):
            q["ans"] = encode_ans(
                apply_replacements(current_ans_str, theme["replacements"])
            )
    q["exp"] = apply_replacements(q.get("exp", ""), theme["replacements"])


def process_sentence(q, theme):
    q["word"] = apply_replacements(q.get("word", ""), theme["replacements"])
    q["hint"] = apply_replacements(q.get("hint", ""), theme["replacements"])
    q["sample"] = apply_replacements(q.get("sample", ""), theme["replacements"])
    q["exp"] = apply_replacements(q.get("exp", ""), theme["replacements"])


def main():
    with open("exam-template.json", "r", encoding="utf-8") as f:
        base_data = json.load(f)

    for theme in themes:
        print(f"Generating {theme['file']}...")
        new_data = copy.deepcopy(base_data)

        # Modify title
        new_data["page"]["title"] = apply_replacements(
            new_data["page"]["title"], theme["replacements"]
        )
        new_data["page"]["subtitle"] = (
            apply_replacements(new_data["page"]["subtitle"], theme["replacements"])
            + f" ({theme['name']}版)"
        )

        exam = new_data["examData"]

        for q in exam["listening"]["tf"]:
            process_tf(q, theme)
        for q in exam["listening"]["mc"]:
            process_mc(q, theme)
        for q in exam["listening"]["long"]:
            process_mc(q, theme)

        for q in exam["reading"]["fill"]:
            process_fill(q, theme, None)
        for q in exam["reading"]["order"]:
            process_order(q, theme)
        for q in exam["reading"]["comp"]:
            process_mc(q, theme)

        for q in exam["writing"]["reorder"]:
            process_reorder(q, theme)
        for q in exam["writing"]["sentence"]:
            process_sentence(q, theme)

        file_name = str(theme["file"])
        with open(file_name, "w", encoding="utf-8") as f:
            json.dump(new_data, f, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()
