/* =============================================================================
 * ステージとお題オブジェクト
 *   ステージ = 背景 + そのステージにちなんだお題オブジェクト群。
 *   オブジェクトは原点中心・幅 w / 高さ h のボックスに収まるよう描く。
 * ========================================================================== */

const rr = (g, x, y, w, h, r) => { g.beginPath(); g.roundRect(x, y, w, h, r); g.fill(); };

/* ---- 台所 ------------------------------------------------------------- */
const KITCHEN = [
  { name: "ネギ", w: 54, h: 150, draw(g) {
      g.fillStyle = "#eef6e2"; rr(g, -20, 10, 40, 66, 8);
      g.fillStyle = "#6fbf4a"; rr(g, -17, -76, 12, 92, 6); rr(g, -3, -84, 12, 100, 6); rr(g, 11, -70, 11, 86, 6);
      g.fillStyle = "#d9e7c4"; rr(g, -20, 6, 40, 8, 4); } },
  { name: "炊飯器", w: 118, h: 104, draw(g) {
      g.fillStyle = "#eceff1"; rr(g, -59, -52, 118, 104, 20);
      g.fillStyle = "#c3ccd2"; rr(g, -59, -52, 118, 30, 15);
      g.fillStyle = "#39c5bb"; g.beginPath(); g.arc(0, 12, 9, 0, 7); g.fill();
      g.fillStyle = "#98a4ab"; rr(g, -16, -60, 32, 10, 5); } },
  { name: "マグカップ", w: 96, h: 100, draw(g) {
      g.strokeStyle = "#b8895a"; g.lineWidth = 12;
      g.beginPath(); g.arc(52, 4, 26, -1.2, 1.2); g.stroke();
      g.fillStyle = "#d9a06b"; rr(g, -44, -50, 88, 100, 12);
      g.fillStyle = "#6b4423"; g.beginPath(); g.ellipse(0, -46, 39, 8, 0, 0, 7); g.fill(); } },
  { name: "しょうゆさし", w: 66, h: 108, draw(g) {
      g.fillStyle = "#e8433a"; g.beginPath(); g.moveTo(-30, 54); g.lineTo(-16, -22); g.lineTo(16, -22); g.lineTo(30, 54); g.closePath(); g.fill();
      g.fillStyle = "#f2f4f5"; rr(g, -17, -34, 34, 14, 5);
      g.fillStyle = "#e8433a"; rr(g, -11, -54, 22, 22, 6);
      g.fillStyle = "#3a2a24"; g.beginPath(); g.ellipse(0, 30, 22, 16, 0, 0, 7); g.fill(); } },
  { name: "フライパン", w: 150, h: 66, draw(g) {
      g.fillStyle = "#3b3f45"; rr(g, 18, -8, 62, 14, 7);
      g.fillStyle = "#4c5259"; g.beginPath(); g.ellipse(-26, 0, 52, 30, 0, 0, 7); g.fill();
      g.fillStyle = "#2a2e33"; g.beginPath(); g.ellipse(-26, 0, 42, 22, 0, 0, 7); g.fill();
      g.fillStyle = "#f3d98a"; g.beginPath(); g.ellipse(-30, 2, 20, 11, 0, 0, 7); g.fill();
      g.fillStyle = "#f0a63a"; g.beginPath(); g.arc(-30, 2, 7, 0, 7); g.fill(); } },
  { name: "電気ケトル", w: 108, h: 116, draw(g) {
      g.fillStyle = "#dfe4e8"; g.beginPath(); g.moveTo(-38, -34); g.lineTo(38, -34); g.lineTo(30, 46); g.lineTo(-30, 46); g.closePath(); g.fill();
      g.fillStyle = "#aeb7bd"; rr(g, -42, -46, 84, 14, 6);
      g.strokeStyle = "#8f979d"; g.lineWidth = 9; g.lineCap = "round";
      g.beginPath(); g.moveTo(36, -28); g.quadraticCurveTo(56, 0, 32, 26); g.stroke();
      g.fillStyle = "#39c5bb"; rr(g, -12, 6, 24, 8, 4);
      g.fillStyle = "#c9d0d5"; rr(g, -44, 46, 88, 12, 5); } },
];

