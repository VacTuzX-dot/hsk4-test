// Security helpers
const escapeHTML = (str) => {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
};
const escapeHTMLWithBreaks = (str) => escapeHTML(str).replace(/\r?\n/g, "<br>");
const sanitizePlainText = (value, maxLen = 200) => {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .slice(0, maxLen);
};
const sanitizeUserName = (value) =>
  sanitizePlainText(value, 80).replace(/\s+/g, " ").trim();
const clampInt = (value, min, max, fallback = min) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
};
const isPlainObject = (value) =>
  !!value &&
  typeof value === "object" &&
  Object.prototype.toString.call(value) === "[object Object]";
const STORAGE_KEY = "hsk4_exam_state";
const STORAGE_SIG_SALT = "hsk4_state_sig_20260309";
const MAX_STATE_SIZE = 200000;
const MAX_WRITE_ANSWER_LEN = 180;
const MAX_FREE_ANSWER_LEN = 280;
let _lastMonotonicNow = Date.now();
const monotonicNow = () => {
  const now = Date.now();
  if (now > _lastMonotonicNow) _lastMonotonicNow = now;
  return _lastMonotonicNow;
};
const hashFNV1a = (input) => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash +=
      (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};
const signStatePayload = (payload) =>
  hashFNV1a(`${STORAGE_SIG_SALT}|${JSON.stringify(payload)}`);
const safeRemoveElement = (el) => {
  if (!el) return;
  if (typeof el.remove === "function") {
    el.remove();
    return;
  }
  if (el.parentNode) el.parentNode.removeChild(el);
};
const bindTapEvent = (el, fn) => {
  if (!el) return;
  let touched = false;
  const run = (e) => {
    if (e) e.preventDefault();
    fn();
  };
  el.addEventListener(
    "touchend",
    (e) => {
      touched = true;
      run(e);
      setTimeout(() => {
        touched = false;
      }, 700);
    },
    { passive: false },
  );
  el.addEventListener("click", (e) => {
    if (touched) {
      e.preventDefault();
      return;
    }
    run(e);
  });
};
const decodeAns = (encoded) => {
  if (typeof encoded !== "string") return encoded;
  try {
    const b64 = encoded.split("").reverse().join("");
    const bytes = atob(b64);
    let utf8Bytes = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; ++i) utf8Bytes[i] = bytes.charCodeAt(i);
    const decoded = new window.TextDecoder().decode(utf8Bytes);

    if (decoded === "true") return true;
    if (decoded === "false") return false;
    if (!isNaN(decoded) && decoded.trim() !== "") return Number(decoded);
    return decoded;
  } catch (e) {
    return encoded;
  }
};

// Anti-Inspect Events
document.addEventListener("contextmenu", (e) => e.preventDefault());
document.addEventListener("keydown", (e) => {
  if (
    e.key === "F12" ||
    (e.ctrlKey &&
      e.shiftKey &&
      (e.key === "I" || e.key === "J" || e.key === "C")) ||
    (e.ctrlKey && e.key === "U") ||
    (e.metaKey &&
      e.altKey &&
      (e.key === "i" || e.key === "j" || e.key === "c")) ||
    (e.metaKey && e.altKey && e.key === "u")
  ) {
    e.preventDefault();
  }
});

// HSK 4 exam content and UI strings are loaded from one of the generated datasets.
const LISTENING_AUDIO_TIME = 30 * 60;
const LISTENING_REVIEW_TIME = 3 * 60;
const SECTION_TIME = {
  listening: LISTENING_AUDIO_TIME + LISTENING_REVIEW_TIME,
  reading: 40 * 60,
  writing: 25 * 60,
};
const TIME_PER_Q = { listening: 40, reading: 60, writing: 100 };
const SECTION_LAYOUT = {
  listening: {
    icon: "🎧",
    start: 0,
    end: 45,
    color: "#d32f2f",
    fallbackName: "Listening",
    parts: [
      { from: 0, to: 10, fallbackName: "Part 1" },
      { from: 10, to: 25, fallbackName: "Part 2" },
      { from: 25, to: 45, fallbackName: "Part 3" },
    ],
  },
  reading: {
    icon: "📖",
    start: 45,
    end: 85,
    color: "#d32f2f",
    fallbackName: "Reading",
    parts: [
      { from: 45, to: 55, fallbackName: "Part 1" },
      { from: 55, to: 65, fallbackName: "Part 2" },
      { from: 65, to: 85, fallbackName: "Part 3" },
    ],
  },
  writing: {
    icon: "✍️",
    start: 85,
    end: 100,
    color: "#d32f2f",
    fallbackName: "Writing",
    parts: [
      { from: 85, to: 95, fallbackName: "Part 1" },
      { from: 95, to: 100, fallbackName: "Part 2" },
    ],
  },
};
const createEmptyExamData = () => ({
  listening: { tf: [], mc: [], long: [] },
  reading: { fill: [], order: [], comp: [] },
  writing: { reorder: [], sentence: [] },
});
const ensureArray = (value) => (Array.isArray(value) ? value : []);
const normalizeExamData = (rawData) => {
  const source = isPlainObject(rawData) ? rawData : {};
  const listening = isPlainObject(source.listening) ? source.listening : {};
  const reading = isPlainObject(source.reading) ? source.reading : {};
  const writing = isPlainObject(source.writing) ? source.writing : {};
  return {
    listening: {
      tf: ensureArray(listening.tf),
      mc: ensureArray(listening.mc),
      long: ensureArray(listening.long),
    },
    reading: {
      fill: ensureArray(reading.fill),
      order: ensureArray(reading.order),
      comp: ensureArray(reading.comp),
    },
    writing: {
      reorder: ensureArray(writing.reorder),
      sentence: ensureArray(writing.sentence),
    },
  };
};
let ZH_CONTENT = null;
let HSK4 = normalizeExamData();
let ALL_Q = [];
let QUESTION_BY_ID = new Map();
let CANONICAL_ANSWERS = new Map();
let PART_NAMES = {};
let SECTIONS = {};

const getZhValue = (path, fallback = "") => {
  const parts = Array.isArray(path) ? path : String(path).split(".");
  let current = ZH_CONTENT;
  for (const key of parts) {
    if (!current || typeof current !== "object" || !(key in current)) {
      return fallback;
    }
    current = current[key];
  }
  return current ?? fallback;
};

const setTextById = (id, value) => {
  const el = document.getElementById(id);
  if (el && typeof value === "string") el.textContent = value;
};

const setHTMLById = (id, value) => {
  const el = document.getElementById(id);
  if (el && typeof value === "string") el.innerHTML = value;
};

function buildSectionsConfig(sectionContent = {}) {
  return Object.fromEntries(
    Object.entries(SECTION_LAYOUT).map(([key, layout]) => {
      const localized = isPlainObject(sectionContent[key])
        ? sectionContent[key]
        : {};
      const localizedParts = Array.isArray(localized.parts)
        ? localized.parts
        : [];
      return [
        key,
        {
          name:
            typeof localized.name === "string" && localized.name.trim()
              ? localized.name
              : layout.fallbackName,
          icon: layout.icon,
          start: layout.start,
          end: layout.end,
          time: SECTION_TIME[key],
          color: layout.color,
          parts: layout.parts.map((part, index) => ({
            name:
              typeof localizedParts[index] === "string" &&
              localizedParts[index].trim()
                ? localizedParts[index]
                : part.fallbackName,
            from: part.from,
            to: part.to,
          })),
        },
      ];
    }),
  );
}

function rebuildExamData() {
  const questions = [];
  HSK4.listening.tf.forEach((q) =>
    questions.push({ ...q, section: "listening", part: "tf", type: "tf" }),
  );
  HSK4.listening.mc.forEach((q) =>
    questions.push({ ...q, section: "listening", part: "mc", type: "mc" }),
  );
  HSK4.listening.long.forEach((q) =>
    questions.push({ ...q, section: "listening", part: "long", type: "mc" }),
  );
  HSK4.reading.fill.forEach((q) =>
    questions.push({ ...q, section: "reading", part: "fill", type: "fill" }),
  );
  HSK4.reading.order.forEach((q) =>
    questions.push({ ...q, section: "reading", part: "order", type: "order" }),
  );
  HSK4.reading.comp.forEach((q) =>
    questions.push({ ...q, section: "reading", part: "comp", type: "mc" }),
  );
  HSK4.writing.reorder.forEach((q) =>
    questions.push({
      ...q,
      section: "writing",
      part: "reorder",
      type: "write",
    }),
  );
  HSK4.writing.sentence.forEach((q) =>
    questions.push({
      ...q,
      section: "writing",
      part: "sentence",
      type: "free",
    }),
  );
  ALL_Q = questions;
  QUESTION_BY_ID = new Map(ALL_Q.map((q) => [q.id, q]));
  CANONICAL_ANSWERS = new Map(ALL_Q.map((q) => [q.id, decodeAns(q.ans)]));
}

const getCanonicalAnswer = (qid) => CANONICAL_ANSWERS.get(qid);
const normalizeChineseAnswer = (value) =>
  String(value || "").replace(/[？。！，、\s]/g, "");
const getAcceptedWriteAnswers = (question) => {
  const accepted = [];
  const primary = getCanonicalAnswer(question?.id);
  if (typeof primary === "string" && primary.trim()) accepted.push(primary.trim());
  if (Array.isArray(question?.altAnswers)) {
    question.altAnswers.forEach((alt) => {
      if (typeof alt === "string" && alt.trim()) accepted.push(alt.trim());
    });
  }
  return [...new Set(accepted)];
};
const getAcceptedWriteAnswerText = (question) =>
  getAcceptedWriteAnswers(question).join(" / ");
const isAcceptedWriteAnswer = (question, value) => {
  const normalizedValue = normalizeChineseAnswer(value);
  if (!normalizedValue) return false;
  return getAcceptedWriteAnswers(question).some(
    (answer) => normalizeChineseAnswer(answer) === normalizedValue,
  );
};

const sanitizeAnswerForQuestion = (question, rawValue) => {
  if (!question) return undefined;

  if (question.type === "tf") {
    return typeof rawValue === "boolean" ? rawValue : undefined;
  }

  if (question.type === "mc" || question.type === "fill") {
    const options =
      question.type === "mc"
        ? Array.isArray(question.opts)
          ? question.opts
          : []
        : Array.isArray(question.wordBank)
          ? question.wordBank
          : [];
    const idx = Number(rawValue);
    if (
      Number.isInteger(idx) &&
      idx >= 0 &&
      idx < options.length &&
      options.length > 0
    ) {
      return idx;
    }
    return undefined;
  }

  if (question.type === "order") {
    if (typeof rawValue !== "string") return undefined;
    const labels = Array.isArray(question.labels) ? question.labels : [];
    const normalized = sanitizePlainText(rawValue.toUpperCase(), 10).replace(
      /[^A-Z]/g,
      "",
    );
    if (labels.length === 0 || normalized.length !== labels.length) {
      return undefined;
    }
    const unique = new Set(normalized.split(""));
    if (unique.size !== labels.length) return undefined;
    const allowed = new Set(labels.map((label) => String(label).toUpperCase()));
    if (![...unique].every((ch) => allowed.has(ch))) return undefined;
    return normalized;
  }

  if (question.type === "write") {
    return sanitizePlainText(rawValue, MAX_WRITE_ANSWER_LEN);
  }

  if (question.type === "free") {
    return sanitizePlainText(rawValue, MAX_FREE_ANSWER_LEN);
  }

  return undefined;
};

