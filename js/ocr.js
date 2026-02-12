const PROBE_TEMPLATE_DATAURL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACIAAAAmCAYAAACh1knUAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAARGSURBVFhH7VfraxNZFPffsVarVdfHLosLKuJ+2Ao+UFmVZRFW8IsLfhHEj+IDUdo0fUSr1lfV1eqqSFkXn7UivkCwm0nSTPNqG9ukTZvHJHM8586dZB53kpSUZVn8DT9IJr9z7m/uPffMzTz4j+D/YiTDWTtqNJLmrB1VGMkzKniFZ97Aq88uuBvaA+f8q8DlXczY4V8MXYGV8CC6H95PdMNo9iNGaFe1qGgkr05CJD0ArdIKaPYugVYcuF1aJCT9TnQjb8ibYST7CVQo8EzlUdZIFk3clHcXB5iNkU7GRngYOcCzlYejkZSahEvyeuGAs2Gztw6uBJsgqcg8sxhCIzOFBFwMroHOwBJh8tmw2Tuf8c7wLp5dDJsRRU1Db/hnYdJa6MFlehw7giOo2kAW2IwEUn1zMhNWUs14vEshU0jykcwwGSmoOfD414BLcjbSKjVACxYssZOzBetAo3afNKLYDrz/d+wwH80Mk5FA6mmx8kWJiLRr2O6RlsOT0SMwmLwFL8dboHtoYzG23M5qRSZyQT5iCQYjKjwdO8oalCiRW6pn7PCtRt1xyBUmeRxAjl1Z+JC4iM3tO4w3xxpJhTs4dZdHllA0UlAVuD3sXKSUoN23HIan+3mECGmIpvtR7zyjlOdF/CTXl1A0klezOL1rhcFESjAwfoarnaC9e17GjwlzEClPb+gXTW5A0Qht2w6f89q6pW9gSolxdXmEZwbYgGwWLXlo93RJK7myhKqN9Mg7uLIyCpirK/BDDUYcq70BHo2Jt50IVG835T1oxF4rdM9dzgj1kJ6hJlugxrk10hv6jStLMBhR4FZoR7E5mRM0QF/0d1TRaazyGSOnZuC6vB0HXWDJoxl5ET/NlSUUjVAf6Y+fQqG4yC4Hf0QN7QqFqcshi8vs8X8rzENGBqfuc2UJBiPUWR9hM6pntCZo8zViHSVQVdnIZD6GA9Yz6vFunFViG/aiRM5+JDAZoWrvxncNVbbRBNGFXXUs8w5VlY28nTjPntxYI/r3ntBPXGWGyQgNEsBpExmhaf4zvJdpyoEV6vBOoRGXtKy6ty+BtnFnYIXJhJZoPhZxPQRTz7hSjHcTl4TvKnq4P+RtWIlVnkcIkfRrWyK9iC8MrYNY+gNXGqHCP5MPoU1aLTRyFmdjTPFxrR22pckURvAEvtWWSJ/qZu9CuBehPmD+P0MzSSZIIzJCLaEvehDtik/1tmK9Lm9hT25NpBu5geuvv9ys8OOu6wpsEBrRZ/RacCNXm2Eyoqp5+GvkEAvQT1s629HEczyvKOoMKTntmM7HoX/0BJsB46lNM1KHvcp+BCDYaoQSXQ1uwiB9KRqx4/4K4ekBrqgMKshPyduWPHXwILIffxF3ZmGx5tRpuIb/1Dz+7/E4eJzfnT0UbPX3owewia3CutrH74ohNEKgZUphh5wLjOck/skZjkb+bXw1YsVXI2YAfAGs8LSsCIEo2AAAAABJRU5ErkJggg==";

const PROBE_REGION = { x: 0.13, y: 0.45, w: 0.05, h: 0.45 }; // % of frame
const EVENT_REGION = { x: 0.12, y: 0.175, w: 0.2, h: 0.05 }; // % of frame

const MATCH_STRIDE = 2;
const MATCH_THRESHOLD = 0.85;
const MAX_MS_PER_SCAN = 60;

const OCR_OPTS = { lang: "eng", psm: 6 }; // 6 = block of text (ribbon often has 2 lines)
const TRIGGER_COOLDOWN_MS = 1500;
const TESSERACT_SRC = "https://cdn.jsdelivr.net/npm/tesseract.js@4/dist/tesseract.min.js";
const MAX_OCR_WORKERS = 3; // Max workers for skill OCR pool

const captureBtn   = document.getElementById("captureBtn");
const videoEl      = document.getElementById("captureVideo");
const suggestions  = document.getElementById("suggestions");

const SCAN_TIME_KEY = "umasearch-scantime";
function getScanDelay() {
  const v = localStorage.getItem(SCAN_TIME_KEY) || "3000";
  const n = Number(v);
  return Number.isFinite(n) && n > 200 ? n : 3000;
}


let mediaStream = null;
let captureTimer = null;
let lastTriggerTs = 0;
let tesseractReady = null;
let ocrScheduler = null; // Tesseract worker pool scheduler

const canvas = document.createElement("canvas");
const ctx    = canvas.getContext("2d", { willReadFrequently: true });