/* ---- 通学路 ----------------------------------------------------------- */
const STREET = [
  { name: "郵便ポスト", w: 76, h: 150, draw(g) {
      g.fillStyle = "#d6423e"; rr(g, -38, -60, 76, 136, 10);
      g.beginPath(); g.arc(0, -60, 38, Math.PI, 0); g.fill();
      g.fillStyle = "#2b1210"; rr(g, -24, -46, 48, 11, 3);
      g.fillStyle = "#a8302d"; rr(g, -30, 26, 60, 26, 4); } },
  { name: "信号機", w: 132, h: 62, draw(g) {
      g.fillStyle = "#4a5259"; rr(g, -66, -31, 132, 62, 12);
      const cols = ["#3ad06a", "#f2c519", "#e8433a"];
      cols.forEach((c, i) => { g.fillStyle = c; g.beginPath(); g.arc(-40 + i * 40, 0, 19, 0, 7); g.fill(); });
      g.fillStyle = "#5c656d"; rr(g, -66, -37, 132, 10, 5); } },
  { name: "カラーコーン", w: 84, h: 116, draw(g) {
      g.fillStyle = "#f36a1f"; g.beginPath(); g.moveTo(-20, -58); g.lineTo(20, -58); g.lineTo(34, 40); g.lineTo(-34, 40); g.closePath(); g.fill();
      g.fillStyle = "#f4f6f7"; g.beginPath(); g.moveTo(-25, -22); g.lineTo(25, -22); g.lineTo(28, -2); g.lineTo(-28, -2); g.closePath(); g.fill();
      g.fillStyle = "#e05a12"; rr(g, -42, 40, 84, 18, 5); } },
  { name: "自動販売機", w: 132, h: 168, draw(g) {
      g.fillStyle = "#d6423e"; rr(g, -66, -84, 132, 168, 8);
      g.fillStyle = "#f4f6f7"; rr(g, -58, -76, 74, 96, 5);
      g.fillStyle = "#2b3238"; rr(g, 22, -76, 36, 96, 5);
      for (let r = 0; r < 2; r++) for (let i = 0; i < 4; i++) {
        g.fillStyle = ["#39c5bb", "#f2c519", "#7fc4f0", "#f08fb4"][i];
        rr(g, -54 + i * 17, -70 + r * 46, 12, 30, 4); }
      g.fillStyle = "#31383e"; rr(g, -58, 30, 116, 34, 5);
      g.fillStyle = "#f2c519"; rr(g, -52, 40, 40, 14, 4); } },
  { name: "消火栓", w: 84, h: 128, draw(g) {
      g.fillStyle = "#e8433a"; rr(g, -22, -40, 44, 92, 10);
      g.beginPath(); g.arc(0, -40, 22, Math.PI, 0); g.fill();
      g.fillStyle = "#c2352f"; rr(g, -42, -22, 84, 18, 8);
      g.fillStyle = "#f4f6f7"; g.beginPath(); g.arc(-33, -13, 7, 0, 7); g.arc(33, -13, 7, 0, 7); g.fill();
      g.fillStyle = "#c2352f"; rr(g, -30, 46, 60, 18, 5); } },
  { name: "ポリバケツ", w: 104, h: 116, draw(g) {
      g.fillStyle = "#3f8ecc"; g.beginPath(); g.moveTo(-42, -40); g.lineTo(42, -40); g.lineTo(33, 52); g.lineTo(-33, 52); g.closePath(); g.fill();
      g.fillStyle = "#2f76ad"; rr(g, -50, -54, 100, 18, 8);
      g.fillStyle = "#6cb0e0"; rr(g, -30, -26, 12, 62, 5); rr(g, -6, -26, 12, 62, 5); rr(g, 18, -26, 12, 62, 5); } },
];