const sanitizeAnswersObject = (rawAnswers) => {
  const safe = {};
  if (!isPlainObject(rawAnswers)) return safe;
  Object.entries(rawAnswers).forEach(([rawQid, rawValue]) => {
    const qid = Number(rawQid);
    if (!Number.isInteger(qid) || !QUESTION_BY_ID.has(qid)) return;
    const question = QUESTION_BY_ID.get(qid);
    const safeValue = sanitizeAnswerForQuestion(question, rawValue);
    if (safeValue !== undefined) safe[qid] = safeValue;
  });
  return safe;
};

const sanitizeQTimesObject = (rawQTimes) => {
  const safe = {};
  if (!isPlainObject(rawQTimes)) return safe;
  Object.entries(rawQTimes).forEach(([rawQid, rawValue]) => {
    const qid = Number(rawQid);
    if (!Number.isInteger(qid) || !QUESTION_BY_ID.has(qid)) return;
    const question = QUESTION_BY_ID.get(qid);
    const maxSec = SECTION_TIME[question.section] || 3600;
    safe[qid] = clampInt(rawValue, 0, maxSec, 0);
  });
  return safe;
};

const sanitizeSkippedSet = (rawSkipped) => {
  const safe = new Set();
  if (!Array.isArray(rawSkipped)) return safe;
  rawSkipped.forEach((rawQid) => {
    const qid = Number(rawQid);
    if (Number.isInteger(qid) && QUESTION_BY_ID.has(qid)) {
      safe.add(qid);
    }
  });
  return safe;
};

const sanitizeSectionTimesObject = (rawSectionTimes) => {
  const safe = {
    listening: 0,
    reading: 0,
    writing: 0,
  };
  if (!isPlainObject(rawSectionTimes)) return safe;
  ["listening", "reading", "writing"].forEach((sec) => {
    safe[sec] = clampInt(rawSectionTimes[sec], 0, SECTION_TIME[sec], 0);
  });
  return safe;
};

const sanitizeLoadedState = (rawState) => {
  if (!isPlainObject(rawState)) return null;
  const safeSection = ["listening", "reading", "writing"].includes(
    rawState.currentSection,
  )
    ? rawState.currentSection
    : "listening";
  const sec = SECTIONS[safeSection];
  if (!sec || !ALL_Q.length) return null;

  const safeAnswers = sanitizeAnswersObject(rawState.answers);
  const safeQTimes = sanitizeQTimesObject(rawState.qTimes);
  const safeSkipped = sanitizeSkippedSet(rawState.skippedQs);
  const safeSectionTimes = sanitizeSectionTimesObject(rawState.sectionTimes);
  const legacySectionElapsed = clampInt(
    rawState.sectionElapsed,
    0,
    SECTION_TIME[safeSection],
    0,
  );
  safeSectionTimes[safeSection] = Math.max(
    safeSectionTimes[safeSection],
    legacySectionElapsed,
  );

  let safeCurrentIdx = clampInt(
    rawState.currentIdx,
    sec.start,
    sec.end - 1,
    sec.start,
  );
  if (safeSkipped.has(ALL_Q[safeCurrentIdx].id)) {
    let scanIdx = sec.start;
    while (scanIdx < sec.end && safeSkipped.has(ALL_Q[scanIdx].id)) {
      scanIdx++;
    }
    safeCurrentIdx = scanIdx < sec.end ? scanIdx : sec.start;
  }

  let safeHighestIdx = clampInt(
    rawState.highestIdx,
    sec.start,
    sec.end - 1,
    safeCurrentIdx,
  );
  if (safeCurrentIdx > safeHighestIdx) safeHighestIdx = safeCurrentIdx;

  return {
    answers: safeAnswers,
    qTimes: safeQTimes,
    currentIdx: safeCurrentIdx,
    currentSection: safeSection,
    skippedQs: safeSkipped,
    highestIdx: safeHighestIdx,
    userName: sanitizeUserName(rawState.userName),
    sectionTimes: safeSectionTimes,
  };
};

let answers = {};
let qTimes = {};
let currentIdx = 0;
let currentSection = "listening";
let sectionStartTime = monotonicNow();
let qStartTime = monotonicNow();
let timerInterval = null;
let examFinished = false;
let sectionTimes = { listening: 0, reading: 0, writing: 0 };
let skippedQs = new Set();
let highestIdx = 0;
let userName = "";
let listeningReviewNotified = false;

function saveState() {
  if (examFinished) {
    localStorage.removeItem(STORAGE_KEY);
    return;
  }
  if (!ALL_Q.length || !SECTIONS[currentSection] || !ALL_Q[currentIdx]) return;

  const currentSessionElapsed = Math.floor(
    (monotonicNow() - qStartTime) / 1000,
  );
  const sectionElapsed = Math.floor((monotonicNow() - sectionStartTime) / 1000);

  const liveSectionTimes = {
    ...sectionTimes,
    [currentSection]: clampInt(
      sectionTimes[currentSection] + sectionElapsed,
      0,
      SECTION_TIME[currentSection],
      0,
    ),
  };
  const currentQid = ALL_Q[currentIdx].id;
  const mergedQTimes = {
    ...qTimes,
    [currentQid]: clampInt(
      (qTimes[currentQid] || 0) + currentSessionElapsed,
      0,
      SECTION_TIME[currentSection],
      0,
    ),
  };
  const safeAnswers = sanitizeAnswersObject(answers);
  const safeQTimes = sanitizeQTimesObject(mergedQTimes);
  const safeSkippedQs = Array.from(sanitizeSkippedSet(Array.from(skippedQs)));

  const payload = {
    answers: safeAnswers,
    qTimes: safeQTimes,
    currentIdx: clampInt(
      currentIdx,
      SECTIONS[currentSection].start,
      SECTIONS[currentSection].end - 1,
      SECTIONS[currentSection].start,
    ),
    currentSection,
    sectionElapsed: liveSectionTimes[currentSection],
    sectionTimes: liveSectionTimes,
    skippedQs: safeSkippedQs,
    highestIdx: clampInt(
      highestIdx,
      SECTIONS[currentSection].start,
      SECTIONS[currentSection].end - 1,
      currentIdx,
    ),
    userName: sanitizeUserName(userName),
  };
  const wrappedState = {
    v: 2,
    payload,
    sig: signStatePayload(payload),
  };

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(wrappedState));
  } catch (e) {
    console.warn("Failed to persist exam state", e);
  }
}

function loadState() {
  if (!ALL_Q.length) return false;

  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    if (saved.length > MAX_STATE_SIZE) {
      localStorage.removeItem(STORAGE_KEY);
      return false;
    }
    try {
      const parsed = JSON.parse(saved);
      let rawState = parsed;
      let shouldResign = false;

      if (
        isPlainObject(parsed) &&
        parsed.v === 2 &&
        isPlainObject(parsed.payload) &&
        typeof parsed.sig === "string"
      ) {
        const expected = signStatePayload(parsed.payload);
        if (parsed.sig !== expected) {
          console.warn("State signature mismatch. Discarding state.");
          localStorage.removeItem(STORAGE_KEY);
          return false;
        }
        rawState = parsed.payload;
      } else {
        shouldResign = true;
      }

      const state = sanitizeLoadedState(rawState);
      if (!state) {
        localStorage.removeItem(STORAGE_KEY);
        return false;
      }

      answers = state.answers;
      qTimes = state.qTimes;
      currentIdx = state.currentIdx;
      currentSection = state.currentSection;
      skippedQs = new Set(state.skippedQs);
      highestIdx = state.highestIdx;
      userName = state.userName;
      sectionTimes = state.sectionTimes;

      sectionStartTime = monotonicNow() - sectionTimes[currentSection] * 1000;
      qStartTime = monotonicNow();
      listeningReviewNotified =
        currentSection === "listening" &&
        sectionTimes.listening >= LISTENING_AUDIO_TIME;
      if (shouldResign) saveState();
      return true;
    } catch (e) {
      console.error("Failed to load state", e);
      localStorage.removeItem(STORAGE_KEY);
    }
  }
  return false;
}

function applyChineseUi() {
  document.title = getZhValue("page.title", document.title);
  setHTMLById("pageMainTitle", getZhValue("page.mainTitleHtml", ""));
  setTextById("pageMainSubtitle", getZhValue("page.subtitle", ""));
  setTextById(
    "navListeningLabel",
    `🎧 ${getZhValue("page.nav.listening.label", "Listening")}`,
  );
  setTextById(
    "navListeningSub",
    getZhValue("page.nav.listening.sub", "45 questions"),
  );
  setTextById(
    "navReadingLabel",
    `📖 ${getZhValue("page.nav.reading.label", "Reading")}`,
  );
  setTextById(
    "navReadingSub",
    getZhValue("page.nav.reading.sub", "40 questions"),
  );
  setTextById(
    "navWritingLabel",
    `✍️ ${getZhValue("page.nav.writing.label", "Writing")}`,
  );
  setTextById(
    "navWritingSub",
    getZhValue("page.nav.writing.sub", "15 questions"),
  );
  setTextById("footerTitle", getZhValue("page.footerTitle", "HSK 4"));
}

const EXAM_FILE_POOL = [
  "zh-content-1.json",
  "zh-content-2.json",
  "zh-content-3.json",
  "zh-content-4.json",
  "zh-content-5.json",
];

const EXAM_DATASET_KEY = "hsk4_exam_dataset_file";