let tpl = null; // {w,h,gray,mean,std}
function toGray(imgData) {
  const { data, width, height } = imgData;
  const gray = new Uint8ClampedArray(width * height);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    const r = data[i], g = data[i+1], b = data[i+2];
    gray[j] = (r * 0.299 + g * 0.587 + b * 0.114) | 0;
  }
  return { gray, width, height };
}
function stats(gray) {
  let s = 0, s2 = 0;
  const n = gray.length;
  for (let i = 0; i < n; i++) { const v = gray[i]; s += v; s2 += v*v; }
  const mean = s / n;
  const v2 = Math.max(1e-6, s2 / n - mean * mean);
  return { mean, std: Math.sqrt(v2) };
}

function _toGray(imgData) {
  const { data, width, height } = imgData;
  const gray = new Uint8ClampedArray(width * height);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    const r = data[i], g = data[i+1], b = data[i+2];
    gray[j] = (r * 0.299 + g * 0.587 + b * 0.114) | 0;
  }
  return { gray, width, height };
}
function _stats(gray) {
  let s = 0, s2 = 0;
  const n = gray.length;
  for (let i = 0; i < n; i++) { const v = gray[i]; s += v; s2 += v*v; }
  const mean = s / n;
  const v2 = Math.max(1e-6, s2 / n - mean * mean);
  return { mean, std: Math.sqrt(v2) };
}

async function _decodeToCanvasFromBlob(blob) {
  try {
    const bmp = await createImageBitmap(blob);
    const c = document.createElement("canvas");
    c.width = bmp.width; c.height = bmp.height;
    c.getContext("2d", { willReadFrequently: true }).drawImage(bmp, 0, 0);
    return c;
  } catch {
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.decoding = "sync";
      img.src = url;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      c.getContext("2d", { willReadFrequently: true }).drawImage(img, 0, 0);
      return c;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

async function _decodeToCanvasFromDataURL(dataUrl) {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  return _decodeToCanvasFromBlob(blob);
}

async function loadTemplate(src) {
  let canvasFromImg;

  if (PROBE_TEMPLATE_DATAURL) {
    canvasFromImg = await _decodeToCanvasFromDataURL(PROBE_TEMPLATE_DATAURL);
  } else {
    // Use default caching for template images
    const res = await fetch(src);
    if (!res.ok) throw new Error(`Failed to fetch template ${src}: ${res.status} ${res.statusText}`);

    const ct = (res.headers.get("content-type") || "").toLowerCase();
    if (!ct.startsWith("image/")) {
      const snippet = (await res.text()).slice(0, 200);
      throw new Error(`Template is not an image (content-type: "${ct}"). First bytes: ${snippet}`);
    }

    const blob = await res.blob();
    canvasFromImg = await _decodeToCanvasFromBlob(blob);
  }

  const id = canvasFromImg.getContext("2d", { willReadFrequently: true })
                          .getImageData(0, 0, canvasFromImg.width, canvasFromImg.height);
  const g = _toGray(id);
  const st = _stats(g.gray);
  tpl = { w: g.width, h: g.height, gray: g.gray, mean: st.mean, std: st.std };
  console.info(`[ocr] Template loaded ${g.width}x${g.height}`);
}

function nccScore(frameGray, fW, x, y, tplObj) {
  const { w: tw, h: th, gray: tGray, mean: tMean, std: tStd } = tplObj;
  let sum = 0, sum2 = 0, sumCross = 0;
  for (let j = 0; j < th; j++) {
    const fy = (y + j) * fW;
    const tj = j * tw;
    for (let i = 0; i < tw; i++) {
      const fv = frameGray[fy + x + i];
      const tv = tGray[tj + i];
      sum += fv; sum2 += fv * fv; sumCross += fv * tv;
    }
  }
  const n = tw * th;
  const fMean = sum / n;
  const fVar  = Math.max(1e-6, sum2 / n - fMean * fMean);
  const fStd  = Math.sqrt(fVar);
  const num   = sumCross - n * fMean * tMean;
  const den   = n * fStd * tStd;
  return den > 0 ? (num / den) : 0;
}
function matchTemplateInRegion(frameImgData, probeRect, tplObj) {
  const { width: fW, height: fH } = frameImgData;
  const frameGray = toGray(frameImgData).gray;

  const { w: tw, h: th } = tplObj;
  const x0 = probeRect.x, y0 = probeRect.y;
  const x1 = x0 + Math.max(0, probeRect.w - tw);
  const y1 = y0 + Math.max(0, probeRect.h - th);

  let best = { score: -1, x: x0, y: y0 };
  const tStart = performance.now();

  for (let y = y0; y <= y1; y += MATCH_STRIDE) {
    for (let x = x0; x <= x1; x += MATCH_STRIDE) {
      const s = nccScore(frameGray, fW, x, y, tplObj);
      if (s > best.score) best = { score: s, x, y };
    }
    if (performance.now() - tStart > MAX_MS_PER_SCAN) break;
  }
  return best;
}

function setSuggestion(msg) { if (suggestions) suggestions.textContent = msg || ""; }
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const tag = document.createElement("script");
    tag.src = src;
    tag.async = true;
    tag.onload = () => resolve();
    tag.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(tag);
  });
}

async function ensureTesseract() {
  if (window.Tesseract) return window.Tesseract;
  if (!tesseractReady) {
    tesseractReady = loadScript(TESSERACT_SRC).then(() => window.Tesseract);
  }
  return tesseractReady;
}

async function createScheduler() {
  if (ocrScheduler) return ocrScheduler;

  const Tess = await ensureTesseract();
  const scheduler = Tess.createScheduler();

  const numWorkers = Math.min(MAX_OCR_WORKERS, navigator.hardwareConcurrency || 2);
  const workers = [];

  for (let i = 0; i < numWorkers; i++) {
    const worker = await Tess.createWorker(OCR_OPTS.lang, 1, {
      logger: () => {}
    });
    scheduler.addWorker(worker);
    workers.push(worker);
  }

  ocrScheduler = scheduler;
  return scheduler;
}