/* ---- 机の上 ----------------------------------------------------------- */
const DESK = [
  { name: "ペットボトル", w: 62, h: 150, draw(g) {
      g.fillStyle = "#c7e7f5"; rr(g, -31, -30, 62, 106, 14);
      g.beginPath(); g.moveTo(-31, -26); g.lineTo(-13, -58); g.lineTo(13, -58); g.lineTo(31, -26); g.fill();
      g.fillStyle = "#fff"; rr(g, -26, 4, 52, 34, 4);
      g.fillStyle = "#2f89a8"; rr(g, -12, -76, 24, 20, 4); } },
  { name: "目覚まし時計", w: 104, h: 104, draw(g) {
      g.fillStyle = "#f2c519"; g.beginPath(); g.arc(-32, -42, 15, 0, 7); g.arc(32, -42, 15, 0, 7); g.fill();
      g.fillStyle = "#e9b400"; g.beginPath(); g.arc(0, 0, 52, 0, 7); g.fill();
      g.fillStyle = "#fffdf2"; g.beginPath(); g.arc(0, 0, 41, 0, 7); g.fill();
      g.strokeStyle = "#31261a"; g.lineWidth = 4; g.lineCap = "round";
      g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -26); g.moveTo(0, 0); g.lineTo(19, 9); g.stroke(); } },
  { name: "スティックのり", w: 50, h: 132, draw(g) {
      g.fillStyle = "#6b4ba8"; rr(g, -25, -20, 50, 86, 8);
      g.fillStyle = "#f4f6f7"; rr(g, -25, 6, 50, 26, 4);
      g.fillStyle = "#8a68c8"; rr(g, -22, -66, 44, 48, 7);
      g.fillStyle = "#5b3f92"; rr(g, -22, -70, 44, 8, 4); } },
  { name: "ホチキス", w: 138, h: 56, draw(g) {
      g.fillStyle = "#39c5bb"; rr(g, -69, -28, 138, 26, 10);
      g.fillStyle = "#2b9a92"; rr(g, -69, -4, 138, 20, 8);
      g.fillStyle = "#1f7a74"; rr(g, -62, 12, 124, 12, 5);
      g.fillStyle = "#e6f7f5"; rr(g, 30, -24, 30, 8, 4); } },
  { name: "えんぴつ立て", w: 88, h: 138, draw(g) {
      g.fillStyle = "#f2c519"; rr(g, -18, -66, 11, 60, 4);
      g.fillStyle = "#e8433a"; rr(g, -2, -74, 11, 68, 4);
      g.fillStyle = "#3f8ecc"; rr(g, 14, -58, 11, 52, 4);
      g.fillStyle = "#7a838a"; rr(g, -34, -12, 68, 72, 8);
      g.fillStyle = "#98a4ab"; rr(g, -34, -12, 68, 12, 6);
      g.fillStyle = "#616a70"; for (let i = 0; i < 5; i++) rr(g, -28 + i * 13, 2, 6, 52, 3); } },
  { name: "電卓", w: 104, h: 140, draw(g) {
      g.fillStyle = "#2b3238"; rr(g, -52, -70, 104, 140, 10);
      g.fillStyle = "#9fd8a0"; rr(g, -42, -60, 84, 30, 5);
      g.fillStyle = "#1c2226"; g.font = "bold 18px monospace"; g.textAlign = "right"; g.fillText("39", 36, -38);
      for (let r = 0; r < 4; r++) for (let i = 0; i < 4; i++) {
        g.fillStyle = i === 3 ? "#f2a03a" : "#5a646b"; rr(g, -42 + i * 22, -20 + r * 22, 17, 17, 4); } } },
];

