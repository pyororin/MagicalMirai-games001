/* =============================================================================
 * リズムゲーム本体。楽曲は「ソングアダプタ」越しにしか触らないので、
 * 擬似曲（モック）でも TextAlive の実曲でも同じコードが動く。
 *
 * アダプタが満たす契約:
 *   start()            (任意) 再生開始。擬似曲は基準時刻をここで取る
 *   ready()            楽曲データが揃ったか
 *   time()             再生位置 [sec]
 *   atAudio(songSec)   その曲時刻に対応する AudioContext 時刻
 *   beat(k)            k 番目の拍 {t, pos, bar, dur} | null
 *   bar(i)             i 番目の小節 {i, tap, done, dur, beats} | null
 *   barIndexAt(sec)    その時刻の小節番号
 *   onBeat(beat, at)   拍ごとの伴奏（擬似曲のみ実装。実曲では何もしない）
 *   charAt(sec)        発声中の文字 | null
 *   vocalAt(sec)       ボーカル音量 0..1
 *   ended()            曲が終わったか
 *
 * タイミング（四拍子の場合。拍子はアダプタが吸収する）:
 *   2 拍目 … 髪留めをタップ（判定はここ 1 点だけ）＝ 小節の最後から 2 拍前
 *   2→4 拍目 … スライドして髪を伸ばす（お題の髪型の角度・長さに合わせる）
 *   4 拍目 … 髪が生える（離さなくても確定）＝ 小節の最後の拍
 *   1 体 = 2 小節。左右そろった 4 拍目にミク度を判定して背景へ飛ばす。
 * ========================================================================== */
import * as A from "./audio.js";
import { STAGES, stageOf } from "./stages.js";
import { drawTail, drawGhostTail, drawNegi, drawObject, drawTie, ANCHOR } from "./hair.js";
import { STYLES, CHORUS_STYLES, DIFFICULTY, gradeOf, targetAngle, targetLen as styleLen,
         mikuScore, rankOf, clamp01 } from "./score.js";

export const MAIN_SCALE = 1.75, GROUND_Y = 452;
const GRADE = { PERFECT: { s: 100, col: "#ffe66d" }, GOOD: { s: 60, col: "#7fe8e0" },
                OK: { s: 25, col: "#9fb6bd" }, MISS: { s: 0, col: "#ff7a8a" } };
const rnd01 = n => { const h = Math.sin(n * 12.9898) * 43758.5453; return h - Math.floor(h); };
/** 整数ハッシュ。Math.sin ベースの擬似乱数は近い n で似た値になり、
 *  お題や髪型が続けて同じになりやすいので、選択にはこちらを使う */
const hash = n => { let h = Math.imul(n | 0, 2654435761) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 2246822519) >>> 0; h ^= h >>> 13; return h >>> 0; };
const smooth = p => { const q = clamp01(p); return q * q * (3 - 2 * q); };

