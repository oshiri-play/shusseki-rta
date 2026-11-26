// 難易度、妨害、公開先、セリフ、成績はここで変更できます。
const SETTINGS = {
  durationSeconds: 60,
  countdownSeconds: 3,
  publicUrl: "",
  windows: [
    { from: 0, seconds: 6 },
    { from: 15, seconds: 5 },
    { from: 30, seconds: 4 },
    { from: 45, seconds: 3 },
  ],
  slides: { atSeconds: [12, 37], durationMs: 800 },
  wifi: { eligibleAfterSeconds: [18, 43], durationMs: 1000 },
  urgentSeconds: 10,
  speech: {
    opening: ["今から出席を取ります！！", "番号を打った回数が多いほど、好成績をつけます！！"],
    finish: "そこまで！！",
    timeout: ["はい、もう締め切ります", "遅かった人は欠席です"],
    slide: "あ、違う資料でしたね",
    wifi: "あれ、また学内Wi-Fiが……",
  },
  slideTopics: [
    ["日本経済の現状", "第4回　景気指標の読み方"],
    ["前回の授業の復習", "前回のキーワードと確認問題"],
    ["本日の講義テーマ", "資料を読み解くための視点"],
  ],
  grades: [
    { min: 25, grade: "S", rank: "出席の化身", comment: "授業内容は何も覚えていませんが、出席だけは完璧です。" },
    { min: 20, grade: "A", rank: "フル単確定演出", comment: "出席に対する熱意だけは認めます。" },
    { min: 15, grade: "B", rank: "出席ガチ勢", comment: "その熱意を勉強にも向けましょう。" },
    { min: 10, grade: "C", rank: "単位ギリギリ大学生", comment: "単位を与えるか検討します。" },
    { min: 5, grade: "D", rank: "再履", comment: "来年度もお会いしましょう。" },
    { min: 0, grade: "F", rank: "教授に存在を忘れられた人", comment: "あなた、履修登録していますか？" },
  ],
};

const byId = (id) => document.getElementById(id);
const app = byId("app");
const monitor = byId("monitor");
const monitorContent = byId("monitor-content");
const titleContent = monitorContent.innerHTML;
const classroom = byId("classroom");
const controls = byId("controls");
const submitButton = byId("submit");
const keypad = byId("keypad");
const keys = keypad.querySelectorAll("button");
const track = byId("window-track");
const fill = byId("window-fill");
const clock = byId("clock");
const countdown = byId("countdown");
const durationMs = SETTINGS.durationSeconds * 1000;
const bestKey = "shusseki-rta.best";
const muteKey = "shusseki-rta.muted";
const subtitle = byId("subtitle");
const gradeNotice = byId("grade-notice");
const phoneWifi = byId("phone-wifi");
const sceneTimers = new Set();

let screen = "title";
let frame = 0;
let round;
let game;
let report;
let audio;
let lastCountdown;
let countdownEnd;
let currentVoice;
let best = readBest();
let muted = readStorage(muteKey) === "1";

function readStorage(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function saveStorage(key, value) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // ブラウザの設定で保存が無効でも、ゲーム内の記録は維持する。
  }
}