function mayTrigger() {
  const now = performance.now();
  if (now - lastTriggerTs < TRIGGER_COOLDOWN_MS) return false;
  lastTriggerTs = now;
  return true;
}

function cleanTitle(raw) {
  if (!raw) return "";

  let t = raw
    .replace(/[\u2018\u2019\u2032]/g, "'")
    .replace(/[\u201C\u201D\u2033]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u00A0/g, " ");

  const lines = t.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const noRibbon = lines.filter(l => !/support\s*card\s*event/i.test(l));

  t = (noRibbon.length ? noRibbon.join(" ") : lines.join(" "));

  t = t
    .replace(/\s*\*\s*/g, " ") // stray bullets
    .replace(/\s*\.\s*/g, ". ")
    .replace(/\s*\|\s*/g, " I ") // pipe -> capital I (very common on this font)
    .replace(/\s{2,}/g, " ")
    .replace(/^[^A-Za-z0-9]+/, "") // leading junk
    .trim();

  if (t && t === t.toLowerCase()) {
    t = t.replace(/\b([a-z])([a-z]*)\b/g, (_, a, b) => a.toUpperCase() + b);
  }
  t = t.replace(/[^A-Za-z0-9 '"\-\?\!\:\,\.\&\(\)]/g, "").trim();

  return t;
}


function extractHintLevel(text) {
  if (!text || typeof text !== "string") return null;

  // Match "Hint Lvl 2", "Hint Lv 2", "HintLv.2", "Hint Lvl2", etc.
  const m = text.match(/[Hh]int\s*[Ll][vV][lL]?\s*\.?\s*(\d)/);
  if (m) {
    const h = parseInt(m[1], 10);
    if (h >= 1 && h <= 5) return h;
  }

  // Match "X0% OFF" discount pattern (10%=Lv1, 20%=Lv2, 30%=Lv3, etc.)
  // Also handles OCR garbles like "10% ot", "20% Of", "10% oft"
  const m2 = text.match(/(\d)0%\s*[Oo]/i);
  if (m2) {
    const h = parseInt(m2[1], 10);
    if (h >= 1 && h <= 5) return h;
  }

  // Standalone "Lvl X" or "Lv X" or "Lv.X"
  const m3 = text.match(/[Ll][vV][lL]?\s*\.?\s*([1-5])\b/);
  if (m3) {
    const h = parseInt(m3[1], 10);
    if (h >= 1 && h <= 5) return h;
  }

  return null;
}


async function ocrEventRect(eventRectPx) {
  const sub = document.createElement("canvas");
  sub.width = eventRectPx.w; sub.height = eventRectPx.h;
  const sctx = sub.getContext("2d", { willReadFrequently: true });
  sctx.drawImage(canvas, eventRectPx.x, eventRectPx.y, eventRectPx.w, eventRectPx.h, 0, 0, eventRectPx.w, eventRectPx.h);

  const blob = await new Promise(res => sub.toBlob(res, "image/png"));
  const url = URL.createObjectURL(blob);
  try {
    if (!ocrScheduler) await createScheduler();
    const r = await ocrScheduler.addJob("recognize", url);
    const raw = (r?.data?.text || "").trim();
    return cleanTitle(raw);
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function scanFrame() {
  if (!tpl) return;
  const vw = videoEl.videoWidth, vh = videoEl.videoHeight;
  if (!vw || !vh) return;

  canvas.width = vw; canvas.height = vh;
  ctx.drawImage(videoEl, 0, 0, vw, vh);
  const frameData = ctx.getImageData(0, 0, vw, vh);

  const probeRectPx = {
    x: Math.round(PROBE_REGION.x * vw),
    y: Math.round(PROBE_REGION.y * vh),
    w: Math.round(PROBE_REGION.w * vw),
    h: Math.round(PROBE_REGION.h * vh)
  };
  const eventRectPx = {
    x: Math.round(EVENT_REGION.x * vw),
    y: Math.round(EVENT_REGION.y * vh),
    w: Math.round(EVENT_REGION.w * vw),
    h: Math.round(EVENT_REGION.h * vh)
  };

  const match = matchTemplateInRegion(frameData, probeRectPx, tpl);

  if (match.score >= MATCH_THRESHOLD) {
    setSuggestion(`UI found (${Math.round(match.score*100)}%). Reading title…`);
    if (!mayTrigger()) return;

    const title = (await ocrEventRect(eventRectPx)).trim();
    if (title) {
      setSuggestion(`Detected: “${title}” — searching…`);
      if (typeof window.performSearch === "function") {
        window.performSearch(title); // search.js renders the results
      } else if (typeof performSearch === "function") {
        performSearch(title);
      } else {
        console.warn("[ocr] performSearch() not found.");
      }
    } else {
      setSuggestion("UI found, but OCR produced no text.");
    }
  } else {
    setSuggestion("Waiting for UI…");
  }
}

let isCapturing = false;
let stopBtn = null;
let cameraContainer = null;

async function startScreenCapture() {
  try {
    setSuggestion("Select a window or screen to capture…");

    mediaStream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 5 } },
      audio: false
    });
    videoEl.srcObject = mediaStream;

    if (!cameraContainer) {
      cameraContainer = document.getElementById("camera-capture-container");
    }
    if (cameraContainer) {
      cameraContainer.style.display = "block";
    }

    setSuggestion("Screen shared. Click 'Capture Frame' to OCR the current view.");

    captureBtn.textContent = "⏹ Stop Capture";
    captureBtn.onclick = stopScreenCapture;
    isCapturing = true;

    const captureFrameBtn = document.getElementById('capture-frame-btn');
    if (captureFrameBtn) {
      captureFrameBtn.style.display = 'block';
    }

    videoEl.onloadedmetadata = () => {
      videoEl.play().catch(err => {
        console.error("Video play error:", err);
        setSuggestion("Failed to start video preview.");
      });
    };

    mediaStream.getVideoTracks()[0].addEventListener("ended", stopScreenCapture);
  } catch (err) {
    console.error("Screen capture error:", err);
    if (err.name === "NotAllowedError") {
      setSuggestion("Screen capture cancelled.");
    } else {
      setSuggestion("Screen capture failed. Please try again.");
    }
    stopScreenCapture();
  }
}

