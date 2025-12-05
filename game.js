// ==== НАСТРОЙКИ ====

// Если потом захочешь слать результат на API, пропиши сюда базовый URL.
// Пока null — ничего никуда не отправляется.
const API_BASE_URL = null;

// ==== Telegram WebApp (если есть) ====
const tg = window.Telegram ? window.Telegram.WebApp : null;
if (tg) {
  tg.ready();
}

// ==== DOM ====
const canvas = document.getElementById("game-canvas");
const ctx = canvas.getContext("2d");

const hpFill = document.getElementById("hp-fill");
const accuracyEl = document.getElementById("accuracy");
const rankEl = document.getElementById("rank");
const comboEl = document.getElementById("combo");
const scoreEl = document.getElementById("score");

const trackSelect = document.getElementById("track-select");
const diffSelect = document.getElementById("difficulty-select");
const startBtn = document.getElementById("start-btn");

// ==== РАЗМЕР КАНВАСА ====
function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;

  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener("resize", resizeCanvas);
resizeCanvas();

// ==== ИГРОВАЯ ЛОГИКА ====
let audio = null;
let isPlaying = false;

const NOTE_RADIUS = 28;
const NOTE_APPROACH = 1.0; // за сколько секунд до идеального момента нота появляется
const HIT_WINDOW = 0.12;   // окно попадания ±сек
const MAX_HP = 100;

let hp = MAX_HP;
let score = 0;
let combo = 0;
let maxCombo = 0;
let totalNotes = 0;
let hitNotes = 0;

let notes = [];

const difficultySettings = {
  easy: { interval: 0.8, hpLose: 8, hpGain: 4 },
  normal: { interval: 0.6, hpLose: 9, hpGain: 4.5 },
  hard: { interval: 0.45, hpLose: 10, hpGain: 5 },
  extreme: { interval: 0.32, hpLose: 12, hpGain: 6 }
};

class Note {
  constructor(time, x, y) {
    this.time = time;
    this.x = x;
    this.y = y;
    this.state = "pending"; // pending, visible, hit, miss, gone
    this.hitTime = null;
  }
}

// генерация нот
function generateNotes(duration, diffKey) {
  const cfg = difficultySettings[diffKey] || difficultySettings.easy;
  const interval = cfg.interval;
  const margin = 0.5;
  const w = canvas.width / (window.devicePixelRatio || 1);
  const h = canvas.height / (window.devicePixelRatio || 1);

  const list = [];
  let t = margin;
  while (t < duration - margin) {
    const x = NOTE_RADIUS + Math.random() * (w - NOTE_RADIUS * 2);
    const y = NOTE_RADIUS + Math.random() * (h - NOTE_RADIUS * 2);
    list.push(new Note(t, x, y));
    t += interval;
  }
  return list;
}

function updateHud() {
  const acc = totalNotes > 0 ? (hitNotes / totalNotes) * 100 : 100;
  accuracyEl.textContent = `ACC: ${acc.toFixed(1)}%`;

  let rank = "D";
  if (acc >= 95) rank = "S";
  else if (acc >= 90) rank = "A";
  else if (acc >= 80) rank = "B";
  else if (acc >= 70) rank = "C";
  rankEl.textContent = rank;

  comboEl.textContent = `Combo: ${combo}`;
  scoreEl.textContent = `Score: ${score}`;

  const hpPercent = Math.max(0, Math.min(1, hp / MAX_HP)) * 100;
  hpFill.style.width = hpPercent + "%";
}