async function loadChineseContent() {
  let randomFile = localStorage.getItem(EXAM_DATASET_KEY);
  if (!randomFile || !EXAM_FILE_POOL.includes(randomFile)) {
    randomFile =
      EXAM_FILE_POOL[Math.floor(Math.random() * EXAM_FILE_POOL.length)];
    localStorage.setItem(EXAM_DATASET_KEY, randomFile);
  }

  console.log(`Loading Dataset: ${randomFile}`);

  const response = await fetch(randomFile, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to load ${randomFile}: ${response.status}`);
  }
  const content = await response.json();
  if (!isPlainObject(content)) {
    throw new Error(`Invalid ${randomFile} payload`);
  }
  ZH_CONTENT = content;
  HSK4 = normalizeExamData(content.examData);
  PART_NAMES = isPlainObject(content.results?.partNames)
    ? content.results.partNames
    : {};
  SECTIONS = buildSectionsConfig(content.sections);
  rebuildExamData();
  applyChineseUi();
}

function renderBootstrapError(error, title = "เริ่มต้นระบบไม่สำเร็จ") {
  console.error("Bootstrap error", error);
  const page = document.getElementById("page1");
  const detail =
    error && typeof error.message === "string" && error.message.trim()
      ? error.message.trim()
      : "Unknown error";
  const message = `
    <div class="landing-container">
      <div class="landing-card" style="max-width:720px;margin:40px auto;">
        <div class="landing-card-title">${escapeHTML(title)}</div>
        <p style="line-height:1.7;color:#4b5563;">
          ระบบเริ่มต้นหน้าเว็บไม่สำเร็จ กรุณาเปิดผ่าน local server แล้วรีเฟรชหน้าอีกครั้ง
        </p>
        <p style="margin-top:12px;line-height:1.7;color:#991b1b;background:#fff5f5;border:1px solid #fecaca;border-radius:12px;padding:12px 14px;">
          <strong>Error:</strong> <code>${escapeHTML(detail)}</code>
        </p>
      </div>
    </div>
  `;
  if (page) {
    page.innerHTML = message;
    return;
  }
  document.body.innerHTML = message;
}

// ========== Audio Pre-load Cache ==========
const audioCache = new Map(); // text -> Blob[]
let _preloadDone = false;

async function preloadAllAudio() {
  const statusEl = document.getElementById("preloadStatus");
  const barEl = document.getElementById("preloadBar");
  const labelEl = document.getElementById("preloadLabel");
  if (statusEl) statusEl.style.display = "block";

  // Collect all unique audio texts from listening questions
  const audioTexts = [];
  const seen = new Set();
  const allListening = [].concat(
    HSK4.listening.tf || [],
    HSK4.listening.mc || [],
    HSK4.listening.long || [],
  );
  for (const q of allListening) {
    const txt = String(q.audio || q.passage || "").trim();
    if (txt && !seen.has(txt)) {
      seen.add(txt);
      audioTexts.push(txt);
    }
  }

  if (audioTexts.length === 0) {
    if (statusEl) statusEl.style.display = "none";
    return;
  }

  let loaded = 0;
  const total = audioTexts.length;

  try {
    const googleTTS = await import("https://esm.sh/google-tts-api");

    // Preload 3 at a time to avoid overwhelming the network
    for (let i = 0; i < audioTexts.length; i += 3) {
      const batch = audioTexts.slice(i, i + 3);
      await Promise.all(
        batch.map(async (text) => {
          try {
            const results = googleTTS.getAllAudioUrls(text, {
              lang: "zh-CN",
              slow: false,
              host: "https://translate.google.com",
              splitPunct: ",.?!，。？！、",
            });
            const blobs = [];
            for (const r of results) {
              const resp = await fetch(r.url);
              if (resp.ok) {
                blobs.push(await resp.blob());
              }
            }
            if (blobs.length > 0) {
              audioCache.set(text, blobs);
            }
          } catch (e) {
            console.warn("Preload failed for:", text.substring(0, 30), e);
          }
          loaded++;
          const pct = Math.round((loaded / total) * 100);
          if (barEl) barEl.style.width = pct + "%";
          if (labelEl)
            labelEl.innerHTML = `<span class="spinner"></span> กำลังโหลดเสียง ${loaded}/${total}`;
        }),
      );
    }
  } catch (e) {
    console.error("Preload module load error:", e);
  }

  _preloadDone = true;
  if (labelEl) labelEl.innerHTML = "✅ โหลดเสียงครบแล้ว — พร้อมสอบ!";
  if (statusEl) statusEl.classList.add("done");
  if (barEl) barEl.style.width = "100%";
}

// ========== TTS - Youdao ==========
let _ttsSessionId = 0;

function canUseYoudaoVoice() {
  return typeof window.Audio === "function";
}

function hasActiveTextSelection() {
  try {
    const sel =
      typeof window !== "undefined" && window.getSelection
        ? window.getSelection()
        : null;
    if (sel && String(sel).trim().length > 0) return true;

    const el = document.activeElement;
    if (
      el &&
      (el.tagName === "INPUT" || el.tagName === "TEXTAREA") &&
      typeof el.selectionStart === "number" &&
      typeof el.selectionEnd === "number" &&
      el.selectionEnd > el.selectionStart
    ) {
      return true;
    }
  } catch (e) {
    // ignore selection check errors
  }
  return false;
}

function stopTTSPlayback() {
  if (window.__currentAudio) {
    window.__currentAudio.pause();
    window.__currentAudio.currentTime = 0;
    window.__currentAudio = null;
  }
}

// Split long text into chunks to avoid browser cutoff on long utterances
function splitTextForTTS(text) {
  const normalized = String(text || "").trim();
  if (!normalized) return [];

  const MAX_CHUNK = 90;
  if (normalized.length <= MAX_CHUNK) return [normalized];

  const chunks = [];
  const sentences = normalized.split(/(?<=[。！？；.!?\n])/);
  let current = "";

  for (const sent of sentences) {
    if ((current + sent).length > MAX_CHUNK && current.length > 0) {
      chunks.push(current.trim());
      current = sent;
    } else {
      current += sent;
    }
  }
  if (current.trim()) chunks.push(current.trim());

  const pushBounded = (arr, piece) => {
    const safePiece = String(piece || "").trim();
    if (!safePiece) return;
    for (let i = 0; i < safePiece.length; i += MAX_CHUNK) {
      arr.push(safePiece.slice(i, i + MAX_CHUNK));
    }
  };

  const result = [];
  for (const chunk of chunks) {
    if (chunk.length <= MAX_CHUNK) {
      result.push(chunk);
      continue;
    }

    const parts = chunk.split(/(?<=[，、,])/);
    let cur = "";
    for (const p of parts) {
      if ((cur + p).length > MAX_CHUNK && cur.length > 0) {
        pushBounded(result, cur);
        cur = p;
      } else {
        cur += p;
      }
    }
    pushBounded(result, cur);
  }

  return result;
}

// (Removed legacy ResponsiveVoice config/unlock functions)
function playAudioUrl(url, sessionId) {
  return new Promise((resolve) => {
    if (sessionId !== _ttsSessionId) {
      resolve(false);
      return;
    }
    const audio = new Audio(url);
    window.__currentAudio = audio;
    audio.onended = () => resolve(true);
    audio.onerror = () => resolve(false);
    audio.play().catch((e) => {
      console.error("Google TTS Playback Error:", e);
      resolve(false);
    });
  });
}

async function speak(text, force = false, language = "zh") {
  const content = String(text || "").trim();
  if (!content) return;
  if (!force && hasActiveTextSelection()) return;

  primeTTS();
  const sessionId = ++_ttsSessionId;
  stopTTSPlayback();

  // Try playing from pre-loaded cache first
  if (audioCache.has(content)) {
    const blobs = audioCache.get(content);
    for (const blob of blobs) {
      if (sessionId !== _ttsSessionId) break;
      const blobUrl = URL.createObjectURL(blob);
      await playAudioUrl(blobUrl, sessionId);
      URL.revokeObjectURL(blobUrl);
    }
    return;
  }

  // Fallback: load on-demand if not cached
  try {
    const googleTTS = await import("https://esm.sh/google-tts-api");
    const lang = language === "zh" ? "zh-CN" : "th";
    const results = googleTTS.getAllAudioUrls(content, {
      lang: lang,
      slow: false,
      host: "https://translate.google.com",
      splitPunct: ",.?!，。？！、",
    });

    for (let i = 0; i < results.length; i++) {
      if (sessionId !== _ttsSessionId) break;
      await playAudioUrl(results[i].url, sessionId);
    }
  } catch (e) {
    console.error("TTS module load or play error:", e);
  }
}

function primeTTS() {
  // Provide a dummy function to prime TTS if needed.
  // With standard HTML5 Audio, we typically prime by playing inside a user interaction handler.
  if (window.__currentAudio) {
    // Already initialized
  }
}

// Warm up on first user interaction (important on iOS/Android)
["pointerdown", "touchstart", "mousedown", "keydown", "click"].forEach(
  (evt) => {
    document.addEventListener(evt, primeTTS, {
      once: true,
      passive: true,
    });
  },
);

function isListeningReviewMode(elapsedOverride = null) {
  if (currentSection !== "listening") return false;
  const elapsed =
    elapsedOverride === null
      ? Math.floor((monotonicNow() - sectionStartTime) / 1000)
      : elapsedOverride;
  return elapsed >= LISTENING_AUDIO_TIME;
}

// Timer with section locks and timed transitions between parts
function updateTimer() {
  if (examFinished) return;
  const sec = SECTIONS[currentSection];
  const elapsed = Math.floor((monotonicNow() - sectionStartTime) / 1000);
  const inListeningReview = isListeningReviewMode(elapsed);
  let remain = Math.max(0, sec.time - elapsed);
  let timerLabel = getZhValue("ui.timer.remaining", "Time Left");

  if (currentSection === "listening") {
    if (inListeningReview) {
      timerLabel = getZhValue("ui.timer.listeningReview", "Listening Review");
      if (!listeningReviewNotified) {
        listeningReviewNotified = true;
        stopTTSPlayback();
        qStartTime = monotonicNow();
        const partNameEl = document.querySelector(".part-name");
        if (partNameEl) {
          partNameEl.textContent = getZhValue(
            "ui.timer.listeningReviewEditable",
            "Listening Review",
          );
        }
      }
    } else {
      timerLabel = getZhValue("ui.timer.listeningRemaining", "Listening Left");
      remain = Math.max(0, LISTENING_AUDIO_TIME - elapsed);
    }
  }

  const m = Math.floor(remain / 60),
    s = remain % 60;
  const timerEl = document.getElementById("sectionTimer");
  const timerLabelEl = document.getElementById("sectionTimerLabel");
  if (timerLabelEl) {
    timerLabelEl.textContent = timerLabel;
  }
  if (timerEl) {
    timerEl.textContent = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    timerEl.style.color =
      remain < 60 ? "var(--red)" : remain < 180 ? "var(--gold)" : "var(--txt)";
  }
  // Per-question elapsed display
  const avgTime = TIME_PER_Q[currentSection];
  const currentSessionElapsed = Math.floor(
    (monotonicNow() - qStartTime) / 1000,
  );
  const prevElapsed = qTimes[ALL_Q[currentIdx].id] || 0;
  const qElapsed = prevElapsed + currentSessionElapsed;
  const qRatio = avgTime > 0 ? qElapsed / avgTime : 0;
  const tColor =
    qRatio >= 1.5 ? "var(--red)" : qRatio >= 1 ? "var(--gold)" : "var(--green)";

  const qTimerEl = document.getElementById("qTimer");
  if (qTimerEl) {
    qTimerEl.textContent = `${qElapsed}s`;
    qTimerEl.style.color = tColor;
  }
  // Progress bar against suggested time per question
  const qBarEl = document.getElementById("qTimeBar");
  if (qBarEl) {
    qBarEl.style.width = `${Math.max(0, Math.min(100, qRatio * 100))}%`;
    qBarEl.style.background = tColor;
  }

  // Auto finish section when section time runs out
  if (remain <= 0 && !examFinished) {
    finishSection("timeup");
  }
}

function getPartName(idx) {
  const sec = SECTIONS[currentSection];
  for (const p of sec.parts) {
    if (idx >= p.from && idx < p.to) return p.name;
  }
  return "";
}

function isAnsweredValue(value) {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  return true;
}

function getSectionCompletion(secKey = currentSection) {
  const sec = SECTIONS[secKey];
  let answered = 0;
  for (let i = sec.start; i < sec.end; i++) {
    const qId = ALL_Q[i].id;
    if (isAnsweredValue(answers[qId])) answered++;
  }
  const total = sec.end - sec.start;
  return {
    answered,
    total,
    complete: answered === total,
    remaining: total - answered,
  };
}

// Render current question
function renderQuestion() {
  const q = ALL_Q[currentIdx];
  const sec = SECTIONS[currentSection];
  const secStart = sec.start;
  const secEnd = sec.end;
  const qNumInSec = currentIdx - secStart + 1;
  const totalInSec = secEnd - secStart;
  const partName = getPartName(currentIdx);
  const inListeningReview = isListeningReviewMode();
  const displayPartName =
    currentSection === "listening" && inListeningReview
      ? getZhValue("ui.timer.listeningReviewEditable", "Listening Review")
      : partName;
  const sectionCompletion = getSectionCompletion(currentSection);
  const canFinishSection = sectionCompletion.complete;
  const avgTime = TIME_PER_Q[currentSection];
  const qid = Number(q.id);
  const sectionProgress = clampInt((qNumInSec / totalInSec) * 100, 0, 100, 0);
  const safeQid = Number.isInteger(qid) ? qid : 0;

  let h = `<div class="q-card" style="margin-bottom: 20px;">
  <div class="q-header">
    <div class="q-progress-info">
      <span class="section-badge" style="background:${sec.color}20; color:${sec.color}">${escapeHTML(sec.icon)} ${escapeHTML(sec.name)}</span>
      <span class="part-name">${escapeHTML(displayPartName)}</span>
    </div>
    <div class="q-counter">${qNumInSec} / ${totalInSec}</div>
  </div>
  <div class="q-timer-bar" style="background: transparent; padding: 0; margin-bottom: 8px;">
    <div class="timer-item"><span class="timer-label" id="sectionTimerLabel">${escapeHTML(getZhValue("ui.timer.remaining", "Time Left"))}</span><span class="timer-val" id="sectionTimer">--:--</span></div>
    <div class="timer-item"><span class="timer-label">${escapeHTML(getZhValue("ui.timer.questionElapsed", "Question Time"))}</span><span class="timer-val" id="qTimer">0s</span></div>
    <div class="timer-item"><span class="timer-label">${escapeHTML(getZhValue("ui.timer.recommended", "Suggested"))}</span><span class="timer-val">${avgTime}s</span></div>
  </div>
  <div style="height:4px;background:var(--glass);border-radius:2px;margin-bottom:12px;overflow:hidden"><div id="qTimeBar" style="height:100%;border-radius:2px;transition:all .3s;width:100%"></div></div>
  <div class="q-progress-bar" style="margin-bottom: 0;"><div class="q-progress-fill" style="width:${sectionProgress}%;background:var(--red)"></div></div>
</div>`;

  // Question card
  h += `<div class="q-card">`;

  const isListening = q.section === "listening";

  if (q.type === "tf") {
    h += `<div class="q-top"><span class="q-num">${safeQid}</span>`;
    if (isListening) {
      h += `<button class="tts-btn" onclick="speak(ALL_Q[${currentIdx}].audio, true)">${escapeHTML(getZhValue("ui.question.playRecording", "Play Audio"))}</button>`;
    }
    h += `</div>`;
    h += `<div class="audio-text">${escapeHTML(q.audio)}</div>`;
    h += `<div class="q-statement">★ ${escapeHTML(q.stmt)}</div>`;
    h += `<div class="tf-opts">
      <div class="tf-btn${answers[safeQid] === true ? " selected" : ""}" onclick="selectAnswer(${safeQid},true,this)">${escapeHTML(getZhValue("ui.question.trueLabel", "True"))}</div>
      <div class="tf-btn${answers[safeQid] === false ? " selected" : ""}" onclick="selectAnswer(${safeQid},false,this)">${escapeHTML(getZhValue("ui.question.falseLabel", "False"))}</div>
    </div>`;
  } else if (q.type === "mc") {
    const mcOptions = Array.isArray(q.opts) ? q.opts : [];
    const labels = mcOptions.length <= 4 ? "ABCD" : "ABCDEF";
    h += `<div class="q-top"><span class="q-num">${safeQid}</span>`;
    if (isListening) {
      h += `<button class="tts-btn" onclick="speak(ALL_Q[${currentIdx}].audio||ALL_Q[${currentIdx}].passage, true)">${escapeHTML(getZhValue("ui.question.play", "Play"))}</button>`;
    }
    h += `</div>`;
    if (q.audio)
      h += `<div class="audio-text">${escapeHTMLWithBreaks(q.audio)}</div>`;
    if (q.passage) {
      h += `<div class="passage-text">${escapeHTMLWithBreaks(q.passage)}</div>`;
      h += `<div class="q-statement">★ ${escapeHTML(q.question)}</div>`;
    }
    h += `<div class="options">`;
    mcOptions.forEach((o, i) => {
      h += `<div class="opt${answers[safeQid] === i ? " selected" : ""}" onclick="selectAnswer(${safeQid},${i},this)"><span class="opt-label">${labels[i]}</span>${escapeHTML(o)}</div>`;
    });
    h += `</div>`;
  } else if (q.type === "fill") {
    const fillOptions = Array.isArray(q.wordBank) ? q.wordBank : [];
    const labels = "ABCDEF";
    h += `<span class="q-num">${safeQid}</span>`;
    h += `<div class="word-bank">${fillOptions.map((w, i) => `<span class="wb-item">${labels[i]} ${escapeHTML(w)}</span>`).join("")}</div>`;
    h += `<div class="q-text-fill">${escapeHTML(q.text)}</div>`;
    h += `<div class="options">`;
    fillOptions.forEach((w, i) => {
      h += `<div class="opt${answers[safeQid] === i ? " selected" : ""}" onclick="selectAnswer(${safeQid},${i},this)"><span class="opt-label">${labels[i]}</span>${escapeHTML(w)}</div>`;
    });
    h += `</div>`;
  } else if (q.type === "order") {
    const orderSents = Array.isArray(q.sents) ? q.sents : [];
    const orderLabels = Array.isArray(q.labels) ? q.labels : [];
    const cur = sanitizePlainText(answers[safeQid] || "", 10).toUpperCase();
    h += `<span class="q-num">${safeQid}</span>`;
    h += `<div class="order-sents">${orderSents.map((s, i) => `<div class="order-sent"><strong style="color:var(--accent)">${escapeHTML(orderLabels[i])}</strong> ${escapeHTML(s)}</div>`).join("")}</div>`;
    h += `<div class="order-input">
      <span style="color:var(--txt2)">${escapeHTML(getZhValue("ui.question.correctOrder", "Correct Order:"))}</span>
      ${[0, 1, 2]
        .map(
          (
            i,
          ) => `<select onchange="selectOrderAnswer(${safeQid})" class="order-select" data-pos="${i}">
        <option value="">${escapeHTML(getZhValue("ui.question.orderStepPrefix", "Step "))}${i + 1}</option>${orderLabels.map((l) => `<option value="${escapeHTML(l)}"${cur[i] === String(l).toUpperCase() ? " selected" : ""}>${escapeHTML(l)}</option>`).join("")}
      </select>`,
        )
        .join("")}
    </div>`;
  } else if (q.type === "write") {
    const writeWords = Array.isArray(q.words) ? q.words : [];
    const currentValue = sanitizePlainText(
      answers[safeQid] || "",
      MAX_WRITE_ANSWER_LEN,
    );
    h += `<span class="q-num">${safeQid}</span>`;
    h += `<div class="word-bank">${writeWords.map((w) => `<span class="wb-item blue">${escapeHTML(w)}</span>`).join("")}</div>`;
    h += `<input type="text" class="write-input" placeholder="${escapeHTML(getZhValue("ui.question.writePlaceholder", "Write the sentence"))}" maxlength="${MAX_WRITE_ANSWER_LEN}" value="${escapeHTML(currentValue)}" oninput="updateTextAnswer(${safeQid},this.value)">`;
  } else if (q.type === "free") {
    const currentValue = sanitizePlainText(
      answers[safeQid] || "",
      MAX_FREE_ANSWER_LEN,
    );
    h += `<span class="q-num">${safeQid}</span>`;
    h += `<div class="word-highlight">${escapeHTML(q.word)}</div>`;
    h += `<p style="color:var(--txt2);font-size:.9em;margin:8px 0">${escapeHTML(q.hint)}</p>`;
    h += `<textarea class="write-input" rows="2" maxlength="${MAX_FREE_ANSWER_LEN}" placeholder="${escapeHTML(getZhValue("ui.question.freePlaceholder", "Make a sentence"))}" oninput="updateTextAnswer(${safeQid},this.value)">${escapeHTML(currentValue)}</textarea>`;
  }
  h += `</div>`;

  // Navigation buttons
  h += `<div class="nav-buttons">`;
  let prevIdx = currentIdx - 1;
  if (prevIdx >= sec.start) {
    h += `<button class="nav-btn-prev" onclick="goQuestion(${prevIdx})">← ข้อก่อนหน้า</button>`;
  } else {
    h += `<div></div>`;
  }

  let nextIdx = currentIdx + 1;
  if (canFinishSection) {
    h += `<button class="nav-btn-finish" onclick="finishSection()">จบ${escapeHTML(sec.name)} ✓</button>`;
  } else if (nextIdx < sec.end) {
    h += `<button class="nav-btn-next" onclick="goQuestion(${nextIdx})">ข้อถัดไป →</button>`;
  } else {
    h += `<button class="nav-btn-finish" onclick="notifySectionIncomplete()">ตอบให้ครบก่อนจบพาร์ท</button>`;
  }
  h += `</div>`;

  // Question dots
  h += `<div class="q-dots">`;
  for (let i = sec.start; i < sec.end; i++) {
    const qId = ALL_Q[i].id;
    const answered = isAnsweredValue(answers[qId]);
    const active = i === currentIdx;
    const dotCls = active ? " active" : answered ? " answered" : "";

    if (!active) {
      h += `<div class="q-dot${dotCls}" onclick="goQuestion(${i})" style="cursor:pointer" title="ไปยังข้อนี้">${i - sec.start + 1}</div>`;
    } else {
      h += `<div class="q-dot${dotCls}">${i - sec.start + 1}</div>`;
    }
  }
  h += `</div>`;

  document.getElementById("questionArea").innerHTML = h;
  updateTimer();

  // Auto-read question
  let readText = "";
  if (q.audio) readText += q.audio + "。 ";
  if (q.passage) readText += q.passage + "。 ";
  if (q.stmt) readText += q.stmt + "。 ";
  if (q.question) readText += q.question + "。 ";
  if (q.text)
    readText +=
      q.text.replace(/_+/g, getZhValue("ui.question.fillBlank", "blank")) +
      "。 ";
  if (Array.isArray(q.words))
    readText +=
      getZhValue("ui.question.completeSentence", "Complete the sentence:") +
      q.words.join("，") +
      "。 ";
  if (q.word)
    readText +=
      getZhValue("ui.question.makeSentence", "Make a sentence:") +
      q.word +
      "。 ";
  if (Array.isArray(q.sents))
    readText +=
      getZhValue("ui.question.orderSentence", "Sentence order:") +
      q.sents.join("。 ");

  if (readText && q.section === "listening" && !isListeningReviewMode()) {
    speak(readText, true);
  }
}

function updateTextAnswer(qid, value) {
  const qidNum = Number(qid);
  const question = QUESTION_BY_ID.get(qidNum);
  if (!question || (question.type !== "write" && question.type !== "free"))
    return;
  const safeValue = sanitizeAnswerForQuestion(question, value);
  answers[qidNum] = safeValue === undefined ? "" : safeValue;
  saveState();
  syncSectionActionButton();
}

function selectAnswer(qid, val, el) {
  const qidNum = Number(qid);
  const question = QUESTION_BY_ID.get(qidNum);
  const safeValue = sanitizeAnswerForQuestion(question, val);
  if (safeValue === undefined) return;
  answers[qidNum] = safeValue;
  if (el) {
    const parent = el.parentElement;
    parent
      .querySelectorAll(".opt,.tf-btn")
      .forEach((o) => o.classList.remove("selected"));
    el.classList.add("selected");
  }
  saveState();
  syncSectionActionButton();
}

function selectOrderAnswer(qid) {
  const qidNum = Number(qid);
  const question = QUESTION_BY_ID.get(qidNum);
  if (!question || question.type !== "order") return;
  const sels = document.querySelectorAll(".order-select");
  const vals = Array.from(sels).map((s) => s.value);
  if (vals.every((v) => v)) {
    const safeValue = sanitizeAnswerForQuestion(question, vals.join(""));
    if (safeValue === undefined) return;
    answers[qidNum] = safeValue;
    saveState();
    syncSectionActionButton();
  }
}

function notifySectionIncomplete() {
  const progress = getSectionCompletion(currentSection);
  if (progress.complete) {
    finishSection();
    return;
  }
  showInPageAlert(
    `ยังตอบไม่ครบในพาร์ทนี้ เหลืออีก ${progress.remaining} ข้อ (${progress.answered}/${progress.total}) กรุณาทำให้ครบก่อนจบพาร์ท`,
    "รับทราบ",
    "⚠️ ยังตอบไม่ครบ",
  );
}

function syncSectionActionButton() {
  const nav = document.querySelector(".nav-buttons");
  if (!nav) return;

  const actionBtn = nav.querySelector(".nav-btn-next, .nav-btn-finish");
  if (!actionBtn) return;

  const sec = SECTIONS[currentSection];
  const progress = getSectionCompletion(currentSection);
  const atLastQuestion = currentIdx >= sec.end - 1;

  if (progress.complete) {
    actionBtn.className = "nav-btn-finish";
    actionBtn.textContent = `จบ${sec.name} ✓`;
    actionBtn.setAttribute("onclick", "finishSection()");
    return;
  }

  if (atLastQuestion) {
    actionBtn.className = "nav-btn-finish";
    actionBtn.textContent = "ตอบให้ครบก่อนจบพาร์ท";
    actionBtn.setAttribute("onclick", "notifySectionIncomplete()");
    return;
  }

  actionBtn.className = "nav-btn-next";
  actionBtn.textContent = "ข้อถัดไป →";
  actionBtn.setAttribute("onclick", `goQuestion(${currentIdx + 1})`);
}

function goQuestion(idx) {
  if (idx < 0 || idx >= ALL_Q.length) return;
  const sec = SECTIONS[currentSection];
  if (idx < sec.start || idx >= sec.end) return;

  const currentQId = ALL_Q[currentIdx].id;
  const qTime = Math.floor((monotonicNow() - qStartTime) / 1000);
  qTimes[currentQId] = clampInt(
    (qTimes[currentQId] || 0) + qTime,
    0,
    SECTION_TIME[currentSection],
    0,
  );

  currentIdx = idx;
  highestIdx = Math.max(highestIdx, currentIdx);
  qStartTime = monotonicNow();
  saveState();
  renderQuestion();
}

function finishSection(reason = "manual") {
  const now = monotonicNow();
  const secElapsed = Math.floor((now - sectionStartTime) / 1000);

  if (reason === "manual") {
    const progress = getSectionCompletion(currentSection);
    if (!progress.complete) {
      showInPageAlert(
        `ยังตอบไม่ครบในพาร์ทนี้ เหลืออีก ${progress.remaining} ข้อ (${progress.answered}/${progress.total}) กรุณาทำให้ครบก่อนจบพาร์ท`,
        "รับทราบ",
        "⚠️ ยังตอบไม่ครบ",
      );
      return;
    }
  }

  stopTTSPlayback();
  const qTime = Math.floor((now - qStartTime) / 1000);
  qTimes[ALL_Q[currentIdx].id] = clampInt(
    (qTimes[ALL_Q[currentIdx].id] || 0) + qTime,
    0,
    SECTION_TIME[currentSection],
    0,
  );
  sectionTimes[currentSection] = clampInt(
    secElapsed,
    0,
    SECTION_TIME[currentSection],
    0,
  );

  const order = ["listening", "reading", "writing"];
  const curI = order.indexOf(currentSection);

  if (curI < 2) {
    // Move to next section
    const nextSec = order[curI + 1];
    currentSection = nextSec;
    currentIdx = SECTIONS[nextSec].start;
    sectionStartTime = now;
    qStartTime = now;
    saveState();
    updateSectionNav();
    renderQuestion();
    window.scrollTo({ top: 0, behavior: "smooth" });
  } else {
    // Writing finished
    clearInterval(timerInterval);
    if (reason === "timeup") {
      examFinished = true;
      saveState();
      showResults();
    } else {
      showSubmitConfirmation();
    }
  }
}

function showSubmitConfirmation() {
  // Count stats per section
  const sectionNames = {
    listening: "🎧 การฟัง",
    reading: "📖 การอ่าน",
    writing: "✍️ การเขียน",
  };
  let answeredCount = 0,
    unansweredCount = 0,
    skippedCount = 0;
  const secStats = {};
  ["listening", "reading", "writing"].forEach((sec) => {
    const s = SECTIONS[sec];
    let ans = 0,
      unans = 0,
      skip = 0;
    for (let i = s.start; i < s.end; i++) {
      const qId = ALL_Q[i].id;
      if (skippedQs.has(qId)) {
        skip++;
      } else if (answers[qId] !== undefined && answers[qId] !== "") {
        ans++;
      } else {
        unans++;
      }
    }
    secStats[sec] = { ans, unans, skip, total: s.end - s.start };
    answeredCount += ans;
    unansweredCount += unans;
    skippedCount += skip;
  });

  const overlay = document.createElement("div");
  overlay.className = "submit-overlay";
  overlay.id = "submitOverlay";
  overlay.innerHTML = `
          <div class="submit-modal">
            <h3>📋 ยืนยันส่งคำตอบ</h3>
            <p style="color:var(--txt2);margin-bottom:12px;line-height:1.6">ตรวจสอบสรุปคำตอบก่อนส่ง — เมื่อส่งแล้วจะไม่สามารถแก้ไขได้</p>
            <div class="submit-summary-grid">
              <div class="submit-stat"><div class="num" style="color:var(--green)">${answeredCount}</div><div class="lbl">✅ ตอบแล้ว</div></div>
              <div class="submit-stat"><div class="num" style="color:var(--gold)">${unansweredCount}</div><div class="lbl">⚠️ ยังไม่ตอบ</div></div>
              <div class="submit-stat"><div class="num" style="color:var(--red)">${skippedCount}</div><div class="lbl">⏭️ ถูกข้าม (หมดเวลา)</div></div>
            </div>
            <table style="width:100%;border-collapse:collapse;margin:12px 0;font-size:0.88em">
              <tr style="background:#f8f9fa">
                <th style="padding:8px;text-align:left;font-weight:600">ส่วน</th>
                <th style="padding:8px;text-align:center;font-weight:600">ตอบแล้ว</th>
                <th style="padding:8px;text-align:center;font-weight:600">ยังไม่ตอบ</th>
                <th style="padding:8px;text-align:center;font-weight:600">ถูกข้าม</th>
              </tr>
              ${["listening", "reading", "writing"]
                .map(
                  (sec) => `<tr>
                <td style="padding:8px">${sectionNames[sec]}</td>
                <td style="padding:8px;text-align:center;color:var(--green);font-weight:700">${secStats[sec].ans}/${secStats[sec].total}</td>
                <td style="padding:8px;text-align:center;color:${secStats[sec].unans > 0 ? "var(--gold)" : "var(--txt2)"};font-weight:${secStats[sec].unans > 0 ? "700" : "400"}">${secStats[sec].unans}</td>
                <td style="padding:8px;text-align:center;color:${secStats[sec].skip > 0 ? "var(--red)" : "var(--txt2)"}">${secStats[sec].skip}</td>
              </tr>`,
                )
                .join("")}
            </table>
            ${unansweredCount > 0 ? `<div class="submit-warning">⚠️ คุณยังมีข้อที่ยังไม่ได้ตอบอีก <strong>${unansweredCount} ข้อ</strong> ข้อที่ไม่ตอบจะถูกนับเป็นคำตอบผิด</div>` : ""}
            <button class="btn-submit-final confirm" onclick="confirmSubmit()">📤 ส่งคำตอบสุดท้าย</button>
            <button class="btn-submit-final cancel" onclick="cancelSubmit()">← ตรวจสอบอีกครั้ง</button>
          </div>
        `;
  document.body.appendChild(overlay);
}

function confirmSubmit() {
  document.getElementById("submitOverlay").remove();
  examFinished = true;
  saveState();
  showResults();
}

function cancelSubmit() {
  document.getElementById("submitOverlay").remove();
  // Resume the timer and go back to writing section
  timerInterval = setInterval(() => {
    updateTimer();
    if (Math.floor(monotonicNow() / 1000) % 5 === 0) saveState();
  }, 1000);
  // Reset qStartTime for the current question
  qStartTime = monotonicNow();
  sectionStartTime = monotonicNow() - sectionTimes[currentSection] * 1000;
  renderQuestion();
}

function updateSectionNav() {
  const order = ["listening", "reading", "writing"];
  const btns = document.querySelectorAll(".sec-nav-btn");
  btns.forEach((btn, i) => {
    const curI = order.indexOf(currentSection);
    btn.classList.remove("active", "completed", "locked");
    if (i < curI) btn.classList.add("completed");
    else if (i === curI) btn.classList.add("active");
    else btn.classList.add("locked");
  });
}

// Helper: get difficulty label for a question index
function getDifficulty(q) {
  if (q.part === "tf") return { label: "ง่าย", cls: "diff-easy" };
  if (q.part === "mc") return { label: "ปานกลาง", cls: "diff-medium" };
  if (q.part === "long") return { label: "ยาก", cls: "diff-hard" };
  if (q.part === "fill") return { label: "ง่าย", cls: "diff-easy" };
  if (q.part === "order") return { label: "ปานกลาง", cls: "diff-medium" };
  if (q.part === "comp") return { label: "ปานกลาง", cls: "diff-medium" };
  if (q.part === "reorder") return { label: "ยาก", cls: "diff-hard" };
  if (q.part === "sentence") return { label: "ยาก", cls: "diff-hard" };
  return { label: "ปานกลาง", cls: "diff-medium" };
}

// Helper: Thai explanation of why user's answer is wrong for MC/TF
function getWhyWrongThai(q, userAns) {
  if (q.type === "tf") {
    if (userAns === undefined || userAns === null) return "คุณไม่ได้ตอบข้อนี้";
    return userAns
      ? 'คุณตอบ "ถูก" แต่ข้อความไม่ตรงกับเนื้อหาที่ให้'
      : 'คุณตอบ "ผิด" แต่ข้อความตรงกับเนื้อหาที่ให้จริง';
  }
  if (q.type === "mc" || q.type === "fill") {
    if (userAns === undefined || userAns === null) return "คุณไม่ได้เลือกคำตอบ";
    const optsArr = Array.isArray(q.opts)
      ? q.opts
      : Array.isArray(q.wordBank)
        ? q.wordBank
        : [];
    const labels = Array.isArray(q.opts) ? "ABCD" : "ABCDEF";
    const safeIdx = Number(userAns);
    const picked =
      Number.isInteger(safeIdx) && optsArr[safeIdx] !== undefined
        ? sanitizePlainText(optsArr[safeIdx], 120)
        : "-";
    return `คุณเลือก ${labels[safeIdx] || "?"} "${picked}" ซึ่งไม่ถูกต้อง`;
  }
  if (q.type === "order") {
    if (!userAns) return "คุณไม่ได้เรียงลำดับ";
    return `คุณเรียง "${userAns}" ซึ่งลำดับไม่ถูกต้อง`;
  }
  if (q.type === "write") {
    if (!userAns) return "คุณไม่ได้เขียนคำตอบ";
    const uaStr = (userAns || "").trim();
    if (!isAcceptedWriteAnswer(q, uaStr))
      return "ประโยคที่เขียนยังเรียงคำไม่ถูกต้อง (ผิดไวยากรณ์/ความหมายเปลี่ยน)";
    if (/[.?!]$/.test(uaStr))
      return "กรุณาใช้เครื่องหมายจบประโยคของภาษาจีน (。！？) เท่านั้น ห้ามใช้ของภาษาอังกฤษ";
    if (!/[。？！]$/.test(uaStr))
      return "ประโยคต้องจบด้วยเครื่องหมายวรรคตอนภาษาจีน (。！？)";
    return "คำตอบไม่ถูกต้อง";
  }
  if (q.type === "free") {
    if (!userAns) return "คุณไม่ได้เขียนคำตอบ";
    const uaStr = (userAns || "").trim();
    const keyword = q.word || "";
    if (!uaStr.includes(keyword))
      return `คุณไม่ได้ใช้คำศัพท์บังคับ "${keyword}" ในประโยค`;
    if (uaStr.length < keyword.length + 4)
      return "ประโยคสั้นเกินไปและยังไม่สมบูรณ์ตามหลักไวยากรณ์ (ต้องมีประธาน กริยา กรรม)";
    if (/[.?!]$/.test(uaStr))
      return "กรุณาใช้เครื่องหมายจบประโยคของภาษาจีน (。！？) เท่านั้น";
    if (!/[。？！]$/.test(uaStr))
      return "ประโยคต้องจบด้วยเครื่องหมายวรรคตอนภาษาจีน (。！？)";
    return "ประโยคไม่ผ่านเกณฑ์การให้คะแนน";
  }
  return "คำตอบไม่ถูกต้อง";
}

// Results
function showResults() {
  let listenC = 0,
    readC = 0,
    writeC = 0;
  let listenT = 45,
    readT = 40,
    writeT = 15;
  let listenTimes = [],
    readTimes = [],
    writeTimes = [];
  // Part-level stats
  const partStats = {};

  ALL_Q.forEach((q) => {
    const ua = answers[q.id];
    const qt = qTimes[q.id] || 0;
    let correct = false;

    const cAns = getCanonicalAnswer(q.id);
    if (q.type === "tf") correct = ua === cAns;
    else if (q.type === "mc" || q.type === "fill") correct = ua === cAns;
    else if (q.type === "order") correct = ua === cAns;
    else if (q.type === "write") {
      const uaStr = (ua || "").trim();
      const isCharsMatch = isAcceptedWriteAnswer(q, uaStr);
      const endsWithPunc = /[。？！]$/.test(uaStr);
      const endsWithEnglishPunc = /[.?!]$/.test(uaStr);
      correct = isCharsMatch && endsWithPunc && !endsWithEnglishPunc;
    } else if (q.type === "free") {
      const uaStr = (ua || "").trim();
      const keyword = q.word || "";
      const hasKeyword = uaStr.includes(keyword);
      const endsWithPunc = /[。？！]$/.test(uaStr);
      const endsWithEnglishPunc = /[.?!]$/.test(uaStr);
      const isLongEnough = uaStr.length >= keyword.length + 4;
      const isChinese = /[\u4e00-\u9fa5]/.test(uaStr);
      correct =
        hasKeyword &&
        endsWithPunc &&
        !endsWithEnglishPunc &&
        isLongEnough &&
        isChinese;
    }

    // Track part stats
    const partKey = q.section + "_" + q.part;
    if (!partStats[partKey])
      partStats[partKey] = {
        correct: 0,
        total: 0,
        section: q.section,
        part: q.part,
      };
    partStats[partKey].total++;
    if (correct) partStats[partKey].correct++;

    if (q.section === "listening") {
      if (correct) listenC++;
      listenTimes.push(qt);
    } else if (q.section === "reading") {
      if (correct) readC++;
      readTimes.push(qt);
    } else {
      if (correct) writeC++;
      writeTimes.push(qt);
    }

    showQuestionResult(q, ua, correct);
  });

  // === Official HSK4 300-point scoring ===
  const listenScore = Math.round((listenC / listenT) * 100);
  const readScore = Math.round((readC / readT) * 100);
  const writeScore = Math.round((writeC / writeT) * 100);
  const totalScore = listenScore + readScore + writeScore;
  const passed = totalScore >= 180;

  // Grade bands
  let gradeLabel, gradeEmoji;
  if (totalScore >= 270) {
    gradeLabel = `ดีเยี่ยม (${getZhValue("results.gradeBands.excellent", "Excellent")})`;
    gradeEmoji = "🏅";
  } else if (totalScore >= 240) {
    gradeLabel = `ดีมาก (${getZhValue("results.gradeBands.good", "Good")})`;
    gradeEmoji = "🥇";
  } else if (totalScore >= 210) {
    gradeLabel = `ดี (${getZhValue("results.gradeBands.passPlus", "Pass+")})`;
    gradeEmoji = "🥈";
  } else if (totalScore >= 180) {
    gradeLabel = `ผ่าน (${getZhValue("results.gradeBands.pass", "Pass")})`;
    gradeEmoji = "🥉";
  } else {
    gradeLabel = `ไม่ผ่าน (${getZhValue("results.gradeBands.fail", "Fail")})`;
    gradeEmoji = "📕";
  }

  const totalC = listenC + readC + writeC;
  const pct = Math.round((totalC / 100) * 100);
  const avgListen = listenTimes.length
    ? Math.round(listenTimes.reduce((a, b) => a + b, 0) / listenTimes.length)
    : 0;
  const avgRead = readTimes.length
    ? Math.round(readTimes.reduce((a, b) => a + b, 0) / readTimes.length)
    : 0;
  const avgWrite = writeTimes.length
    ? Math.round(writeTimes.reduce((a, b) => a + b, 0) / writeTimes.length)
    : 0;
  const totalTime = Object.values(sectionTimes).reduce((a, b) => a + b, 0);
  const totalMin = Math.floor(totalTime / 60),
    totalSec = totalTime % 60;

  const listenPct = Math.round((listenC / listenT) * 100);
  const readPct = Math.round((readC / readT) * 100);
  const writePct = Math.round((writeC / writeT) * 100);
  const skippedCount = skippedQs.size;

  // Enhanced Thai strengths & improvements
  let strengths = [],
    improvements = [];

  // Listening analysis
  if (listenPct >= 80)
    strengths.push(
      "🎧 ทักษะการฟังดีเยี่ยม — จับใจความสำคัญได้แม่นยำ สามารถเข้าใจบทสนทนาและเรื่องสั้นได้ดี",
    );
  else if (listenPct >= 60)
    strengths.push(
      "🎧 ทักษะการฟังอยู่ในเกณฑ์ผ่าน — ยังมีจุดที่พัฒนาได้ เน้นฟังคำสำคัญและตัวเลข",
    );
  else
    improvements.push(
      "🎧 ทักษะการฟังต้องเสริม — แนะนำฟังพอดแคสต์จีน, ดูซีรีส์จีนซับจีน, ฝึกจับใจความจากบทสนทนาสั้น",
    );

  // Reading analysis
  if (readPct >= 80)
    strengths.push(
      "📖 ทักษะการอ่านแข็งแกร่ง — เข้าใจเนื้อหาบทความและจับรายละเอียดได้ดี",
    );
  else if (readPct >= 60)
    strengths.push(
      "📖 ทักษะการอ่านอยู่ในเกณฑ์ผ่าน — ควรเสริมด้วยการอ่านบทความสั้นเพิ่มเติม",
    );
  else
    improvements.push(
      "📖 ทักษะการอ่านต้องพัฒนา — แนะนำอ่านบทความสั้นระดับ HSK4 ทุกวัน ฝึกหาคำตอบจากเนื้อหาอย่างรวดเร็ว",
    );

  // Writing analysis
  if (writePct >= 70)
    strengths.push(
      "✍️ ทักษะการเขียนดีมาก — เข้าใจโครงสร้างประโยคจีนและใช้ไวยากรณ์ได้ถูกต้อง",
    );
  else if (writePct >= 50)
    strengths.push(
      `✍️ ทักษะการเขียนอยู่ในเกณฑ์พอใช้ — ทบทวนโครงสร้าง ${getZhValue("results.writingTerms.fair", "Chinese writing structures")}`,
    );
  else
    improvements.push(
      `✍️ ทักษะการเขียนต้องเสริม — ฝึกเขียนประโยคจีนทุกวัน ทบทวน ${getZhValue("results.writingTerms.improve", "Chinese writing structures")}`,
    );

  // Time management
  if (avgListen <= 30)
    strengths.push(
      "⏱️ ตอบข้อฟังเร็วมาก (เฉลี่ย " +
        avgListen +
        " วิ/ข้อ) — จับประเด็นได้รวดเร็ว",
    );
  else if (avgListen <= 40)
    strengths.push(
      "⏱️ ความเร็วการฟังอยู่ในเกณฑ์ดี (เฉลี่ย " + avgListen + " วิ/ข้อ)",
    );
  else if (avgListen > 50)
    improvements.push(
      "⏱️ ตอบข้อฟังช้าเกินไป (เฉลี่ย " +
        avgListen +
        " วิ/ข้อ, แนะนำ ≤40 วิ) — ฝึกตัดสินใจเร็วขึ้น",
    );

  if (avgRead <= 45)
    strengths.push(
      "⏱️ ความเร็วการอ่านดีเยี่ยม (เฉลี่ย " + avgRead + " วิ/ข้อ)",
    );
  else if (avgRead > 75)
    improvements.push(
      "⏱️ ตอบข้ออ่านช้าเกินไป (เฉลี่ย " +
        avgRead +
        " วิ/ข้อ, แนะนำ ≤60 วิ) — ฝึก skimming เพื่อหาคำตอบเร็วขึ้น",
    );

  // Part-specific feedback
  Object.entries(partStats).forEach(([key, ps]) => {
    const pPct = Math.round((ps.correct / ps.total) * 100);
    const pName = PART_NAMES[key] || key;
    if (pPct <= 40 && ps.total >= 5) {
      improvements.push(
        `📌 ส่วน ${pName}: ตอบถูกเพียง ${ps.correct}/${ps.total} (${pPct}%) — ควรฝึกส่วนนี้เพิ่มเป็นพิเศษ`,
      );
    } else if (pPct >= 90 && ps.total >= 5) {
      strengths.push(
        `📌 ส่วน ${pName}: ตอบถูก ${ps.correct}/${ps.total} (${pPct}%) — ยอดเยี่ยม!`,
      );
    }
  });

  if (!strengths.length)
    strengths.push(
      "👏 สำเร็จ! ทำข้อสอบ HSK4 ครบทุกข้อ — การลงมือทำคือก้าวแรกที่ดี สู้ต่อไป!",
    );
  if (!improvements.length)
    improvements.push(
      "📈 ผลรวมอยู่ในเกณฑ์ดีแล้ว ให้คงความสม่ำเสมอและทบทวนจุดเล็ก ๆ ที่พลาดเพื่อดันคะแนนให้สูงขึ้น",
    );

  // Score ring color
  const color = passed ? "#00c897" : "#ef4444";
  const circ = 2 * Math.PI * 65;
  const off = circ - (totalScore / 300) * circ;
  const scoreGap = Math.max(0, 180 - totalScore);
  const summaryHeadline = passed
    ? "ผ่านเกณฑ์ HSK 4 แล้ว"
    : `ยังไม่ผ่านเกณฑ์ในครั้งนี้ (ขาดอีก ${scoreGap} คะแนน)`;
  const summaryAdvice = passed
    ? "ผลงานโดยรวมดีมาก แนะนำรักษาความแม่นยำในพาร์ตที่ได้ต่ำกว่า 70% เพื่อดันคะแนนรวมให้สูงขึ้นอีก"
    : "โฟกัสพาร์ตที่ได้ต่ำกว่า 60% ก่อน แล้วฝึกชุดสั้นแบบจับเวลา 20-30 นาทีต่อวัน จะเห็นพัฒนาการเร็วขึ้น";

  // Build Skill Analysis table
  let skillHtml = `<div class="skill-analysis"><h4>📊 การวิเคราะห์ตามทักษะ</h4>
        <table class="skill-table">
          <tr><th>ทักษะ</th><th>ถูก/ทั้งหมด</th><th>เปอร์เซ็นต์</th><th>กราฟ</th></tr>`;
  Object.entries(partStats).forEach(([key, ps]) => {
    const pPct = Math.round((ps.correct / ps.total) * 100);
    const pName = PART_NAMES[key] || key;
    const pctCls = pPct >= 70 ? "pct-high" : pPct >= 50 ? "pct-mid" : "pct-low";
    const barColor =
      pPct >= 70 ? "#10b981" : pPct >= 50 ? "#f59e0b" : "#ef4444";
    skillHtml += `<tr>
            <td>${escapeHTML(pName)}</td>
            <td style="text-align:center">${ps.correct}/${ps.total}</td>
            <td style="text-align:center" class="${pctCls}">${pPct}%</td>
            <td><div class="skill-bar-wrap"><div class="skill-bar-fill" style="width:${pPct}%;background:${barColor}"></div></div></td>
          </tr>`;
  });
  skillHtml += `</table></div>`;

  // Score color for each section
  const sColor = (score) =>
    score >= 80 ? "#10b981" : score >= 60 ? "#f59e0b" : "#ef4444";

  document.getElementById("questionArea").innerHTML = `
<div class="results-panel">
  <h2 style="text-align:center;margin-bottom:6px">📊 สรุปผลสอบ HSK 4</h2>
  <h3 style="text-align:center;color:var(--accent);margin-bottom:14px">ผู้เข้าสอบ: ${escapeHTML(document.getElementById("userNameInput").value || "ไม่ระบุชื่อ")}</h3>

  <div class="summary-callout ${passed ? "pass" : "fail"}">
    <strong>${summaryHeadline}</strong><br />
    ${summaryAdvice}
  </div>

  <div class="score-ring"><svg viewBox="0 0 160 160" aria-hidden="true">
    <circle cx="80" cy="80" r="65" fill="none" stroke="var(--glass)" stroke-width="10"/>
    <circle cx="80" cy="80" r="65" fill="none" stroke="${color}" stroke-width="10" stroke-linecap="round" stroke-dasharray="${circ}" stroke-dashoffset="${off}" style="transition:stroke-dashoffset 1.5s ease"/>
  </svg><div class="score-val" style="color:${color}">${totalScore}</div></div>
  <p class="summary-note" style="text-align:center">คะแนนรวม ${totalScore} / 300 คะแนน</p>
  <div style="text-align:center;margin:10px 0">
    <span class="grade-badge ${passed ? "pass" : "fail"}">${passed ? "🏆 ผ่านเกณฑ์" : "❌ ไม่ผ่านเกณฑ์"} (เกณฑ์ผ่าน 180 คะแนน)</span>
  </div>
  <p style="text-align:center;margin-bottom:4px" class="grade-label">${gradeEmoji} ระดับผลสอบ: <strong>${gradeLabel}</strong></p>
  <p class="summary-note" style="text-align:center">เวลาที่ใช้ ${totalMin} นาที ${totalSec} วินาที · ตอบถูก ${totalC}/100 ข้อ${skippedCount > 0 ? " · ถูกข้าม " + skippedCount + " ข้อ" : ""}</p>

  <div class="score-official">
    <div class="score-off-card">
      <div class="sec-label">🎧 การฟัง</div>
      <div class="pts" style="color:${sColor(listenScore)}">${listenScore}</div>
      <div class="max">/ 100 คะแนน</div>
      <div class="section-meta">ตอบถูก ${listenC}/${listenT} ข้อ · เฉลี่ย ${avgListen} วิ/ข้อ</div>
      <div class="bar-wrap"><div class="bar-fill" style="width:${listenScore}%;background:${sColor(listenScore)}"></div></div>
    </div>
    <div class="score-off-card">
      <div class="sec-label">📖 การอ่าน</div>
      <div class="pts" style="color:${sColor(readScore)}">${readScore}</div>
      <div class="max">/ 100 คะแนน</div>
      <div class="section-meta">ตอบถูก ${readC}/${readT} ข้อ · เฉลี่ย ${avgRead} วิ/ข้อ</div>
      <div class="bar-wrap"><div class="bar-fill" style="width:${readScore}%;background:${sColor(readScore)}"></div></div>
    </div>
    <div class="score-off-card">
      <div class="sec-label">✍️ การเขียน</div>
      <div class="pts" style="color:${sColor(writeScore)}">${writeScore}</div>
      <div class="max">/ 100 คะแนน</div>
      <div class="section-meta">ตอบถูก ${writeC}/${writeT} ข้อ · เฉลี่ย ${avgWrite} วิ/ข้อ</div>
      <div class="bar-wrap"><div class="bar-fill" style="width:${writeScore}%;background:${sColor(writeScore)}"></div></div>
    </div>
  </div>

  ${skillHtml}

  <div class="feedback-card strength"><h4 style="color:var(--green)">🌟 จุดแข็งที่ทำได้ดี</h4><ul>${strengths.map((s) => "<li>" + escapeHTML(s) + "</li>").join("")}</ul></div>
  <div class="feedback-card improve"><h4 style="color:var(--red)">📈 จุดที่ควรโฟกัสต่อ</h4><ul>${improvements.map((s) => "<li>" + escapeHTML(s) + "</li>").join("")}</ul></div>

  <div style="text-align:center;margin:20px 0">
    <button class="tts-btn" style="font-size:1em;padding:12px 24px" onclick="speak('รายงานผลสอบ HSK 4 ของคุณ คะแนนรวม ${totalScore} จาก 300 คะแนน คะแนนการฟัง ${listenScore} คะแนน คะแนนการอ่าน ${readScore} คะแนน และคะแนนการเขียน ${writeScore} คะแนน ${passed ? "ยินดีด้วย คุณผ่านเกณฑ์แล้ว" : "ยังไม่ผ่านเกณฑ์ในครั้งนี้ สู้ต่ออีกนิดนะ"}', true, 'th')">🔊 ฟังรายงานผล</button>
  </div>

  <h3 style="margin:30px 0 15px;text-align:center">📝 เฉลยคำตอบโดยละเอียด</h3>

  <div style="margin: 0 auto 20px; max-width: 400px; text-align: center;">
    <input type="text" id="reviewSearchInput" placeholder="🔍 ค้นหาโจทย์, คำตอบ, หรือคำอธิบาย..." style="width:100%; padding:12px 16px; border-radius:12px; border:1px solid #e5e7eb; font-size:1em; outline:none;" onkeyup="filterReviews()">
  </div>

  <div class="review-tabs">
    <button class="rev-tab active" onclick="showReview('listening',this)">🎧 การฟัง (${listenC}/${listenT})</button>
    <button class="rev-tab" onclick="showReview('reading',this)">📖 การอ่าน (${readC}/${readT})</button>
    <button class="rev-tab" onclick="showReview('writing',this)">✍️ การเขียน (${writeC}/${writeT})</button>
  </div>
  <div id="reviewArea"></div>
</div>`;

  showReview("listening", document.querySelector(".rev-tab"));
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function showQuestionResult(q, ua, correct) {
  q._userAns = ua;
  q._correct = correct;
}

function showReview(section, btn) {
  document
    .querySelectorAll(".rev-tab")
    .forEach((t) => t.classList.remove("active"));
  if (btn) btn.classList.add("active");
  const qs = ALL_Q.filter((q) => q.section === section);
  let h = "";
  qs.forEach((q) => {
    const isUnanswered =
      q._userAns === undefined || q._userAns === null || q._userAns === "";
    const isSkipped = skippedQs.has(q.id);
    const icon = isSkipped
      ? "⏭️"
      : isUnanswered
        ? "⚠️"
        : q._correct
          ? "✅"
          : "❌";
    const cls = isSkipped
      ? "wrong"
      : isUnanswered
        ? "wrong"
        : q._correct
          ? "correct"
          : "wrong";
    const diff = getDifficulty(q);
    const safeExp = escapeHTML(q.exp);
    const safeReviewQid = clampInt(q.id, 0, ALL_Q.length, 0);
    const safeReviewTime = clampInt(qTimes[q.id] || 0, 0, 7200, 0);

    h += `<div class="review-card ${cls}">
      <div class="rev-header">
        <span class="q-num">${safeReviewQid}</span>
        <span class="rev-icon">${icon}</span>
        <span class="rev-difficulty ${escapeHTML(diff.cls)}">${escapeHTML(diff.label)}</span>
        <span class="rev-time">${safeReviewTime}s</span>
      </div>`;

    if (q.audio)
      h += `<p class="rev-text">${escapeHTMLWithBreaks(q.audio)}</p>`;
    if (q.passage)
      h += `<p class="rev-text">${escapeHTMLWithBreaks(q.passage)}</p>`;
    if (q.stmt) h += `<div class="q-statement">★ ${escapeHTML(q.stmt)}</div>`;
    if (q.question)
      h += `<div class="q-statement">★ ${escapeHTML(q.question)}</div>`;
    if (q.text) h += `<p class="rev-text">${escapeHTML(q.text)}</p>`;
    if (Array.isArray(q.words))
      h += `<p class="rev-text">${escapeHTML(getZhValue("ui.review.wordList", "Words:"))}${q.words.map((w) => escapeHTML(w)).join("　")}</p>`;
    if (q.word)
      h += `<p class="rev-text">${escapeHTML(getZhValue("ui.review.keyword", "Keyword:"))}${escapeHTML(q.word)}</p>`;

    // Show answer info
    const cAns = getCanonicalAnswer(q.id);
    if (q.type === "tf") {
      h += `<p class="rev-ans">คำตอบของคุณ：<b>${q._userAns === true ? escapeHTML(getZhValue("ui.review.trueText", "✓ ถูก")) : q._userAns === false ? escapeHTML(getZhValue("ui.review.falseText", "✗ ผิด")) : "ไม่ได้ตอบ"}</b> ｜ คำตอบที่ถูก：<b>${cAns ? escapeHTML(getZhValue("ui.review.trueText", "✓ ถูก")) : escapeHTML(getZhValue("ui.review.falseText", "✗ ผิด"))}</b></p>`;
    } else if (q.type === "mc" || q.type === "fill") {
      const labels = Array.isArray(q.opts) ? "ABCD" : "ABCDEF";
      const optsArr = Array.isArray(q.opts)
        ? q.opts
        : Array.isArray(q.wordBank)
          ? q.wordBank
          : [];
      const userIdx = Number(q._userAns);
      const correctIdx = Number(cAns);
      const userText =
        Number.isInteger(userIdx) && optsArr[userIdx] !== undefined
          ? `${labels[userIdx] || "?"} ${escapeHTML(optsArr[userIdx])}`
          : "ไม่ได้ตอบ";
      const correctText =
        Number.isInteger(correctIdx) && optsArr[correctIdx] !== undefined
          ? `${labels[correctIdx] || "?"} ${escapeHTML(optsArr[correctIdx])}`
          : "-";
      h += `<p class="rev-ans">คำตอบของคุณ：<b>${userText}</b> ｜ คำตอบที่ถูก：<b>${correctText}</b></p>`;
    } else if (q.type === "order") {
      h += `<p class="rev-ans">คำตอบของคุณ：<b>${escapeHTML(q._userAns) || "ไม่ได้ตอบ"}</b> ｜ คำตอบที่ถูก：<b>${escapeHTML(cAns)}</b></p>`;
    } else if (q.type === "write") {
      h += `<p class="rev-ans">คำตอบของคุณ：<b>${escapeHTML(q._userAns) || "ไม่ได้ตอบ"}</b><br>คำตอบที่ถูก：<b>${escapeHTML(getAcceptedWriteAnswerText(q) || cAns)}</b></p>`;
    } else if (q.type === "free") {
      h += `<p class="rev-ans">คำตอบของคุณ：<b>${escapeHTML(q._userAns) || "ไม่ได้ตอบ"}</b><br>ตัวอย่างคำตอบ：<b>${escapeHTML(q.sample)}</b></p>`;
    }

    // Enhanced explanation box
    if (isSkipped) {
      h += `<div class="rev-exp-box skipped">
              <h5>⏭️ ข้อนี้ถูกข้ามเพราะหมดเวลา</h5>
              <div class="why-correct">✅ คำตอบที่ถูกต้อง: ${safeExp}</div>
              <div class="exp-detail">💡 เคล็ดลับ: ฝึกตอบให้เร็วขึ้นโดยจับคำสำคัญ (keywords) ในโจทย์</div>
            </div>`;
    } else if (isUnanswered) {
      h += `<div class="rev-exp-box skipped">
              <h5>⚠️ ไม่ได้ตอบข้อนี้</h5>
              <div class="why-correct">✅ คำตอบที่ถูกต้อง: ${safeExp}</div>
              <div class="exp-detail">💡 ในการสอบจริง ควรตอบทุกข้อแม้ไม่มั่นใจ เพราะไม่มีคะแนนติดลบ</div>
            </div>`;
    } else if (q._correct) {
      h += `<div class="rev-exp-box correct">
              <h5>✅ ตอบถูก! เก่งมาก!</h5>
              <div class="why-correct">${safeExp}</div>
            </div>`;
    } else {
      h += `<div class="rev-exp-box wrong">
              <h5>❌ ตอบผิด</h5>
              <div class="why-wrong">🔴 ทำไมผิด: ${escapeHTML(getWhyWrongThai(q, q._userAns))}</div>
              <div class="why-correct">🟢 คำตอบที่ถูก: ${safeExp}</div>
              <div class="exp-detail">💡 จดจำจุดนี้ไว้ แล้วฝึกทำข้อแบบเดียวกันอีกครั้ง</div>
            </div>`;
    }

    h += `</div>`;
  });
  document.getElementById("reviewArea").innerHTML = h;
  // Trigger filter in case there is already text in the search input when switching tabs
  filterReviews();
}

function filterReviews() {
  const input = document.getElementById("reviewSearchInput");
  if (!input) return;
  const filter = input.value.toLowerCase();
  const cards = document.querySelectorAll("#reviewArea .review-card");
  cards.forEach((card) => {
    if (card.textContent.toLowerCase().includes(filter)) {
      card.style.display = "";
    } else {
      card.style.display = "none";
    }
  });
}

// Initialize
function checkName() {
  const inputEl = document.getElementById("userNameInput");
  const input = sanitizeUserName(inputEl.value);
  if (inputEl.value !== input) inputEl.value = input;
  const btn = document.getElementById("btnStart");
  btn.disabled = input.length === 0;
}

function showInPageAlert(message, okText = "ตกลง", title = "แจ้งเตือน") {
  return new Promise((resolve) => {
    const existing = document.getElementById("customAlertOverlay");
    safeRemoveElement(existing);

    const overlay = document.createElement("div");
    overlay.className = "submit-overlay";
    overlay.id = "customAlertOverlay";
    overlay.style.zIndex = "10050";
    overlay.innerHTML = `
            <div class="submit-modal" style="max-width:420px">
              <h3 style="margin-bottom:10px">${escapeHTML(title)}</h3>
              <p style="color:var(--txt2);line-height:1.6;margin-bottom:12px">${escapeHTML(message)}</p>
              <button class="btn-submit-final confirm" id="customAlertOk">${escapeHTML(okText)}</button>
            </div>
          `;
    document.body.appendChild(overlay);

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      safeRemoveElement(overlay);
      resolve(true);
    };

    bindTapEvent(document.getElementById("customAlertOk"), finish);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) finish();
    });
  });
}

function showInPageConfirm(
  message,
  confirmText = "ยืนยัน",
  cancelText = "ยกเลิก",
) {
  return new Promise((resolve) => {
    const existing = document.getElementById("customConfirmOverlay");
    safeRemoveElement(existing);

    const overlay = document.createElement("div");
    overlay.className = "submit-overlay";
    overlay.id = "customConfirmOverlay";
    overlay.style.zIndex = "10050";
    overlay.innerHTML = `
            <div class="submit-modal" style="max-width:420px">
              <h3 style="margin-bottom:10px">⚠️ ยืนยันการดำเนินการ</h3>
              <p style="color:var(--txt2);line-height:1.6;margin-bottom:10px">${escapeHTML(message)}</p>
              <button class="btn-submit-final confirm" id="customConfirmOk">${escapeHTML(confirmText)}</button>
              <button class="btn-submit-final cancel" id="customConfirmCancel">${escapeHTML(cancelText)}</button>
            </div>
          `;
    document.body.appendChild(overlay);

    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      safeRemoveElement(overlay);
      resolve(result);
    };

    bindTapEvent(document.getElementById("customConfirmOk"), () =>
      finish(true),
    );
    bindTapEvent(document.getElementById("customConfirmCancel"), () =>
      finish(false),
    );
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) finish(false);
    });
  });
}

function showResumeModal() {
  const overlay = document.createElement("div");
  overlay.className = "resume-modal-overlay";
  overlay.id = "resumeModalOverlay";
  overlay.innerHTML = `
          <div class="resume-modal">
            <h3 style="color:var(--red);margin-bottom:12px;font-size:1.3em;">📝 พบข้อมูลทำแบบทดสอบค้างไว้</h3>
            <p style="color:var(--txt2);margin-bottom:24px;line-height:1.5;">
              คุณ <b>${escapeHTML(userName)}</b> มีแบบทดสอบที่ยังทำไม่เสร็จ<br>ต้องการทำต่อจากจุดเดิมหรือไม่?
            </p>
            <button class="resume-btn btn-continue" id="resumeContinueBtn">▶ ทำข้อสอบต่อ</button>
            <button class="resume-btn btn-restart" id="resumeRestartBtn">🔄 เริ่มทำใหม่ทั้งหมด (ลบข้อมูลเดิม)</button>
          </div>
        `;
  document.body.appendChild(overlay);

  bindTapEvent(document.getElementById("resumeContinueBtn"), resumeExam);
  bindTapEvent(document.getElementById("resumeRestartBtn"), restartExam);
}

function closeResumeModal() {
  const modal = document.getElementById("resumeModalOverlay");
  safeRemoveElement(modal);
}

function resumeExam() {
  closeResumeModal();
  startExam(true);
}

async function restartExam() {
  const shouldReset = await showInPageConfirm(
    "แน่ใจหรือไม่ที่จะลบข้อมูลเดิมที่ทำค้างไว้ทั้งหมด? (ข้อมูลเดิมจะไม่สามารถกู้คืนได้)",
    "ยืนยันลบข้อมูล",
    "ยกเลิก",
  );
  if (!shouldReset) return;

  closeResumeModal();
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem("hsk4_exam_dataset_file");
  answers = {};
  qTimes = {};
  currentIdx = 0;
  currentSection = "listening";
  sectionTimes = { listening: 0, reading: 0, writing: 0 };
  skippedQs = new Set();
  highestIdx = 0;
  userName = "";
  listeningReviewNotified = false;
  document.getElementById("userNameInput").value = "";
  checkName();
}

function init() {
  // Start pre-loading audio immediately
  preloadAllAudio();

  if (loadState()) {
    document.getElementById("userNameInput").value = userName;
    checkName();
    showResumeModal();
  }
}

async function startExam(isResume = false) {
  primeTTS();
  const userInputEl = document.getElementById("userNameInput");

  if (!isResume) {
    userName = sanitizeUserName(userInputEl.value);
    userInputEl.value = userName;
    if (!userName) {
      await showInPageAlert("กรุณากรอกชื่อก่อนเริ่มสอบ", "รับทราบ");
      userInputEl.focus();
      return;
    }
    skippedQs = new Set();
    listeningReviewNotified = false;
    sectionStartTime = monotonicNow();
    qStartTime = monotonicNow();
    saveState();
  } else {
    userName = sanitizeUserName(userName || userInputEl.value);
    userInputEl.value = userName;
    listeningReviewNotified =
      currentSection === "listening" &&
      sectionTimes.listening >= LISTENING_AUDIO_TIME;
  }

  document.getElementById("page1").style.display = "none";
  document.getElementById("examContainer").style.display = "block";

  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    updateTimer();
    // Auto-save every 5 seconds to keep timer roughly synced
    if (Math.floor(monotonicNow() / 1000) % 5 === 0) {
      saveState();
    }
  }, 1000);

  updateSectionNav();
  renderQuestion();
}

async function bootstrap() {
  try {
    await loadChineseContent();
  } catch (error) {
    renderBootstrapError(error, "โหลดข้อมูลภาษาจีนไม่สำเร็จ");
    return;
  }

  try {
    init();
  } catch (error) {
    renderBootstrapError(error, "เริ่มต้นหน้าเว็บไม่สำเร็จ");
  }
}

bootstrap();