async function stopScreenCapture() {
  try {
    if (captureTimer) clearInterval(captureTimer);
    captureTimer = null;
    if (mediaStream) {
      mediaStream.getTracks().forEach(track => track.stop());
      mediaStream = null;
    }
    videoEl.srcObject = null;

    if (cameraContainer) {
      cameraContainer.style.display = "none";
    }

    const captureFrameBtn = document.getElementById('capture-frame-btn');
    if (captureFrameBtn) {
      captureFrameBtn.style.display = 'none';
    }

    captureBtn.textContent = "🖥 Screen Capture";
    captureBtn.onclick = startScreenCapture;
    isCapturing = false;
    setSuggestion("");
  } catch (err) {
    console.error("Stop capture error:", err);
  }
}

async function startCapture() {
  try {
    setSuggestion("Loading OCR engine\u2026");
    await createScheduler();
    await loadTemplate(PROBE_TEMPLATE_DATAURL);

    mediaStream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 30 },
      audio: false
    });
    videoEl.srcObject = mediaStream;

    if (captureTimer) clearInterval(captureTimer);
    const delay = getScanDelay();
    setSuggestion("Screen capture started. Waiting for UI…");

    captureBtn.style.display = "none";
    if (!stopBtn) {
      stopBtn = document.createElement("button");
      stopBtn.id = "stopCaptureBtn";
      stopBtn.className = "capture-btn";
      stopBtn.textContent = "Stop Capture";
      stopBtn.onclick = stopCapture;
      captureBtn.parentNode.insertBefore(stopBtn, captureBtn.nextSibling);
    }
    stopBtn.style.display = "";

    isCapturing = true;

    videoEl.onloadedmetadata = () => {
      videoEl.play().then(() => {
        scanFrame();
        captureTimer = setInterval(scanFrame, delay);
      });
    };

    mediaStream.getVideoTracks()[0].addEventListener("ended", stopCapture);
  } catch (err) {
    console.error("capture/template error:", err);
    setSuggestion("Screen capture failed (permissions or template).");
    stopCapture();
  }
}

async function stopCapture() {
  try {
    if (captureTimer) clearInterval(captureTimer);
    captureTimer = null;
    if (mediaStream) {
      mediaStream.getTracks().forEach(track => track.stop());
      mediaStream = null;
    }
    setSuggestion("Capture stopped.");
    videoEl.srcObject = null;
  } finally {
    // Ensure scheduler is always terminated
    if (ocrScheduler) {
      try {
        await ocrScheduler.terminate();
      } catch (err) {
        console.error("[ocr] Scheduler termination error:", err);
      }
      ocrScheduler = null;
    }

    // Ensure UI is always reset
    if (stopBtn) stopBtn.style.display = "none";
    captureBtn.style.display = "";
    isCapturing = false;
  }
}

let skillDatabase = null;
let skillNameIndex = new Map();

function normalize(str) {
  return (str || '').toString().trim().toLowerCase();
}