// рисуем ноту
function drawNote(note, t) {
  const appearTime = note.time - NOTE_APPROACH;

  if (note.state === "pending") {
    if (t >= appearTime) {
      note.state = "visible";
    } else {
      return;
    }
  }

  if (note.state === "visible") {
    const progress = Math.min(1, Math.max(0, (t - appearTime) / NOTE_APPROACH));
    const outerR = NOTE_RADIUS * (0.8 + 0.4 * (1 - progress));

    ctx.save();
    ctx.strokeStyle = "#222";
    ctx.lineWidth = 3;
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.beginPath();
    ctx.arc(note.x, note.y, outerR, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(note.x, note.y, 6, 0, Math.PI * 2);
    ctx.fillStyle = "#ff7043";
    ctx.fill();
    ctx.restore();

    // промах по времени
    if (t > note.time + HIT_WINDOW) {
      note.state = "miss";
      onMiss();
    }
    return;
  }

  if (note.state === "hit") {
    const elapsed = t - note.hitTime;
    const DURATION = 0.2;
    if (elapsed > DURATION) {
      note.state = "gone";
      return;
    }
    const progress = elapsed / DURATION;
    const maxR = NOTE_RADIUS * 1.8;
    const r = NOTE_RADIUS + (maxR - NOTE_RADIUS) * progress;
    const alpha = 1 - progress;

    ctx.save();
    ctx.lineWidth = 3;
    ctx.strokeStyle = `rgba(20,20,20,${alpha})`;
    ctx.fillStyle = `rgba(255,204,128,${alpha * 0.6})`;
    ctx.beginPath();
    ctx.arc(note.x, note.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    return;
  }

  if (note.state === "miss") {
    const elapsed = t - note.time;
    const DURATION = 0.15;
    if (elapsed > DURATION) {
      note.state = "gone";
      return;
    }
    const progress = elapsed / DURATION;
    const r = NOTE_RADIUS * (1 + 0.5 * progress);
    const alpha = 1 - progress;

    ctx.save();
    ctx.lineWidth = 2;
    ctx.strokeStyle = `rgba(244,67,54,${alpha})`;
    ctx.beginPath();
    ctx.arc(note.x, note.y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

function onHit(note, t) {
  const dt = Math.abs(note.time - t);
  if (dt > HIT_WINDOW || note.state !== "visible") return false;

  note.state = "hit";
  note.hitTime = t;

  combo += 1;
  if (combo > maxCombo) maxCombo = combo;

  hitNotes += 1;
  totalNotes += 1;

  const baseScore = 300;
  score += baseScore + combo * 5;

  const cfg = difficultySettings[diffSelect.value] || difficultySettings.easy;
  hp = Math.min(MAX_HP, hp + cfg.hpGain);

  updateHud();
  return true;
}

function onMiss() {
  totalNotes += 1;
  combo = 0;

  const cfg = difficultySettings[diffSelect.value] || difficultySettings.easy;
  hp -= cfg.hpLose;
  if (hp <= 0) {
    hp = 0;
    updateHud();
    endGame("hp");
  } else {
    updateHud();
  }
}

// клики по канвасу
function handlePointer(ev) {
  if (!isPlaying) return;

  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const scaleX = canvas.width / dpr / rect.width;
  const scaleY = canvas.height / dpr / rect.height;

  const x = (ev.clientX - rect.left) * scaleX;
  const y = (ev.clientY - rect.top) * scaleY;
  const t = audio ? audio.currentTime : 0;

  let best = null;
  let bestDist = Infinity;

  for (const note of notes) {
    if (note.state !== "visible") continue;
    const dx = note.x - x;
    const dy = note.y - y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < NOTE_RADIUS * 1.2 && dist < bestDist) {
      bestDist = dist;
      best = note;
    }
  }

  if (best) {
    onHit(best, t);
  }
}

canvas.addEventListener("pointerdown", handlePointer);

// игровой цикл
function gameLoop() {
  if (!isPlaying) return;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const t = audio ? audio.currentTime : 0;

  for (const note of notes) {
    if (note.state === "gone") continue;
    drawNote(note, t);
  }

  const activeNotes = notes.some((n) => n.state !== "gone");
  if (audio && audio.ended && !activeNotes) {
    endGame("finished");
    return;
  }

  requestAnimationFrame(gameLoop);
}

// старт игры
function startGame() {
  if (isPlaying && audio) audio.pause();

  const trackId = trackSelect.value;
  const diff = diffSelect.value;

  hp = MAX_HP;
  score = 0;
  combo = 0;
  maxCombo = 0;
  totalNotes = 0;
  hitNotes = 0;
  updateHud();

  if (audio) audio.pause();
  audio = new Audio(`${trackId}.mp3`);

  audio.addEventListener("loadedmetadata", () => {
    const duration = audio.duration || 60;
    notes = generateNotes(duration, diff);
    isPlaying = true;

    audio.currentTime = 0;
    audio.play().catch((e) => console.warn("audio.play error", e));
    requestAnimationFrame(gameLoop);
  });

  audio.load();
}

// завершение игры
function endGame(reason) {
  if (!isPlaying) return;
  isPlaying = false;
  if (audio) audio.pause();

  const acc = totalNotes > 0 ? (hitNotes / totalNotes) * 100 : 0;

  const result = {
    trackId: trackSelect.value,
    difficulty: diffSelect.value,
    score,
    accuracy: acc,
    maxCombo,
    reason
  };

  console.log("Game result:", result);

  // Отправка на свой API (если захочешь)
  if (API_BASE_URL) {
    fetch(`${API_BASE_URL}/score`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: tg?.initDataUnsafe?.user?.id ?? null,
        username: tg?.initDataUnsafe?.user?.username ?? null,
        ...result
      })
    }).catch((err) => console.error("API error:", err));
  }

  // Можно дополнительно слать в бота как WebApp data
  // if (tg) tg.sendData(JSON.stringify(result));
}

startBtn.addEventListener("click", () => {
  startGame();
});