export function createGame(canvas, song, opts = {}) {
  const g = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  const onFinishSong = opts.onFinishSong || (() => {});

  let running = false, autoPlay = false, showGuide = false;
  let diff = DIFFICULTY[opts.difficulty] || DIFFICULTY.normal;
  let units = [], slide = null, shimmerGain = null, nextBeat = 0;
  let gallery = [], score = 0, combo = 0, maxCombo = 0, flash = null, effects = [];
  let results = null;
  // サビの決めポーズ: 体が完成した次の拍（小節アタマ）に 1 回だけ出る
  let kime = null, kimeHits = 0;
  const chordAt = sec => (song.chordAt ? song.chordAt(sec) : null);
  const chorusAt = sec => (song.chorusAt ? !!song.chorusAt(sec) : false);
  const tonesAt = sec => { const c = chordAt(sec); return c ? c.tones : null; };
  const grade = d => gradeOf(d, diff);
  const finished = new Set(), chain = new Map();

  const stateOf = a => chain.get(a) || "pending";
  const unitOf = c => units.find(u => u.c === c);
  const barOf = a => song.bar(a);

  /* ---- 体（お題オブジェクト）------------------------------------------ */
  function makeUnit(c) {
    const stage = stageOf(c);
    // お題は「ステージ内で連続して同じものが出ない」よう、互いに素な歩幅で巡回させる
    const n = stage.objects.length;
    const obj = stage.objects[(c * (n - 1)) % n];
    // サビはロング寄りの髪型に寄せる。同じ 2 拍でより長く伸ばすことになり、
    // 操作の構造を変えずにサビだけ手が忙しくなる
    const b0 = song.bar(c * 2);
    const inChorus = b0 ? chorusAt(b0.tap) : false;
    const pool = inChorus ? STYLES.filter(x => CHORUS_STYLES.includes(x.key)) : STYLES;
    const style = pool[hash(c * 7 + 11) % pool.length];
    const order = hash(c * 31 + 5) % 2 ? ["L", "R"] : ["R", "L"];
    return { c, stage, obj, style, order, chorus: inChorus,
             tails: { L: null, R: null }, judged: false };
  }
  const settledY = u => GROUND_Y - u.obj.h * MAIN_SCALE / 2;
  /** 体は動かない。伸ばしている最中に動くと狙った角度がずれるため、
   *  出現も退場もその場でのフェードだけにしてある（退場は背景への飛翔が担う）*/
  function unitPos(u, t) {
    const b = barOf(u.c * 2);
    const dur = b ? b.dur : 0.46;
    // 前の体は「自分の最後の拍 = この体のタップの 2 拍前」に判定されて飛び立つ。
    // それより早く現れると中央で 2 体が重なるので、出現はその直後から。
    const appear = b ? clamp01((t - (b.tap - dur * 1.8)) / (dur * 1.2)) : 0;
    const e = smooth(appear);
    return { x: W / 2, y: settledY(u), scale: MAIN_SCALE * (0.9 + 0.1 * e), alpha: e };
  }
  function anchorOf(u, side) {
    const p = unitPos(u, song.time());
    return { x: p.x + ANCHOR[side].x * u.obj.w * MAIN_SCALE,
             y: settledY(u) + ANCHOR[side].y * u.obj.h * MAIN_SCALE };
  }
  /** 触った位置を体からの相対で覚える。左右のクランプはしない
   *  ＝間違った側に付けられる（そのぶんミク度が下がる）*/
  function toLocal(u, x, y) {
    const p = unitPos(u, song.time());
    const hw = u.obj.w / 2, hh = u.obj.h / 2;
    const rx = (x - p.x) / p.scale, ry = (y - settledY(u)) / p.scale;
    return { rx: Math.max(-hw * 1.5, Math.min(hw * 1.5, rx)),
             ry: Math.max(-hh * 1.3, Math.min(hh * 0.5, ry)) };
  }
  const tailRef = a => { const u = unitOf(Math.floor(a / 2));
    return u ? { u, side: u.order[a % 2] } : null; };
  const targetLen = u => styleLen(u.style, u.obj, MAIN_SCALE);

  /* ---- 拍の予約 -------------------------------------------------------- */
  function scheduleBeats() {
    const t = song.time();
    for (;;) {
      const b = song.beat(nextBeat); if (!b || b.t > t + 0.3) break;
      const at = song.atAudio(b.t);
      if (at > A.ac.currentTime + 0.002) {
        song.onBeat(b, at);
        const r = tailRef(b.bar), pan = !r ? 0 : (r.side === "L" ? -0.8 : 0.8);
        const bar = song.bar(b.bar), ch = tonesAt(b.t);
        if (bar && b.pos === bar.beats[bar.tapIdx].pos) A.tieBeat(at, pan, ch); // 髪留め＝ここで打つ
        else if (b.last) A.hairBeat(at, pan * 0.7, ch);                         // 小節の最後＝髪が生える
        else A.click(at, b.pos === 1);
      }
      nextBeat++;
    }
  }
  /** 判定音は必ず拍アタマに置く。リズムから外れた効果音は気持ち悪いため */
  function atNextBeat() {
    const t = song.time();
    for (let k = Math.max(0, nextBeat - 4); ; k++) {
      const b = song.beat(k); if (!b) break;
      if (b.t > t + 0.02) return Math.max(A.ac.currentTime + 0.005, song.atAudio(b.t));
    }
    return A.ac.currentTime + 0.02;
  }

  /* ---- 判定 ------------------------------------------------------------ */
  const pop = (text, col, x, y) => effects.push({ text, col, x, y, t: song.time() });

  function growNegi(a) {
    const r = tailRef(a); if (!r) return;
    chain.set(a, "resolved");
    const na = r.u.negiAnchor;
    const loc = na ? toLocal(r.u, na.x, na.y)
                   : { rx: ANCHOR[r.side].x * r.u.obj.w, ry: ANCHOR[r.side].y * r.u.obj.h };
    r.u.tails[r.side] = { kind: "negi", ...loc, grade: "MISS", quality: 0 };
    r.u.negiAnchor = null;
    combo = 0; A.buzzer(atNextBeat());
    const pp = unitPos(r.u, song.time());
    pop("ネギ", "#8fd45a", pp.x + loc.rx * pp.scale, pp.y + loc.ry * pp.scale - 24);
  }

  function onDown(px, py) {
    if (!running) return;
    const t = song.time();
    const near = song.barIndexAt(t);
    let best = null;
    for (const a of [near - 1, near, near + 1]) {
      const b = barOf(a); if (a < 0 || !b || stateOf(a) !== "pending" || !tailRef(a)) continue;
      const d = (t - b.tap) / b.dur;
      if (Math.abs(d) < 0.85 && (!best || Math.abs(d) < Math.abs(best.d))) best = { a, d };
    }
    // サビの決めポーズ。房のタップより近ければそちらを取る（拍が 1 つ離れているので競合しない）
    if (kime && !kime.hit) {
      const dk = Math.abs((t - kime.t) / kime.dur);
      if (dk <= diff.window && (!best || dk < Math.abs(best.d))) {
        kime.hit = true; kimeHits++;
        A.kime(Math.max(A.ac.currentTime + 0.005, song.atAudio(kime.t)), tonesAt(kime.t));
        combo++; maxCombo = Math.max(maxCombo, combo);
        score += 300;
        pop("キメ！", "#ffe66d", W / 2, 210);
        return;
      }
    }
    if (!best) { A.flop(A.ac.currentTime); combo = 0; pop("そこじゃない", "#ff7a8a", px, py); return; }
    const gr = grade(best.d);
    const r = tailRef(best.a);
    if (gr === "MISS") { pop(best.d < 0 ? "早い" : "遅い", "#ff7a8a", px, py);
                         r.u.negiAnchor = { x: px, y: py }; growNegi(best.a); return; }
    const pan = r.side === "L" ? -0.7 : 0.7;
    chain.set(best.a, "held");
    A.osc(A.ac.currentTime, 520, "sine", 0.13, 0.1, A.sfxGain, pan);
    shimmerGain = A.shimmer(A.ac.currentTime, barOf(best.a).dur * 2, pan, tonesAt(t));
    const loc = toLocal(r.u, px, py);
    const wrong = (r.side === "L" ? loc.rx > 0 : loc.rx < 0);
    slide = { a: best.a, u: r.u, side: r.side, tapGrade: gr, ...loc,
              x0: px, y0: py, x: px, y: py, chars: [], wrong };
    if (wrong) pop("左右が逆！", "#ff7a8a", px, py - 46);
    pop(gr, GRADE[gr].col, px, py - 26);
  }
  const onMove = (px, py) => { if (slide) { slide.x = px; slide.y = py; } };

  /** 房を確定する。離しても、離さずに小節の最後を迎えても同じ結果になる */
  function finalize(s) {
    if (shimmerGain) { shimmerGain.gain.setTargetAtTime(0.0001, A.ac.currentTime, 0.02); shimmerGain = null; }
    const dx = s.x - s.x0, dy = s.y - s.y0, dist = Math.hypot(dx, dy);
    if (dist < 14) {                       // 掴んだが伸ばしていない
      pop("伸びてない", "#ff7a8a", s.x, s.y);
      s.u.negiAnchor = { x: s.x0, y: s.y0 }; growNegi(s.a); return;
    }
    chain.set(s.a, "resolved");
    const b = barOf(s.a);
    A.shakin(Math.max(A.ac.currentTime + 0.005, song.atAudio(b.done)),
             s.side === "L" ? -0.6 : 0.6, tonesAt(b.done));
    combo++; maxCombo = Math.max(maxCombo, combo);
    score += Math.round(GRADE[s.tapGrade].s * 2 * (1 + Math.min(combo, 20) / 20));
    // 房の長さは「お題ローカル座標」で持つ（rx/ry と同じ土俵）。
    // 画面へ描くときも背景へ縮小するときも drawTail 側で倍率を掛けるので、
    // ここで画面ピクセルのまま持つと本体サイズのぶん二重に拡大されてしまう。
    s.u.tails[s.side] = { kind: "hair", rx: s.rx, ry: s.ry, grade: s.tapGrade,
                          angle: Math.atan2(dy, dx), len: Math.min(dist, 380) / MAIN_SCALE,
                          quality: GRADE[s.tapGrade].s / 100, chars: s.chars.slice(0, 7) };
  }
  const onUp = () => { if (slide) { const s = slide; slide = null; finalize(s); } };

  /* ---- 体の完成 -------------------------------------------------------- */
  function finish(u) {
    u.judged = true; finished.add(u.c);
    const m = mikuScore(u, 1), r = rankOf(m.total, u.obj.name);   // 房長はローカル座標
    A.say(r.text);
    score += m.total * 5;
    flash = { text: r.text, label: r.label, miku: m.total, t: song.time() };
    // サビの決めポーズ: 完成の次の拍（＝次の小節のアタマ）。
    // そこは房のタップの 1 拍前で必ず空いているので、指が競合しない
    if (u.chorus && diff.kime) {
      const nb = barOf(u.c * 2 + 2);
      if (nb) kime = { t: nb.beats[0].t, dur: nb.dur, hit: false };
    }
    const p = unitPos(u, song.time());
    gallery.push({ obj: u.obj, tails: u.tails, style: u.style, stage: u.stage, chorus: u.chorus,
                   miku: m.total, rank: r, detail: m, seed: gallery.length,
                   x: 62 + rnd01(u.c * 5.1 + 0.3) * (W - 124),
                   y: 74 + rnd01(u.c * 9.3 + 0.7) * 330,
                   s: 0.30 + rnd01(u.c * 2.4) * 0.13,
                   fromX: p.x, fromY: p.y, fromS: p.scale, flyT: song.time() });
  }

  function endSong() {
    running = false;
    const n = gallery.length || 1;
    results = { total: score, mikus: gallery.length, maxCombo, kime: kimeHits, difficulty: diff.name,
                avg: Math.round(gallery.reduce((a, b) => a + b.miku, 0) / n),
                best: gallery.slice().sort((a, b) => b.miku - a.miku).slice(0, 5) };
    A.fanfare(A.ac.currentTime + 0.05);
    A.say("ミクだらけ！");
    onFinishSong(results);
  }

  function tick() {
    if (!running || !song.ready()) return;
    const t = song.time();
    scheduleBeats();
    const cur = Math.max(0, Math.floor(song.barIndexAt(t) / 2));
    for (const c of [cur, cur + 1])
      if (!unitOf(c) && !finished.has(c) && barOf(c * 2 + 1)) units.push(makeUnit(c));
    // 置き損ね → ネギ
    const nb = song.barIndexAt(t);
    for (let a = Math.max(0, nb - 1); a <= nb; a++) {
      const b = barOf(a);
      if (b && stateOf(a) === "pending" && tailRef(a) && t > b.tap + b.dur * diff.window + 0.02) growNegi(a);
    }
    if (kime && t > kime.t + kime.dur * diff.window) kime = null;   // 逃しても罰はない
    if (slide) { const b = barOf(slide.a);
      const ch = song.charAt(t);
      if (ch && slide.chars[slide.chars.length - 1] !== ch) slide.chars.push(ch);
      if (b && t >= b.done) { const s2 = slide; slide = null; finalize(s2); } }
    for (const u of units) { const b = barOf(u.c * 2 + 1);
      if (!u.judged && b && t >= b.done + b.dur * 0.25) finish(u); }
    units = units.filter(u => !u.judged);
    if (autoPlay) autoTick(t);
    if (song.ended()) endSong();
  }

  /* ---- 観賞モード（お題どおりに伸ばす）--------------------------------- */
  function autoTick(t) {
    if (kime && !kime.hit && t >= kime.t && t < kime.t + kime.dur * 0.25) { onDown(W / 2, 210); return; }
    if (!slide) {
      const nb = song.barIndexAt(t);
      for (const a of [nb - 1, nb, nb + 1]) {
        const b = barOf(a); if (a < 0 || !b || stateOf(a) !== "pending") continue;
        const r = tailRef(a); if (!r) continue;
        if (t >= b.tap && t < b.tap + b.dur * 0.35) {
          const anc = anchorOf(r.u, r.side); onDown(anc.x, anc.y); break;
        }
      }
    }
    if (slide) {
      const b = barOf(slide.a), u = slide.u;
      const p = clamp01((t - b.tap) / (b.done - b.tap));
      const ang = targetAngle(slide.side, u.style), len = targetLen(u) * p;
      onMove(slide.x0 + Math.cos(ang) * len, slide.y0 + Math.sin(ang) * len);
    }
  }

  /* ---- 描画 ------------------------------------------------------------ */
  function drawApproach(a, t) {
    if (stateOf(a) !== "pending") return;
    const r = tailRef(a), b = barOf(a); if (!r || !b) return;
    const left = (b.tap - t) / b.dur;
    if (left > 3.1 || left < -0.6) return;
    const e = smooth(1 - left / 3);
    const anc = anchorOf(r.u, r.side), out = r.side === "L" ? -1 : 1;
    const d = (1 - e) * 330, x = anc.x + out * d, y = anc.y - d * 0.42;
    g.save(); g.globalAlpha = 0.3 + 0.7 * e;
    drawTail(g, x, y, { angle: Math.atan2(1, out * 0.55), len: 30 + 34 * e, quality: 0 },
             t, 0.2 + 0.22 * e);
    drawTie(g, x, y, -Math.PI / 2 + out * 0.42, 0.82 + 0.3 * e);
    if (left < 0.6) {
      g.globalAlpha = 1; g.strokeStyle = "#ffe66d"; g.lineWidth = 3;
      g.beginPath(); g.arc(x, y, 20 + Math.abs(left) * 22, 0, 7); g.stroke();
    }
    if (showGuide) {
      g.globalAlpha = 1; g.fillStyle = "#ffe66d"; g.font = "bold 13px sans-serif"; g.textAlign = "center";
      g.fillText(r.side === "L" ? "◀ 左" : "右 ▶", x, y - 26);
    }
    g.restore();
  }
  /** お題の髪型を下書きで示す。ここに沿って伸ばすほど角度点が高い。
   *  いつ出すかは難易度で変わる（やさしい=常時 / ふつう=近づく間 / むずかしい=伸ばす間だけ）*/
  function drawStyleGhost(u, t) {
    for (const side of ["L", "R"]) {
      if (u.tails[side]) continue;
      const a = u.c * 2 + u.order.indexOf(side);
      const b = barOf(a); if (!b || t > b.done + b.dur * 0.2) continue;
      const holding = !!(slide && slide.a === a);
      if (diff.guide === "slide" && !holding) continue;
      if (diff.guide === "approach" && !holding && t < b.tap - b.dur * 2.2) continue;
      let ax, ay;
      if (slide && slide.a === a) { ax = slide.x0; ay = slide.y0; }
      else { const anc = anchorOf(u, side); ax = anc.x; ay = anc.y; }
      const alpha = slide && slide.a === a ? 0.85 : 0.4;
      drawGhostTail(g, ax, ay, targetAngle(side, u.style), targetLen(u), t, alpha);
    }
  }

  function render() {
    const t = song.time();
    const stage = (units[0] && units[0].stage) || STAGES[0];
    stage.draw(g, W, H, t);

    if (!running && !results) {
      g.fillStyle = "#7fe8e0"; g.font = "bold 20px sans-serif"; g.textAlign = "center";
      g.fillText(song.ready() ? "▶ スタート を押す" : "楽曲を読み込み中……", W / 2, H / 2 - 10);
      g.fillStyle = "#cfe6ea"; g.font = "13px sans-serif";
      g.fillText("2拍目で髪留めをタップ → お題の髪型どおりに伸ばす → 4拍目で髪が生える", W / 2, H / 2 + 20);
      requestAnimationFrame(render); return;
    }

    // 背景: これまでのミクたち（完成した位置から飛んでいく）
    // 課題曲 1 曲で 50〜80 体たまるので、増えるほど全体を縮めて画面に収める
    const shrink = Math.min(1, Math.sqrt(26 / (gallery.length + 14)));
    // 称号は「今の最高記録の 1 体」にだけ出す（全部に出すと文字だらけになる）
    let bestIdx = -1, bestMiku = -1;
    gallery.forEach((it, i) => { if (it.miku >= bestMiku) { bestMiku = it.miku; bestIdx = i; } });
    g.save(); g.globalAlpha = .85;
    gallery.forEach((it, gi) => {
      const fly = smooth((t - it.flyT) / 0.55);
      const bob = Math.sin(t * 1.9 + it.seed) * 2.6;
      const x = it.fromX + (it.x - it.fromX) * fly;
      const y = it.fromY + (it.y + bob - it.fromY) * fly;
      const s = it.fromS + (it.s * shrink - it.fromS) * fly;
      if (it.rank.glow > 0) {                 // 良い記録はあとからも分かるよう淡く光る
        const k = it.rank.glow;
        const pulse = 0.72 + 0.28 * Math.sin(t * 2.4 + it.seed * 1.7);
        const rad = (110 + 60 * k) * s + 40;
        const grd = g.createRadialGradient(x, y, 0, x, y, rad);
        grd.addColorStop(0, `rgba(168,255,246,${(0.10 + 0.18 * k) * pulse})`);
        grd.addColorStop(0.55, `rgba(120,235,226,${(0.05 + 0.10 * k) * pulse})`);
        grd.addColorStop(1, "rgba(120,235,226,0)");
        g.fillStyle = grd; g.beginPath(); g.arc(x, y, rad, 0, 7); g.fill();
      }
      drawObject(g, it.obj, x, y, s, it.tails, t);
      if (gi === bestIdx && it.rank.glow > 0 && s > 0.16) {
        g.fillStyle = "rgba(255,230,109,.9)";
        g.font = "bold 11px sans-serif"; g.textAlign = "center";
        g.fillText(`★ ${it.rank.label}・ミク度${it.miku}`, x, y + it.obj.h * s / 2 + 15);
      }
    });
    g.restore();

    if (results) { drawResults(t); requestAnimationFrame(render); return; }

    // 進行中の体（動かない）
    for (const u of units) {
      if (u.judged) continue;
      const pp = unitPos(u, t);
      if (pp.alpha <= 0.01) continue;
      g.save(); g.globalAlpha = pp.alpha;
      drawStyleGhost(u, t);
      drawObject(g, u.obj, pp.x, pp.y, pp.scale, u.tails, t);
      g.restore();
    }
    const cu = units.find(u => !u.judged && unitPos(u, t).alpha > 0.5);
    // 拍インジケータと情報
    const bi = song.barIndexAt(t), bar = barOf(bi);
    if (bar) {
      const pos = bar.beats.findIndex((b, i) => t < (bar.beats[i + 1] ? bar.beats[i + 1].t : bar.done + bar.dur));
      const ph = bar.dur ? ((t - bar.tap) / bar.dur % 1 + 1) % 1 : 0;
      bar.beats.forEach((b, i) => {
        const on = i === pos;
        const col = i === bar.tapIdx ? "#ffe66d" : i === bar.beats.length - 1 ? "#ff8fc0" : "#39c5bb";
        const dim = i === bar.tapIdx ? "#4a4326" : i === bar.beats.length - 1 ? "#4a2a3a" : "#243039";
        g.fillStyle = on ? col : dim;
        g.beginPath(); g.arc(36 + i * 26, 30, on ? 10 - ph * 2 : 6, 0, 7); g.fill();
      });
    }
    g.fillStyle = "#9fb6bd"; g.font = "11px sans-serif"; g.textAlign = "left";
    g.fillText("黄=髪留めをタップ → 桃=髪が生える（小節の最後の拍）", 200, 34);
    if (chorusAt(t)) {                       // サビ: 光って、髪型がロング寄りになる
      const pulse = 0.55 + 0.45 * Math.sin(t * 4.2);
      g.fillStyle = `rgba(255,143,192,${0.45 + 0.55 * pulse})`;
      g.font = "bold 13px sans-serif"; g.textAlign = "left";
      g.fillText("♪ サビ", 200, 52);
      const grd = g.createLinearGradient(0, 0, 0, H);
      grd.addColorStop(0, `rgba(255,143,192,${0.05 + 0.05 * pulse})`);
      grd.addColorStop(1, "rgba(255,143,192,0)");
      g.fillStyle = grd; g.fillRect(0, 0, W, H);
    }
    g.textAlign = "right"; g.fillStyle = "#cfe6ea"; g.font = "12px sans-serif";
    g.fillText(`SCORE ${score}`, W - 20, 26);
    g.fillText(`COMBO ${combo}${maxCombo ? "  (MAX " + maxCombo + ")" : ""}`, W - 20, 44);
    if (cu) {
      g.textAlign = "center"; g.font = "bold 13px sans-serif"; g.fillStyle = "#e6f7f5";
      g.fillText(`${cu.stage.name}／お題: ${cu.obj.name}　髪型: ${cu.style.name}`, W / 2, 26);
    }

    for (const u of units) if (!u.judged)
      for (const k of [0, 1]) drawApproach(u.c * 2 + k, t);

    // サビの決めポーズ。到達する拍で輪が閉じる
    if (kime) {
      const left = (kime.t - t) / kime.dur;
      if (left < 1.6 && left > -diff.window) {
        const e = clamp01(1 - Math.abs(left) / 1.6);
        g.save();
        g.globalAlpha = kime.hit ? 0 : 0.35 + 0.65 * e;
        g.strokeStyle = "#ffe66d"; g.lineWidth = 4 + 3 * e;
        g.beginPath(); g.arc(W / 2, 210, 26 + Math.abs(left) * 90, 0, 7); g.stroke();
        g.fillStyle = "#ffe66d"; g.font = "bold 20px sans-serif"; g.textAlign = "center";
        g.fillText("キメ！", W / 2, 217);
        g.restore();
      }
    }
    // スライド中の星（歌詞の文字が流れ込む）
    if (slide) {
      const sp = unitPos(slide.u, t);
      const sx = sp.x + slide.rx * sp.scale, sy = sp.y + slide.ry * sp.scale;
      g.strokeStyle = "rgba(127,232,224,.5)"; g.lineWidth = 3;
      g.beginPath(); g.moveTo(sx, sy); g.lineTo(slide.x, slide.y); g.stroke();
      const src = slide.chars.length ? slide.chars : ["ミ", "ク"];
      for (let i = 0; i < 9; i++) {
        const u = (i + (t * 2.4 % 1)) / 9;
        g.fillStyle = `rgba(255,246,190,${1 - u})`; g.font = `${14 - u * 4}px sans-serif`;
        g.textAlign = "center";
        g.fillText(src[(i + Math.floor(t * 6)) % src.length],
                   sx + (slide.x - sx) * u, sy + (slide.y - sy) * u);
      }
    }
    effects = effects.filter(e => t - e.t < .7);
    g.textAlign = "center";
    for (const e of effects) {
      const u = (t - e.t) / .7;
      g.globalAlpha = 1 - u; g.fillStyle = e.col; g.font = "bold 17px sans-serif";
      g.fillText(e.text, e.x, e.y - u * 26); g.globalAlpha = 1;
    }
    if (flash && t - flash.t < 1.2) {
      const u = (t - flash.t) / 1.2, s = 1 + (1 - Math.min(1, u * 5)) * .5;
      g.save(); g.translate(W / 2, 150); g.scale(s, s); g.globalAlpha = Math.min(1, (1 - u) * 3);
      g.fillStyle = "#ffe66d"; g.font = "bold 48px sans-serif"; g.fillText(flash.text, 0, 0);
      g.fillStyle = "#7fe8e0"; g.font = "bold 15px sans-serif";
      g.fillText(flash.label + "　ミク度 " + flash.miku, 0, 28);
      g.restore();
    }
    requestAnimationFrame(render);
  }

  function drawResults(t) {
    g.fillStyle = "rgba(8,14,18,.72)"; g.fillRect(0, 0, W, H);
    g.textAlign = "center";
    g.fillStyle = "#ffe66d"; g.font = "bold 34px sans-serif";
    g.fillText("ミクだらけになりました", W / 2, 92);
    g.fillStyle = "#7fe8e0"; g.font = "bold 19px sans-serif";
    g.fillText(`SCORE ${results.total}　／　ミク ${results.mikus} 体　／　平均ミク度 ${results.avg}　／　MAX COMBO ${results.maxCombo}`,
               W / 2, 128);
    g.font = "12px sans-serif"; g.fillStyle = "#9fb6bd";
    g.fillText(`難易度 ${results.difficulty}` + (results.kime ? `　／　キメ ${results.kime} 回` : ""), W / 2, 150);
    g.font = "13px sans-serif"; g.fillStyle = "#cfe6ea";
    g.fillText("― ベスト記録 ―", W / 2, 176);
    results.best.forEach((it, i) => {
      const y = 204 + i * 30;
      g.textAlign = "left"; g.fillStyle = it.rank.glow ? "#ffe66d" : "#9fb6bd";
      g.font = "13px sans-serif";
      g.fillText(`${i + 1}. ${it.stage.name} / ${it.obj.name}（${it.style.name}）`, W / 2 - 300, y);
      g.textAlign = "right"; g.fillStyle = "#e6f7f5";
      g.fillText(`ミク度 ${it.miku}  ${it.rank.label}`, W / 2 + 130, y);
      g.textAlign = "left"; g.fillStyle = "#6d848d"; g.font = "11px sans-serif";
      g.fillText(`拍${it.detail.rhythm} 角${it.detail.ang} 位${it.detail.place} 対${it.detail.sym} 長${it.detail.len}`
                 + (it.detail.penalty ? ` −${it.detail.penalty}` : ""), W / 2 + 150, y);
    });
    g.textAlign = "center"; g.fillStyle = "#8fa6ae"; g.font = "12px sans-serif";
    g.fillText("もう一度あそぶには ▶ スタート", W / 2, H - 40);
  }

  /* ---- 入力 ------------------------------------------------------------ */
  const pt = e => { const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height }; };
  canvas.addEventListener("pointerdown", e => {
    if (!running) return; e.preventDefault(); autoPlay = false;
    canvas.setPointerCapture(e.pointerId); const p = pt(e); onDown(p.x, p.y);
  });
  canvas.addEventListener("pointermove", e => { if (slide) { const p = pt(e); onMove(p.x, p.y); } });
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);

  let timer = null;
  const api = {
    start() {
      A.unlockAudio();
      running = true; results = null; units = []; gallery = []; slide = null;
      score = 0; combo = 0; maxCombo = 0; flash = null; effects = [];
      nextBeat = 0; kime = null; kimeHits = 0; finished.clear(); chain.clear();
      if (song.start) song.start();
      clearInterval(timer); timer = setInterval(tick, 16);
    },
    stop() { running = false; clearInterval(timer); timer = null; },
    /** 曲が差し替わったら、曲に紐づく状態を全部捨てる */
    reset() { api.stop(); units = []; gallery = []; slide = null; results = null;
              nextBeat = 0; kime = null; kimeHits = 0;
              finished.clear(); chain.clear(); score = 0; combo = 0; },
    setDifficulty(k) { if (DIFFICULTY[k]) diff = DIFFICULTY[k]; return diff.name; },
    difficulty: () => diff,
    toggleAuto() { if (!running) api.start(); autoPlay = !autoPlay; return autoPlay; },
    setGuide(v) { showGuide = !!v; },
    isRunning: () => running,
    debug: () => ({ score, combo, maxCombo, mikus: gallery.length, running, autoPlay,
      difficulty: diff.key, chorus: chorusAt(song.time()), kimeHits,
      chord: (chordAt(song.time()) || {}).name || null,
      t: song.time(),
      units: units.map(u => ({ c: u.c, stage: u.stage.name, obj: u.obj.name, style: u.style.name,
        order: u.order.join(""), w: u.obj.w, h: u.obj.h, cx: W / 2, cy: settledY(u),
        ang: { L: targetAngle("L", u.style), R: targetAngle("R", u.style) }, len: targetLen(u),
        bars: [song.bar(u.c * 2), song.bar(u.c * 2 + 1)],
        tails: ["L", "R"].map(k => u.tails[k] ? u.tails[k].kind[0] : "-").join("") })) }),
    galleryDump: () => gallery.map(x => ({ stage: x.stage.name, obj: x.obj.name, style: x.style.name,
      chorus: !!x.chorus, miku: x.miku, label: x.rank.label, detail: x.detail })),
    results: () => results,
  };
  render();
  return api;
}