function levenshteinDistance(a, b) {
  if (!a || !b) return Math.max(a?.length || 0, b?.length || 0);

  const alen = a.length;
  const blen = b.length;

  if (alen === 0) return blen;
  if (blen === 0) return alen;

  const dp = Array(alen + 1).fill(null).map(() => Array(blen + 1).fill(0));

  for (let i = 0; i <= alen; i++) dp[i][0] = i;
  for (let j = 0; j <= blen; j++) dp[0][j] = j;

  for (let i = 1; i <= alen; i++) {
    for (let j = 1; j <= blen; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }

  return dp[alen][blen];
}

function fuzzyMatchSkill(ocrText, maxDistance = 2) {
  if (!ocrText || !skillDatabase || skillNameIndex.size === 0) {
    return null;
  }

  const queryNorm = normalize(ocrText);

  // Reject queries with fewer than 3 alphabetic characters
  const alphaCount = (queryNorm.match(/[a-z]/g) || []).length;
  if (alphaCount < 3) return null;

  if (skillNameIndex.has(queryNorm)) {
    return {
      skill: skillNameIndex.get(queryNorm),
      confidence: 1.0,
      distance: 0
    };
  }

  let bestMatch = null;
  let bestDistance = maxDistance + 1;

  for (const [normName, skill] of skillNameIndex) {
    // Scale allowed distance by the shorter string's length to prevent
    // short garbage text from matching real skills (e.g. "15" → "Focus")
    const shorter = Math.min(queryNorm.length, normName.length);
    const effectiveMax = Math.min(maxDistance, Math.max(1, Math.floor(shorter * 0.3)));

    const dist = levenshteinDistance(queryNorm, normName);

    if (dist <= effectiveMax && dist < bestDistance) {
      bestDistance = dist;
      bestMatch = {
        skill,
        distance: dist,
        confidence: 1.0 - (dist / (Math.max(queryNorm.length, normName.length) + 1))
      };
    }
  }

  return bestMatch;
}

async function loadSkillDatabase() {
  if (skillDatabase) return skillDatabase;

  const candidates = ['/assets/uma_skills.csv', './assets/uma_skills.csv'];
  let lastErr = null;

  for (const url of candidates) {
    try {
      const response = await fetch(url, { cache: 'force-cache' });
      if (!response.ok) continue;

      const text = await response.text();
      const lines = text.split(/\r?\n/).filter(l => l.trim());
      if (lines.length < 2) continue;

      const header = lines[0].split(',').map(h => h.trim().toLowerCase());
      const nameIdx = header.indexOf('name');
      const typeIdx = header.indexOf('skill_type');
      if (nameIdx === -1) continue;

      const skills = [];
      skillNameIndex.clear();

      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',');
        const name = (cols[nameIdx] || '').trim();
        if (!name) continue;
        // Skip entries that are too short or lack alphabetic characters (CSV artifacts)
        if (name.length < 3 || !/[a-zA-Z]{2,}/.test(name)) continue;

        const type = typeIdx !== -1 ? (cols[typeIdx] || '').trim().toLowerCase() : '';
        const skill = { name, type };
        skills.push(skill);

        const normName = normalize(name);
        if (!skillNameIndex.has(normName)) {
          skillNameIndex.set(normName, { name, type });
        }
      }

      skillDatabase = skills;
      return skillDatabase;
    } catch (err) {
      lastErr = err;
    }
  }

  console.error('[ocr] Failed to load skill database:', lastErr);
  return null;
}

function testFuzzyMatching() {
  const testCases = [
    { input: 'Concentration', expected: 'Concentration' },
    { input: 'Concetration', expected: 'Concentration' },
    { input: 'Consentration', expected: 'Concentration' },
    { input: 'Stealth Mode', expected: 'Stealth Mode' },
    { input: 'Stelth Mode', expected: 'Stealth Mode' }
  ];

  const results = [];
  for (const test of testCases) {
    const match = fuzzyMatchSkill(test.input, 2);
    results.push({
      input: test.input,
      expected: test.expected,
      matched: match?.skill?.name || null,
      confidence: match?.confidence || 0,
      distance: match?.distance !== undefined ? match.distance : null,
      success: match && normalize(match.skill.name) === normalize(test.expected)
    });
  }
  return results;
}

if (typeof window !== 'undefined') {
  window.fuzzyMatchSkill = fuzzyMatchSkill;
  window.loadSkillDatabase = loadSkillDatabase;
  window.testFuzzyMatching = testFuzzyMatching;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      loadSkillDatabase().then(() => {
      }).catch(err => {
        console.error('[ocr] Failed to initialize skill database:', err);
      });
    });
  } else {
    loadSkillDatabase().then(() => {
    }).catch(err => {
      console.error('[ocr] Failed to initialize skill database:', err);
    });
  }
}

if (captureBtn) captureBtn.onclick = startScreenCapture;

// Skill OCR: Screenshot upload handler
const screenshotUploadInput = document.getElementById('screenshot-upload-input');
const screenshotUploadBtn = document.getElementById('screenshot-upload-btn');

if (screenshotUploadInput) {
  screenshotUploadInput.addEventListener('change', async function(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      await processSkillOCR(file);
    } catch (err) {
      console.error('[ocr] Skill OCR failed:', err);
      alert('Failed to process image. Please try again.');
    } finally {
      screenshotUploadInput.value = '';
    }
  });
}

// Skill OCR: Screen capture frame handler
let skillCaptureCanvas = null;

if (videoEl) {
  const captureFrameBtn = document.createElement('button');
  captureFrameBtn.id = 'capture-frame-btn';
  captureFrameBtn.className = 'btn';
  captureFrameBtn.textContent = '📸 Capture Frame';
  captureFrameBtn.style.display = 'none';

  const container = document.getElementById('camera-capture-container') || document.querySelector('.camera-capture-container');
  if (container) {
    const sug = container.querySelector('#suggestions');
    if (sug) {
      container.insertBefore(captureFrameBtn, sug);
    } else {
      container.appendChild(captureFrameBtn);
    }
  }

  captureFrameBtn.addEventListener('click', async () => {
    if (!videoEl.videoWidth || !videoEl.videoHeight) return;

    if (!skillCaptureCanvas) {
      skillCaptureCanvas = document.createElement('canvas');
    }

    skillCaptureCanvas.width = videoEl.videoWidth;
    skillCaptureCanvas.height = videoEl.videoHeight;
    const sctx = skillCaptureCanvas.getContext('2d');
    sctx.drawImage(videoEl, 0, 0);

    skillCaptureCanvas.toBlob(async (blob) => {
      if (!blob) return;
      try {
        await processSkillOCR(blob);
        stopScreenCapture();
      } catch (err) {
        console.error('[ocr] Skill OCR from screen capture failed:', err);
        alert('Failed to process captured frame. Please try again.');
      }
    }, 'image/png');
  });
}