/* ---- ライブハウス ------------------------------------------------------ */
const LIVE = [
  { name: "ギターアンプ", w: 150, h: 122, draw(g) {
      g.fillStyle = "#2b2420"; rr(g, -75, -61, 150, 122, 8);
      g.fillStyle = "#4b423a"; rr(g, -66, -30, 132, 84, 5);
      g.fillStyle = "#1d1815"; for (let y = -28; y < 52; y += 7) rr(g, -64, y, 128, 3, 1);
      g.fillStyle = "#d8cdb8"; rr(g, -66, -54, 132, 20, 4);
      g.fillStyle = "#31261a"; for (let i = 0; i < 5; i++) { g.beginPath(); g.arc(-46 + i * 23, -44, 5, 0, 7); g.fill(); } } },
  { name: "スピーカー", w: 108, h: 168, draw(g) {
      g.fillStyle = "#23282d"; rr(g, -54, -84, 108, 168, 8);
      g.fillStyle = "#3a4148"; g.beginPath(); g.arc(0, 24, 36, 0, 7); g.fill();
      g.fillStyle = "#171b1f"; g.beginPath(); g.arc(0, 24, 26, 0, 7); g.fill();
      g.fillStyle = "#3a4148"; g.beginPath(); g.arc(0, -42, 19, 0, 7); g.fill();
      g.fillStyle = "#171b1f"; g.beginPath(); g.arc(0, -42, 12, 0, 7); g.fill(); } },
  { name: "マイクスタンド", w: 60, h: 172, draw(g) {
      g.fillStyle = "#8f979d"; rr(g, -4, -58, 8, 132, 4);
      g.fillStyle = "#5c656d"; rr(g, -28, 70, 56, 12, 6);
      g.fillStyle = "#2b3238"; rr(g, -13, -86, 26, 34, 12);
      g.fillStyle = "#6d757b"; g.beginPath(); g.arc(0, -84, 12, Math.PI, 0); g.fill();
      g.fillStyle = "#39c5bb"; rr(g, -5, -54, 10, 8, 3); } },
  { name: "ミラーボール", w: 116, h: 130, draw(g) {
      g.fillStyle = "#8f979d"; rr(g, -3, -65, 6, 22, 3);
      g.fillStyle = "#b8c6cd"; g.beginPath(); g.arc(0, 12, 52, 0, 7); g.fill();
      for (let r = -4; r <= 4; r++) for (let c = -4; c <= 4; c++) {
        const x = c * 12, y = 12 + r * 12; if (Math.hypot(x, y - 12) > 48) continue;
        g.fillStyle = (r + c) % 2 ? "#e7f2f6" : "#93a4ad"; rr(g, x - 5, y - 5, 10, 10, 2); } } },
  { name: "ペンライト", w: 46, h: 158, draw(g) {
      g.fillStyle = "#2b3238"; rr(g, -14, 4, 28, 75, 8);
      g.fillStyle = "#39c5bb"; rr(g, -18, -79, 36, 86, 14);
      g.fillStyle = "rgba(190,255,250,.85)"; rr(g, -10, -70, 20, 60, 9);
      g.fillStyle = "#1c2226"; rr(g, -14, 24, 28, 8, 3); } },
  { name: "モニタースピーカー", w: 158, h: 82, draw(g) {
      g.fillStyle = "#23282d"; g.beginPath(); g.moveTo(-79, 41); g.lineTo(79, 41); g.lineTo(58, -41); g.lineTo(-58, -41); g.closePath(); g.fill();
      g.fillStyle = "#3a4148"; g.beginPath(); g.ellipse(-30, 6, 26, 22, 0, 0, 7); g.fill();
      g.fillStyle = "#171b1f"; g.beginPath(); g.ellipse(-30, 6, 17, 14, 0, 0, 7); g.fill();
      g.fillStyle = "#3a4148"; g.beginPath(); g.ellipse(34, 8, 18, 15, 0, 0, 7); g.fill(); } },
];

/* ---- ステージ（背景 + お題群）----------------------------------------- */
function band(g, W, y0, y1, c0, c1) {
  const gr = g.createLinearGradient(0, y0, 0, y1);
  gr.addColorStop(0, c0); gr.addColorStop(1, c1);
  g.fillStyle = gr; g.fillRect(0, y0, W, y1 - y0);
}