function readBest() {
  const stored = readStorage(bestKey);
  const value = Number(stored);
  return stored !== null && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function syncSound() {
  const button = byId("mute");
  button.textContent = muted ? "音声 OFF" : "音声 ON";
  button.setAttribute("aria-pressed", String(muted));
}

const tones = {
  tick: [[440, 0, .08]],
  go: [[660, 0, .11], [880, .10, .12]],
  correct: [[523, 0, .075], [659, .055, .085], [880, .11, .15]],
  wrong: [[220, 0, .11], [165, .08, .15]],
  wifi: [[415, 0, .09], [310, .09, .07], [207, .16, .12]],
  urgent: [[510, 0, .13], [510, .17, .13]],
  announce: [[196, 0, .20], [392, .03, .21], [523, .15, .20], [784, .28, .34]],
  notice: [[784, 0, .09], [1047, .11, .17]],
  finish: [[660, 0, .1], [523, .11, .1], [392, .23, .18]],
};

function enableSound() {
  if (muted) return;
  const Audio = window.AudioContext || window.webkitAudioContext;
  if (!Audio) return;
  try {
    audio ||= new Audio();
    audio.resume().catch(() => {});
  } catch {
    // 音声を使用できない環境でもプレイできる。
  }
}

function playSound(name) {
  if (muted || audio?.state !== "running") return;
  const now = audio.currentTime;
  for (const [frequency, offset, length] of tones[name]) {
    const time = now + offset;
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = "triangle";
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(.0001, time);
    gain.gain.exponentialRampToValueAtTime(.13, time + .012);
    gain.gain.exponentialRampToValueAtTime(.0001, time + length);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start(time);
    oscillator.stop(time + length);
  }
}

function playDeskImpact() {
  if (muted || audio?.state !== "running") return;
  const now = audio.currentTime;
  const thump = audio.createOscillator();
  const thumpGain = audio.createGain();
  thump.frequency.setValueAtTime(136, now);
  thump.frequency.exponentialRampToValueAtTime(53, now + .16);
  thumpGain.gain.setValueAtTime(.01, now);
  thumpGain.gain.exponentialRampToValueAtTime(.52, now + .007);
  thumpGain.gain.exponentialRampToValueAtTime(.0001, now + .22);
  thump.connect(thumpGain).connect(audio.destination);
  thump.start(now);
  thump.stop(now + .23);

  const knock = audio.createBufferSource();
  knock.buffer = audio.createBuffer(1, Math.round(audio.sampleRate * .10), audio.sampleRate);
  const samples = knock.buffer.getChannelData(0);
  let seed = 14623;
  for (let i = 0; i < samples.length; i++) {
    seed = (seed * 16807) % 2147483647;
    samples[i] = seed / 1073741824 - 1;
  }
  const wood = audio.createBiquadFilter();
  wood.type = "bandpass";
  wood.frequency.value = 870;
  wood.Q.value = .75;
  const knockGain = audio.createGain();
  knockGain.gain.setValueAtTime(.72, now);
  knockGain.gain.exponentialRampToValueAtTime(.0001, now + .10);
  knock.connect(wood).connect(knockGain).connect(audio.destination);
  knock.start(now);
}

function stopVoice() {
  if (!currentVoice) return;
  currentVoice = null;
  window.speechSynthesis.cancel();
}

function showSubtitle(text) {
  subtitle.replaceChildren();
  for (const phrase of text.match(/[^、]+、?/g) ?? []) {
    const span = document.createElement("span");
    span.textContent = phrase;
    subtitle.append(span);
  }
  subtitle.hidden = !text;
  window.lectureWorld?.setTalking(Boolean(text));
}

function speak(text) {
  const synthesis = window.speechSynthesis;
  if (muted || !synthesis || !window.SpeechSynthesisUtterance) return;
  const voice = synthesis.getVoices().find((item) => item.localService && /^ja(?:-|$)/i.test(item.lang));
  if (!voice) return;
  const line = new SpeechSynthesisUtterance(text);
  line.voice = voice;
  line.lang = voice.lang;
  line.pitch = .78;
  line.rate = 1.45;
  line.onend = line.onerror = () => {
    if (currentVoice === line) currentVoice = null;
  };
  currentVoice = line;
  synthesis.speak(line);
}

// スキップや画面遷移のたびに、残りの演出予約をまとめて解除する。
function sceneCue(afterMs, action) {
  const timer = setTimeout(() => {
    sceneTimers.delete(timer);
    action();
  }, afterMs);
  sceneTimers.add(timer);
}

function showScreen(next) {
  for (const timer of sceneTimers) clearTimeout(timer);
  sceneTimers.clear();
  stopVoice();
  showSubtitle("");
  gradeNotice.hidden = true;
  phoneWifi.hidden = true;
  controls.classList.remove("phone-correct", "phone-error");
  screen = next;
  app.dataset.screen = next;
  const showPhone = next === "play" || next === "countdown" || next === "ending";
  classroom.hidden = next === "result";
  byId("hud").hidden = !showPhone;
  controls.hidden = !showPhone && next !== "opening";
  countdown.hidden = next !== "countdown";
  byId("title-actions").hidden = next !== "title";
  byId("opening-actions").hidden = next !== "opening";
  byId("result").hidden = next !== "result";
  app.classList.remove("urgent", "phone-ready");
  window.lectureWorld?.setUrgent(false);
  window.lectureWorld?.setScreen(next);
}

function showMonitor(mode, label, content, screenText) {
  monitor.dataset.mode = mode;
  byId("monitor-label").textContent = label;
  monitorContent.innerHTML = content;
  track.hidden = mode !== "code";
  window.lectureWorld?.setDisplay(mode, label, screenText ?? monitorContent.textContent);
}

function say(message, mood = "stern") {
  byId("speech").textContent = message;
  byId("speech").hidden = !message;
  classroom.dataset.mood = mood;
  window.lectureWorld?.setMood(mood);
}

function showTitle() {
  cancelAnimationFrame(frame);
  showScreen("title");
  showMonitor("title", "出席確認システム", titleContent);
  monitor.classList.remove("flash", "flash-error");
  say("");
  byId("title-best").textContent = best === null ? "―" : best + " 回";
}

function showOpening() {
  enableSound();
  if (!muted) window.speechSynthesis?.getVoices();
  resetGame();
  showScreen("opening");
  showMonitor("opening", "講義資料", '<div class="opening-slide"><strong>【本日の成績評価】</strong><div>出席回数：100％</div><div>授業の理解度：0％</div></div>',
    "本日の成績評価\n出席回数：100％\n授業の理解度：0％");
  say("");
  sceneCue(2000, () => {
    playDeskImpact();
    showSubtitle(SETTINGS.speech.opening[0]);
    speak(SETTINGS.speech.opening[0]);
  });
  sceneCue(3350, () => {
    showSubtitle(SETTINGS.speech.opening[1]);
    speak(SETTINGS.speech.opening[1]);
  });
  sceneCue(5150, () => {
    showSubtitle("");
    showMonitor("announce", "出席確認", '<strong class="announcement">出席タイム スタート！！</strong>');
    playSound("announce");
  });
  sceneCue(5950, () => { byId("hud").hidden = false; });
  sceneCue(7300, () => { app.classList.add("phone-ready"); });
  sceneCue(7400, () => {
    startPlay(performance.now());
    tick();
  });
  byId("ready").focus({ preventScroll: true });
}

function formatCode(number) {
  return [number.slice(0, 3), number.slice(3, 6), number.slice(6, 9)].join(" ");
}

function renderInput() {
  const input = round?.input ?? "";
  const unlocked = screen === "play" && game.phase === "code";
  byId("input-view").textContent = formatCode(input.padEnd(9, "·"));
  byId("input-count").textContent = input.length + " / 9";
  controls.classList.toggle("locked", !unlocked);
  for (const key of keys) key.disabled = !unlocked;
  submitButton.disabled = !unlocked || input.length !== 9;
  phoneWifi.hidden = !(screen === "play" && game.phase === "wifi");
}

function renderStats() {
  byId("score").textContent = game.score;
  byId("misses").textContent = game.misses;
}

function resetGame() {
  cancelAnimationFrame(frame);
  round = null;
  game = { score: 0, misses: 0, totalInputMs: 0, slide: 0, wifi: 0, timeouts: 0, urgent: false, phase: "countdown" };
  monitor.classList.remove("flash", "flash-error");
  clock.textContent = SETTINGS.durationSeconds.toFixed(1);
  renderStats();
  renderInput();
}

function startCountdown() {
  enableSound();
  resetGame();
  lastCountdown = null;
  countdownEnd = performance.now() + SETTINGS.countdownSeconds * 1000;
  showScreen("countdown");
  showMonitor("ready", "出席確認システム", '<div class="number">――― ――― ―――</div>');
  say("");
  tick();
}

function nextCode(at) {
  const seconds = (at - game.start) / 1000;
  const rule = SETTINGS.windows.findLast((item) => seconds >= item.from) ?? SETTINGS.windows[0];
  const windowMs = rule.seconds * 1000;
  let code = "";
  for (let i = 0; i < 9; i++) code += Math.floor(Math.random() * 10);
  if (code === round?.code) code = String((Number(code) + 1) % 1e9).padStart(9, "0");
  round = { code, input: "", started: at, end: at + windowMs, windowMs };
  renderCode();
}

function renderCode() {
  game.phase = "code";
  showMonitor("code", "出席番号", '<div class="number">' + formatCode(round.code) + '</div>');
  updateGauge(1);
  renderInput();
}

function updateGauge(fraction) {
  fill.style.transform = "scaleX(" + fraction + ")";
  window.lectureWorld?.setGauge(fraction);
}

function flashFeedback(correct) {
  monitor.classList.remove("flash", "flash-error");
  controls.classList.remove("phone-correct", "phone-error");
  // 連続提出でも毎回フラッシュを最初から再生する。
  void controls.offsetWidth;
  monitor.classList.add(correct ? "flash" : "flash-error");
  controls.classList.add(correct ? "phone-correct" : "phone-error");
}

function feedback(message, mood, at) {
  say(message, mood);
  game.feedbackEnd = at + 950;
}

function startPlay(at) {
  game.start = at;
  game.end = at + durationMs;
  showScreen("play");
  nextCode(at);
  say("");
  playSound("go");
}

function showSlide(at) {
  const [title, subtitle] = SETTINGS.slideTopics[game.slide % SETTINGS.slideTopics.length];
  game.slide++;
  game.phase = "slide";
  game.eventEnd = at + SETTINGS.slides.durationMs;
  game.feedbackEnd = 0;
  showMonitor("slide", "講義資料", '<div class="slide"><strong></strong><small></small></div>', title + "\n" + subtitle);
  monitorContent.querySelector("strong").textContent = title;
  monitorContent.querySelector("small").textContent = subtitle;
  say(SETTINGS.speech.slide, "slide");
  renderInput();
}

function showWifi(at) {
  game.wifi++;
  game.phase = "wifi";
  game.eventEnd = at + SETTINGS.wifi.durationMs;
  game.feedbackEnd = 0;
  round.input = "";
  showMonitor("wifi", "学内ネットワーク", '<div class="wifi"><strong>学内Wi-Fiに接続しています……</strong><small>通信状況が不安定です</small></div>',
    "学内Wi-Fiに接続しています……\n通信状況が不安定です");
  say(SETTINGS.speech.wifi, "wifi");
  renderInput();
  playSound("wifi");
}

function advance(now) {
  if (screen !== "play") return;
  if (now >= game.end) {
    finish();
    return;
  }
  // 次の境界を時刻順に処理。フレームが遅れても締切と妨害時間は延びない。
  while (true) {
    if (game.phase !== "code") {
      if (now < game.eventEnd) break;
      if (game.phase === "slide") {
        round.started += SETTINGS.slides.durationMs;
        round.end += SETTINGS.slides.durationMs;
        renderCode();
      } else {
        nextCode(game.eventEnd);
      }
      say("");
      continue;
    }

    const scheduledSlide = SETTINGS.slides.atSeconds[game.slide];
    const slideAt = scheduledSlide === undefined ? Infinity : game.start + scheduledSlide * 1000;
    if (round.end <= now && round.end <= slideAt) {
      const at = round.end;
      nextCode(at);
      const messages = SETTINGS.speech.timeout;
      feedback(messages[game.timeouts % messages.length], "deadline", at);
      game.timeouts++;
    } else if (now >= slideAt) {
      // Wi-Fi中にスライドが予定されていた場合は、Wi-Fiの終了時刻から表示。
      showSlide(Math.max(slideAt, round.started));
    } else {
      break;
    }
  }

  if (!game.urgent && game.end - now <= SETTINGS.urgentSeconds * 1000) {
    game.urgent = true;
    app.classList.add("urgent");
    window.lectureWorld?.setUrgent(true);
    playSound("urgent");
  }
  if (game.feedbackEnd && now >= game.feedbackEnd) {
    game.feedbackEnd = 0;
    if (game.phase === "code") say("");
  }
  const remaining = (Math.ceil((game.end - now) / 100) / 10).toFixed(1);
  if (clock.textContent !== remaining) clock.textContent = remaining;
  if (game.phase === "code") {
    updateGauge(Math.min(1, (round.end - now) / round.windowMs));
  }
}

function tick() {
  const now = performance.now();
  if (screen === "countdown") {
    const value = Math.ceil((countdownEnd - now) / 1000);
    if (value <= 0) {
      startPlay(countdownEnd);
    } else if (value !== lastCountdown) {
      lastCountdown = value;
      countdown.textContent = value;
      playSound("tick");
    }
  }
  advance(now);
  if (screen === "play" || screen === "countdown") frame = requestAnimationFrame(tick);
}

function handleInput(action) {
  const now = performance.now();
  advance(now);
  if (screen !== "play" || game.phase !== "code") return;
  if (action === "submit") {
    if (round.input.length === 9) submitAnswer(now);
  } else if (action === "erase") {
    round.input = round.input.slice(0, -1);
  } else if (round.input.length < 9) {
    round.input += action;
  }
  renderInput();
}

function submitAnswer(now) {
  if (round.input !== round.code) {
    game.misses++;
    round.input = "";
    renderStats();
    flashFeedback(false);
    feedback("", "surprise", now);
    playSound("wrong");
    return;
  }

  game.score++;
  game.totalInputMs += Math.max(0, now - round.started);
  renderStats();
  flashFeedback(true);
  playSound("correct");
  if (navigator.userActivation?.hasBeenActive !== false) navigator.vibrate?.(18);
  const wifiAt = SETTINGS.wifi.eligibleAfterSeconds[game.wifi];
  if (wifiAt !== undefined && now - game.start >= wifiAt * 1000 && now + SETTINGS.wifi.durationMs < game.end) {
    showWifi(now);
  } else {
    nextCode(now);
    feedback("", "happy", now);
  }
}

function shareUrl(result) {
  const message = [
    "【出席RTA 成績通知書】",
    "",
    "出席成功：" + result.score + "回",
    "成績評価：" + result.grade,
    "称号：" + result.rank,
    "",
    "大学生なら俺の記録を超えられるよな？",
    "",
    "#出席RTA",
  ].join("\n");
  const url = new URL("https://x.com/intent/tweet");
  url.searchParams.set("text", message);
  const publicUrl = SETTINGS.publicUrl || (["http:", "https:"].includes(location.protocol) ? location.origin + location.pathname : "");
  if (publicUrl) url.searchParams.set("url", publicUrl);
  return url.href;
}

function finish() {
  if (screen !== "play") return;
  cancelAnimationFrame(frame);
  game.phase = "finished";
  showScreen("ending");
  clock.textContent = "0.0";
  round.input = "";
  renderInput();
  updateGauge(0);
  say("");
  showMonitor("closed", "受付終了", '<strong class="announcement">受付終了</strong>');
  const rating = SETTINGS.grades.find((grade) => game.score >= grade.min);
  const previousBest = readBest();
  if (previousBest !== null) best = Math.max(best ?? 0, previousBest);
  const newRecord = best === null || game.score > best;
  if (newRecord) {
    best = game.score;
    saveStorage(bestKey, best);
  }

  report = {
    ...rating,
    score: game.score,
    misses: game.misses,
    average: game.score ? (game.totalInputMs / game.score / 1000).toFixed(2) + " 秒" : "―",
    best,
  };

  const fields = {
    grade: report.grade,
    rank: report.rank,
    "result-score": report.score + " 回",
    "result-misses": report.misses + " 回",
    "result-average": report.average,
    "result-best": report.best + " 回",
    "result-comment": report.comment,
  };
  for (const [id, text] of Object.entries(fields)) byId(id).textContent = text;
  byId("record").hidden = !newRecord;
  byId("share").href = shareUrl(report);
  sceneCue(160, () => {
    playDeskImpact();
    showSubtitle(SETTINGS.speech.finish);
    speak(SETTINGS.speech.finish);
  });
  sceneCue(700, () => {
    gradeNotice.hidden = false;
    playSound("notice");
  });
  sceneCue(1550, () => {
    showScreen("result");
    byId("result-heading").focus({ preventScroll: true });
    playSound("finish");
  });
}

function saveImage() {
  const canvas = document.createElement("canvas");
  canvas.width = 900;
  canvas.height = 620;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const ink = "#25283b";
  const stamp = "#9b382e";

  function write(text, x, y, size, color = ink) {
    ctx.font = "bold " + size + "px sans-serif";
    ctx.fillStyle = color;
    ctx.fillText(text, x, y, 790);
  }

  ctx.fillStyle = "#fff2d8";
  ctx.fillRect(0, 0, 900, 620);
  ctx.strokeStyle = "#a47d52";
  ctx.lineWidth = 4;
  ctx.strokeRect(22, 22, 856, 576);
  write("出席RTA", 54, 82, 28);
  write("成績通知書", 54, 153, 59);
  ctx.fillStyle = "#a47d52";
  ctx.fillRect(54, 177, 792, 3);
  ctx.strokeStyle = stamp;
  ctx.beginPath();
  ctx.arc(113, 264, 51, 0, Math.PI * 2);
  ctx.stroke();
  write("評価", 92, 251, 21, stamp);
  write(report.grade, 95, 296, 54, stamp);
  write("称号", 192, 245, 25);
  write(report.rank, 192, 293, 38);
  write("出席成功　" + report.score + " 回", 54, 374, 32);
  write("入力ミス　" + report.misses + " 回", 460, 374, 32);
  write("平均入力時間　" + report.average, 54, 434, 30);
  write("自己ベスト　" + report.best + " 回", 460, 434, 30);
  write("教授の講評", 54, 509, 22, stamp);
  write(report.comment, 54, 550, 27);

  const link = document.createElement("a");
  link.download = "出席RTA-成績通知書.png";
  link.href = canvas.toDataURL("image/png");
  link.click();
}

byId("start").addEventListener("click", showOpening);
byId("ready").addEventListener("click", startCountdown);
byId("retry").addEventListener("click", startCountdown);
byId("home").addEventListener("click", showTitle);
byId("help-open").addEventListener("click", () => byId("help").showModal());
byId("save").addEventListener("click", saveImage);
byId("mute").addEventListener("click", () => {
  muted = !muted;
  saveStorage(muteKey, muted ? 1 : 0);
  syncSound();
  if (muted) {
    stopVoice();
    audio?.suspend().catch(() => {});
  } else {
    enableSound();
  }
});
keypad.addEventListener("click", (event) => {
  const key = event.target.closest("button");
  if (key) handleInput(key.dataset.digit ?? key.id);
});
document.addEventListener("keydown", (event) => {
  if (screen !== "play" || event.ctrlKey || event.altKey || event.metaKey || event.isComposing) return;
  const action = { Backspace: "erase", Enter: "submit" }[event.key] ?? event.key;
  if (action !== "erase" && action !== "submit" && !/^[0-9]$/.test(action)) return;
  event.preventDefault();
  if (!event.repeat || action === "erase") handleInput(action);
});

syncSound();
byId("help-time").textContent = SETTINGS.durationSeconds;
showTitle();