async function processSkillOCR(imageBlob) {
  const resultsPanel = document.getElementById('ocr-results-panel');
  const resultsList = document.getElementById('ocr-results-list');

  if (!resultsPanel || !resultsList) {
    console.error('[ocr] OCR results panel not found');
    return;
  }

  resultsList.innerHTML = '<div class="loading-indicator">Processing image...</div>';
  resultsPanel.style.display = 'block';

  try {
    await loadSkillDatabase();

    const Tess = await ensureTesseract();
    const worker = await Tess.createWorker('eng');

    try {
      await worker.setParameters({
        tessedit_pageseg_mode: Tess.PSM.AUTO
      });

      const url = URL.createObjectURL(imageBlob);

      try {
        const result = await worker.recognize(url);
        const ocrText = result.data.text || '';
        console.log('[ocr] Raw OCR text:', ocrText);

        const detectedSkills = parseSkillsFromOCR(ocrText);
        displayOCRResults(detectedSkills);
        window.ocrDetectedSkills = detectedSkills;
      } finally {
        URL.revokeObjectURL(url);
      }
    } finally {
      await worker.terminate();
    }
  } catch (err) {
    console.error('[ocr] Skill OCR error:', err);
    resultsList.innerHTML = '<div class="error-message">Failed to process image. Please try again.</div>';
    throw err;
  }
}