export const STAGES = [
  { key: "kitchen", name: "台所", objects: KITCHEN, ground: "#6b5847",
    draw(g, W, H, t) {
      band(g, W, 0, H, "#2b2a26", "#16181a");
      g.fillStyle = "rgba(255,255,255,.035)";                 // タイル壁
      for (let y = 40; y < 440; y += 52) for (let x = 20; x < W; x += 52) rr(g, x, y, 46, 46, 4);
      band(g, W, 452, H, "#5d4c3c", "#33291f");               // 天板
      g.fillStyle = "rgba(255,246,220,.05)"; g.fillRect(0, 452, W, 6);
      g.fillStyle = "rgba(255,214,120,.07)";                    // 吊り照明
      for (const x of [200, 480, 760]) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x - 90, 452); g.lineTo(x + 90, 452); g.closePath(); g.fill(); } } },

  { key: "street", name: "通学路", objects: STREET, ground: "#3c4249",
    draw(g, W, H, t) {
      band(g, W, 0, 452, "#1b3350", "#3d5772");
      g.fillStyle = "rgba(255,255,255,.05)";                   // 遠景のビル
      for (let i = 0; i < 9; i++) { const w = 70 + (i % 3) * 34, h = 120 + ((i * 37) % 130);
        rr(g, i * 112 - 20, 452 - h, w, h, 3); }
      band(g, W, 452, H, "#464d54", "#23282d");                // 路面
      g.strokeStyle = "rgba(255,246,190,.28)"; g.lineWidth = 5; g.setLineDash([46, 34]);
      g.beginPath(); g.moveTo(0, 546); g.lineTo(W, 546); g.stroke(); g.setLineDash([]); } },

  { key: "desk", name: "机の上", objects: DESK, ground: "#7a5a3a",
    draw(g, W, H, t) {
      band(g, W, 0, 452, "#20262b", "#2c353c");
      g.strokeStyle = "rgba(160,200,215,.07)"; g.lineWidth = 2;   // 方眼のコルクボード
      for (let x = 0; x < W; x += 46) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 452); g.stroke(); }
      for (let y = 0; y < 452; y += 46) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
      band(g, W, 452, H, "#8a6440", "#4a3423");                  // 木の天板
      g.strokeStyle = "rgba(0,0,0,.14)"; g.lineWidth = 3;
      for (let y = 470; y < H; y += 26) { g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(W / 3, y - 5, W * 2 / 3, y + 5, W, y); g.stroke(); }
      g.fillStyle = "rgba(255,240,200,.10)"; g.beginPath();      // デスクライトの光
      g.moveTo(110, 0); g.lineTo(-40, H); g.lineTo(420, H); g.lineTo(200, 0); g.closePath(); g.fill(); } },

  { key: "live", name: "ライブハウス", objects: LIVE, ground: "#1b1f24",
    draw(g, W, H, t) {
      band(g, W, 0, H, "#0b0f14", "#161d26");
      const cols = ["rgba(57,197,187,.13)", "rgba(236,64,142,.11)", "rgba(255,214,90,.10)"];
      cols.forEach((c, i) => {                                   // 振り回されるムービングライト
        const x = W / 2 + Math.sin(t * 0.7 + i * 2.1) * 300;
        g.fillStyle = c; g.beginPath();
        g.moveTo(W / 2 + (i - 1) * 120, -10); g.lineTo(x - 110, 500); g.lineTo(x + 110, 500); g.closePath(); g.fill(); });
      band(g, W, 452, H, "#252b33", "#0d1116");                  // ステージ床
      g.fillStyle = "rgba(255,255,255,.05)"; g.fillRect(0, 452, W, 4);
      g.fillStyle = "rgba(255,255,255,.04)";                     // 客席のシルエット
      for (let i = 0; i < 26; i++) { const x = 18 + i * 37, r = 15 + (i % 4) * 3;
        g.beginPath(); g.arc(x, H - 14, r, Math.PI, 0); g.fill(); } } },
];

export const stageOf = c => STAGES[Math.floor(c / 4) % STAGES.length];
export { rr };
