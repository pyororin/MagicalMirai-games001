import test from "node:test";
import assert from "node:assert/strict";

// ブラウザ API の最小スタブ(TextAliveSource は生成時に window.fetch をラップする)
globalThis.window = { fetch: async () => ({ ok: true, url: "https://api.textalive.jp/cards/RESOLVED" }) };
const { TextAliveSource } = await import("../app/src/textalive.js");

const DEF = { url: "https://piapro.jp/t/CyPO/20250128183915", card: "https://api.textalive.jp/cards/KNOWN", video: { beatId: 1 } };

function make(player) {
  const s = new TextAliveSource({ build: 1, mediaEl: {} });
  s.player = player;
  return s;
}

test("最初に事前解決したカード URL を使う(/cards/resolve のリダイレクトに頼らない)", async () => {
  const calls = [];
  const s = make({
    createFromCardUrl: async (u) => calls.push(["card", u]),
    createFromSongUrl: async (u) => calls.push(["song", u]),
  });
  await s.loadSong(DEF);
  assert.deepEqual(calls, [["card", DEF.card]]);
  assert.match(s.diag.join("\n"), /カードURL → 要求済み/);
});

test("カード URL が失敗したら曲 URL へ。例外の文言は問わない(端末で違うため)", async () => {
  const calls = [];
  const s = make({
    createFromCardUrl: async () => { throw new TypeError("Load failed"); },
    createFromSongUrl: async (u) => calls.push(["song", u]),
  });
  await s.loadSong(DEF);
  assert.deepEqual(calls, [["song", DEF.url]]);
  assert.match(s.diag.join("\n"), /カードURL → 失敗: Load failed/);
});

test("曲 URL も 'Card data resolver' 以外で失敗したら、自前の resolve 追従へ", async () => {
  const calls = [];
  const s = make({
    createFromCardUrl: async (u) => {
      calls.push(["card", u]);
      if (u === DEF.card) throw new Error("boom1");
    },
    createFromSongUrl: async () => { throw new Error("boom2"); },
  });
  await s.loadSong(DEF);
  assert.deepEqual(calls, [["card", DEF.card], ["card", "https://api.textalive.jp/cards/RESOLVED"]]);
  const d = s.diag.join("\n");
  assert.match(d, /カードURL → 失敗: boom1/);
  assert.match(d, /曲URL → 失敗: boom2/);
});

test("全経路が失敗したら例外にし、各経路の理由が診断に残る", async () => {
  const s = make({
    createFromCardUrl: async () => { throw new Error("e1"); },
    createFromSongUrl: async () => { throw new Error("e2"); },
  });
  await assert.rejects(() => s.loadSong(DEF), /すべての読み込み経路/);
  assert.equal(s.loadLog.length, 3);
});

test("曲を読み直すと診断はリセットされる", async () => {
  const s = make({ createFromCardUrl: async () => { throw new Error("x"); }, createFromSongUrl: async () => {} });
  await s.loadSong(DEF);
  const n = s.loadLog.length;
  await s.loadSong(DEF);
  assert.equal(s.loadLog.length, n);
});