// Clean line treating pipes as letter "I" (for names like "I Can See Right Through You")
function cleanLinePipesAsI(text) {
  return text
    .replace(/[\u2018\u2019\u2032]/g, "'")
    .replace(/[\u201C\u201D\u2033]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u00A0/g, " ")
    .replace(/\s*\|\s*/g, " I ")
    .replace(/[\[\]©@*#]+/g, '')
    .replace(/\s{2,}/g, " ")
    .replace(/^[^A-Za-z0-9]+/, "")
    .trim();
}

// Clean line stripping pipes entirely (for "Iron Wil | Te | |" → "Iron Wil Te")
function cleanLineStripNoise(text) {
  return text
    .replace(/[\u2018\u2019\u2032]/g, "'")
    .replace(/[\u201C\u201D\u2033]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u00A0/g, " ")
    .replace(/[|[\]©@*#]+/g, '')
    .replace(/\s{2,}/g, " ")
    .replace(/^[^A-Za-z0-9]+/, "")
    .trim();
}

function _tryMatchCleaned(cleaned) {
  if (cleaned.length < 3) return null;

  // Try full line
  let match = fuzzyMatchSkill(cleaned, 2);
  if (match) return match;

  // Strip trailing numbers (costs like "160 +")
  let stripped = cleaned.replace(/\s+\d{1,3}\s*[\+]?\s*$/, '').trim();
  if (stripped.length >= 3 && stripped !== cleaned) {
    match = fuzzyMatchSkill(stripped, 2);
    if (match) return match;
  }

  // Strip hint/discount/badge text then trailing numbers
  stripped = cleaned
    .replace(/[Hh]int\s*[Ll][vV]\.?\s*\d/g, '')
    .replace(/\d+%\s*[Oo][Ff][Ff]/gi, '')
    .replace(/\s+\d{1,3}\s*[\+]?\s*$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (stripped.length >= 3 && stripped !== cleaned) {
    match = fuzzyMatchSkill(stripped, 2);
    if (match) return match;
  }

  // Try progressively shorter word prefixes (handles trailing badge garbage)
  const words = cleaned.split(/\s+/);
  for (let n = Math.min(words.length - 1, 7); n >= 1; n--) {
    const prefix = words.slice(0, n).join(' ');
    if (prefix.length >= 3) {
      match = fuzzyMatchSkill(prefix, 2);
      if (match) return match;
    }
  }

  return null;
}

function tryMatchLine(line) {
  // Try both cleaning strategies — pipes-as-I first, then strip-noise
  const pipesAsI = cleanLinePipesAsI(line);
  const stripped = cleanLineStripNoise(line);

  let best = null;
  for (const cleaned of [pipesAsI, stripped]) {
    const match = _tryMatchCleaned(cleaned);
    if (!match) continue;
    if (!best || match.confidence > best.confidence) {
      best = match;
    }
    if (best.confidence >= 1.0) return best;
  }
  return best;
}

function parseSkillsFromOCR(ocrText) {
  const lines = ocrText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const detectedSkills = [];
  const seenSkills = new Set();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = tryMatchLine(line);
    if (!match || !match.skill) continue;

    // Reject low-confidence matches (< 65%)
    if (match.confidence < 0.65) continue;

    // Avoid duplicate skills
    const normName = normalize(match.skill.name);
    if (seenSkills.has(normName)) continue;
    seenSkills.add(normName);

    // Search for hint: same line ("20% OFF"), 1-2 lines above ("Hint Lvl 2"), then below
    let hint = null;
    hint = extractHintLevel(lines[i]);
    if (hint === null && i > 0) hint = extractHintLevel(lines[i - 1]);
    if (hint === null && i > 1) hint = extractHintLevel(lines[i - 2]);
    if (hint === null && i + 1 < lines.length) hint = extractHintLevel(lines[i + 1]);

    detectedSkills.push({
      name: match.skill.name,
      hint: hint !== null ? hint : 0,
      confidence: match.confidence || 0,
      rawText: line
    });
  }

  return detectedSkills;
}

function displayOCRResults(detectedSkills) {
  const resultsList = document.getElementById('ocr-results-list');
  if (!resultsList) return;

  if (detectedSkills.length === 0) {
    resultsList.innerHTML = '<div class="no-results">No skills detected. Please try a different image or adjust the crop area.</div>';
    return;
  }

  let html = '';
  detectedSkills.forEach((skill, index) => {
    const confidencePct = Math.round(skill.confidence * 100);
    let confidenceClass = 'low';
    if (confidencePct >= 80) confidenceClass = 'high';
    else if (confidencePct >= 60) confidenceClass = 'medium';

    html += `
      <div class="ocr-result-item" data-skill-index="${index}" style="cursor: pointer;" title="Click to edit this skill">
        <input type="checkbox" id="ocr-skill-${index}" class="ocr-skill-checkbox" checked>
        <div class="ocr-skill-info">
          <div class="ocr-skill-name">${escapeHTML(skill.name)}</div>
          <div class="ocr-skill-meta">
            <span class="ocr-hint">Hint Lv ${skill.hint}</span>
          </div>
        </div>
        <div class="confidence-badge confidence-${confidenceClass}">${confidencePct}%</div>
        <button type="button" class="ocr-flag-btn" data-flag-index="${index}" title="Flag this entry as incorrect">&#9873;</button>
      </div>
    `;
  });

  resultsList.innerHTML = html;

  const skillItems = resultsList.querySelectorAll('.ocr-result-item');
  skillItems.forEach((item) => {
    item.addEventListener('click', function(e) {
      if (e.target.classList.contains('ocr-skill-checkbox') ||
          e.target.classList.contains('ocr-flag-btn')) {
        return;
      }
      const index = parseInt(this.getAttribute('data-skill-index'), 10);
      if (!isNaN(index)) {
        openCorrectionModal(index);
      }
    });
  });

  // Flag buttons — save flagged entries to localStorage for manual review
  resultsList.querySelectorAll('.ocr-flag-btn').forEach(btn => {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      const idx = parseInt(this.dataset.flagIndex, 10);
      const skill = detectedSkills[idx];
      if (!skill) return;

      const flags = JSON.parse(localStorage.getItem('ocr-flagged-entries') || '[]');
      flags.push({
        name: skill.name,
        rawText: skill.rawText,
        confidence: skill.confidence,
        hint: skill.hint,
        timestamp: new Date().toISOString()
      });
      localStorage.setItem('ocr-flagged-entries', JSON.stringify(flags));

      this.textContent = '\u2713';
      this.disabled = true;
      this.title = 'Flagged for review';
      console.log('[ocr] Flagged entry:', skill.name, '| raw:', skill.rawText);
    });
  });
}

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// OCR Results: Add skills to calculator handlers
const ocrAddAllBtn = document.getElementById('ocr-add-all');
const ocrAddSelectedBtn = document.getElementById('ocr-add-selected');
const ocrResultsCloseBtn = document.getElementById('ocr-results-close');
const ocrResultsPanel = document.getElementById('ocr-results-panel');

if (ocrAddAllBtn) {
  ocrAddAllBtn.addEventListener('click', function() {
    if (!window.ocrDetectedSkills || window.ocrDetectedSkills.length === 0) {
      return;
    }

    if (typeof window.applyOCRSkills === 'function') {
      // Show loading state
      const originalText = ocrAddAllBtn.textContent;
      ocrAddAllBtn.classList.add('loading');
      ocrAddAllBtn.disabled = true;

      // Use setTimeout to allow UI to update
      setTimeout(() => {
        window.applyOCRSkills(window.ocrDetectedSkills);

        // Show success state
        ocrAddAllBtn.classList.remove('loading');
        ocrAddAllBtn.classList.add('success');
        ocrAddAllBtn.textContent = 'Skills Applied!';

        // Hide panel and reset button after delay
        setTimeout(() => {
          if (ocrResultsPanel) {
            ocrResultsPanel.style.display = 'none';
          }
          ocrAddAllBtn.classList.remove('success');
          ocrAddAllBtn.textContent = originalText;
          ocrAddAllBtn.disabled = false;
        }, 1500);
      }, 50);
    } else {
      console.error('[ocr] applyOCRSkills function not found');
      alert('Calculator integration not available. Please refresh the page.');
    }
  });
}

if (ocrAddSelectedBtn) {
  ocrAddSelectedBtn.addEventListener('click', function() {
    if (!window.ocrDetectedSkills || window.ocrDetectedSkills.length === 0) {
      return;
    }

    const checkboxes = document.querySelectorAll('.ocr-skill-checkbox');
    const selectedSkills = [];

    checkboxes.forEach((checkbox, index) => {
      if (checkbox.checked && window.ocrDetectedSkills[index]) {
        selectedSkills.push(window.ocrDetectedSkills[index]);
      }
    });

    if (selectedSkills.length === 0) {
      alert('Please select at least one skill to add.');
      return;
    }

    if (typeof window.applyOCRSkills === 'function') {
      // Show loading state
      const originalText = ocrAddSelectedBtn.textContent;
      ocrAddSelectedBtn.classList.add('loading');
      ocrAddSelectedBtn.disabled = true;

      // Use setTimeout to allow UI to update
      setTimeout(() => {
        window.applyOCRSkills(selectedSkills);

        // Show success state
        ocrAddSelectedBtn.classList.remove('loading');
        ocrAddSelectedBtn.classList.add('success');
        ocrAddSelectedBtn.textContent = 'Skills Applied!';

        // Hide panel and reset button after delay
        setTimeout(() => {
          if (ocrResultsPanel) {
            ocrResultsPanel.style.display = 'none';
          }
          ocrAddSelectedBtn.classList.remove('success');
          ocrAddSelectedBtn.textContent = originalText;
          ocrAddSelectedBtn.disabled = false;
        }, 1500);
      }, 50);
    } else {
      console.error('[ocr] applyOCRSkills function not found');
      alert('Calculator integration not available. Please refresh the page.');
    }
  });
}

if (ocrResultsCloseBtn) {
  ocrResultsCloseBtn.addEventListener('click', function() {
    if (ocrResultsPanel) {
      ocrResultsPanel.style.display = 'none';
    }
  });
}

// Manual correction modal handling
const correctionModal = document.getElementById('skill-correction-modal');
const correctionModalClose = document.getElementById('correction-modal-close');
const correctionModalCancel = document.getElementById('correction-modal-cancel');
const correctionModalSave = document.getElementById('correction-modal-save');
const correctionSkillName = document.getElementById('correction-skill-name');
const correctionSkillCost = document.getElementById('correction-skill-cost');
const correctionSkillHint = document.getElementById('correction-skill-hint');

let editingSkillIndex = -1;
let correctionSkillDatalist = null;

function getOrCreateCorrectionDatalist() {
  if (correctionSkillDatalist) return correctionSkillDatalist;

  correctionSkillDatalist = document.getElementById('correction-skills-datalist');
  if (!correctionSkillDatalist) {
    correctionSkillDatalist = document.createElement('datalist');
    correctionSkillDatalist.id = 'correction-skills-datalist';
    document.body.appendChild(correctionSkillDatalist);
  }

  return correctionSkillDatalist;
}

function updateCorrectionDatalist(query) {
  const datalist = getOrCreateCorrectionDatalist();
  if (!datalist) return;

  datalist.innerHTML = '';

  if (!query || !skillNameIndex || skillNameIndex.size === 0) {
    const allSkills = Array.from(skillNameIndex.values()).slice(0, 50);
    allSkills.forEach(skill => {
      const option = document.createElement('option');
      option.value = skill.name;
      datalist.appendChild(option);
    });
    return;
  }

  const queryNorm = normalize(query);
  const matches = [];

  for (const [normName, skill] of skillNameIndex) {
    if (normName.includes(queryNorm)) {
      matches.push({ skill, distance: 0 });
    } else {
      const dist = levenshteinDistance(queryNorm, normName);
      if (dist <= 3) {
        matches.push({ skill, distance: dist });
      }
    }
  }

  matches.sort((a, b) => {
    if (a.distance !== b.distance) return a.distance - b.distance;
    return a.skill.name.localeCompare(b.skill.name);
  });

  matches.slice(0, 20).forEach(match => {
    const option = document.createElement('option');
    option.value = match.skill.name;
    datalist.appendChild(option);
  });
}

function openCorrectionModal(index) {
  if (!window.ocrDetectedSkills || index < 0 || index >= window.ocrDetectedSkills.length) {
    return;
  }

  const skill = window.ocrDetectedSkills[index];
  editingSkillIndex = index;

  if (correctionSkillName) {
    correctionSkillName.value = skill.name || '';
    updateCorrectionDatalist(skill.name || '');
  }
  if (correctionSkillCost) correctionSkillCost.value = skill.cost !== null ? skill.cost : '';
  if (correctionSkillHint) correctionSkillHint.value = skill.hint !== null ? skill.hint : '';

  if (correctionModal) {
    correctionModal.style.display = 'block';
  }
}

function closeCorrectionModal() {
  if (correctionModal) {
    correctionModal.style.display = 'none';
  }
  editingSkillIndex = -1;
}

function saveCorrectionModal() {
  if (editingSkillIndex < 0 || !window.ocrDetectedSkills) {
    return;
  }

  const name = correctionSkillName ? correctionSkillName.value.trim() : '';
  if (!name) {
    alert('Skill name is required');
    return;
  }

  const cost = correctionSkillCost && correctionSkillCost.value !== ''
    ? parseInt(correctionSkillCost.value, 10)
    : null;
  const hint = correctionSkillHint && correctionSkillHint.value !== ''
    ? parseInt(correctionSkillHint.value, 10)
    : 0;

  if (cost !== null && (cost < 0 || cost > 999)) {
    alert('Cost must be between 0 and 999');
    return;
  }

  if (hint !== null && (hint < 0 || hint > 5)) {
    alert('Hint level must be between 0 and 5');
    return;
  }

  window.ocrDetectedSkills[editingSkillIndex] = {
    ...window.ocrDetectedSkills[editingSkillIndex],
    name: name,
    cost: cost,
    hint: hint
  };

  displayOCRResults(window.ocrDetectedSkills);
  closeCorrectionModal();
}

if (correctionModalClose) {
  correctionModalClose.addEventListener('click', closeCorrectionModal);
}

if (correctionModalCancel) {
  correctionModalCancel.addEventListener('click', closeCorrectionModal);
}

if (correctionModalSave) {
  correctionModalSave.addEventListener('click', saveCorrectionModal);
}

if (correctionModal) {
  correctionModal.addEventListener('click', function(e) {
    if (e.target === correctionModal) {
      closeCorrectionModal();
    }
  });
}

if (correctionSkillName) {
  getOrCreateCorrectionDatalist();

  correctionSkillName.setAttribute('list', 'correction-skills-datalist');
  correctionSkillName.setAttribute('autocomplete', 'off');

  correctionSkillName.addEventListener('input', function() {
    updateCorrectionDatalist(this.value);
  });

  correctionSkillName.addEventListener('focus', function() {
    if (!this.value) {
      updateCorrectionDatalist('');
    }
  });
}
