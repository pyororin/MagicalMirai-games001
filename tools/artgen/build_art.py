"""build_art — lyric-homerun の素材(背景・打者ミク・投手 MEIKO)を、すべてコードで作る。

  デザインデータ(lyric-homerun/art-src/design/*.json)
    → artgen: 元絵(SVG・高解像度 PNG)をコードで描く            ← AI は使わない
    → img2vector: べた塗り+手書き風のゆらぎ、形が似ているかの確認つきで、素材の SVG と PNG にする

既定は「下書き」(lyric-homerun/art-src/build/ に出す)。--install で、ゲーム用の
app/assets/*.png と art-src/*.svg に置き、art.json(拳の位置)と provenance.json(出どころ=program)を更新する。

  python tools/artgen/build_art.py                  # 3枚とも下書きを作る
  python tools/artgen/build_art.py --only batter    # 1枚だけ
  python tools/artgen/build_art.py --install        # ゲームに入れる(案を見せて承認を得てから)
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
import time
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "img2vector"))
import artgen  # noqa: E402
import proportion_check  # noqa: E402
import img2vector as i2v  # noqa: E402

ROOT = HERE.parent.parent / "lyric-homerun"

# 素材ごとの設定。scale = 元絵 PNG の拡大倍率、png_h = ゲーム用 PNG の高さ。
# sketch = 手書き風のゆらぎ(元絵 px)。強いと下手な絵に見えるので、画面で 0.5px 前後(設計 §7)。
# tries = 再現度の基準を満たすまで順に試す設定(色数・平滑化・色の統合・ゆらぎ)。
def _tries(*colors, sketch, wave, mis):
    return [dict(colors=c, smooth=sm, merge=mg, sketch=sketch * f, wave=wave, mis=mis * f)
            for c, sm, mg, f in zip(colors, (1, 0, 0, 0, 0), (2.5, 2.0, 1.6, 1.3, 1.0), (1.0, 1.0, 0.8, 0.8, 0.6))]


ASSETS = {
    "background": dict(asset="bg.png", scale=2.0, upscale=0.75, png_h=2100, transparent=False,
                       tries=_tries(34, 42, 52, 62, 72, sketch=2.5, wave=160, mis=1.0)),
    "batter": dict(asset="miku.png", scale=3.0, upscale=1.0, png_h=600, transparent=True,
                   tries=_tries(40, 48, 58, 68, 78, sketch=3.0, wave=120, mis=1.0)),
    "pitcher": dict(asset="pitcher.png", scale=4.0, upscale=1.0, png_h=400, transparent=True,
                    tries=_tries(40, 48, 58, 68, 78, sketch=3.0, wave=100, mis=1.0)),
}
# 再現度の基準(設計 §7)。表示サイズに縮めて、元絵に対して測る
GOAL = {"ssim": 0.90, "delta_e": 3.0, "edge_f1": 0.92, "iou": 0.98}


def misses(f: dict) -> float:
    """基準にどれだけ届かないか(0 なら合格)。基準で割った不足分の合計。"""
    m = max(0.0, (GOAL["ssim"] - f["ssim"]) / GOAL["ssim"])
    m += max(0.0, (f["delta_e"] - GOAL["delta_e"]) / GOAL["delta_e"])
    m += max(0.0, (GOAL["edge_f1"] - f["edge_f1"]) / GOAL["edge_f1"])
    if f.get("iou") is not None:
        m += max(0.0, (GOAL["iou"] - f["iou"]) / GOAL["iou"])
    return m
ANCHORS = {"batter": ("batterHand", "fist")}  # 打者の拳の中心(デザインデータの landmarks の位置)
# 縁につながらない背景色の隙間(腕と胴のあいだ、顎の下など)。デザインデータの座標。ゲーム上で白い塊にならないよう透過にする。
# 白い襟など、絵の一部の白は残す(ここに書かない)。
CLEAR_GAPS = {"batter": [(277, 309), (265, 180), (222, 174), (180, 281), (287, 400), (308, 537)], "pitcher": [(74, 310)]}


def snap_seeds(rgba, seeds, tol=12.0, radius=60):
    """指定した点の近くにある「背景色(四隅の色)の画素」を探して、clear_at の座標にする。"""
    import cv2
    from skimage.color import rgb2lab
    rgb = rgba[..., :3]
    lab = rgb2lab(rgb)
    h, w = rgb.shape[:2]
    ref = np.median(np.array([lab[0, 0], lab[0, w - 1], lab[h - 1, 0], lab[h - 1, w - 1]]), axis=0)
    near = np.linalg.norm(lab - ref, axis=2) <= tol
    out = []
    for x, y in seeds:
        x, y = int(x), int(y)
        y0, y1, x0, x1 = max(0, y - radius), min(h, y + radius), max(0, x - radius), min(w, x + radius)
        ys, xs = np.where(near[y0:y1, x0:x1])
        if len(ys) == 0:
            raise ValueError(f"隙間の指定 ({x},{y}) の近くに背景色が無い")
        k = int(np.argmin((ys + y0 - y) ** 2 + (xs + x0 - x) ** 2))
        out.append([int(xs[k] + x0), int(ys[k] + y0)])
    return out


def build(name: str, out: Path) -> dict:
    """基準(GOAL)を満たすまで、設定を変えて作り直す。毎回の結果を <name>.attempts.json に残す。"""
    cfg = ASSETS[name]
    design = artgen.load_design(ROOT / "art-src" / "design" / f"{name}.json")
    # デッサンの検査(docs/character-design-basics.md)。通らない絵は作らない
    if design.get("style"):
        res = proportion_check.check(design)
        if not proportion_check.report(f"{name}.json", res):
            raise SystemExit(f"{name}: バランス検査に通らない。デザインデータを直すこと")
    out.mkdir(parents=True, exist_ok=True)
    paths = artgen.write(design, out, cfg["scale"], stem=name)
    rgba = i2v.load_rgba(paths["png"])
    gaps = snap_seeds(rgba, [(x * cfg["scale"], y * cfg["scale"]) for x, y in CLEAR_GAPS.get(name, [])])
    best = None
    log = []
    for n, t in enumerate(cfg["tries"], 1):
        t0 = time.time()
        opts = i2v.TraceOptions(colors=t["colors"], upscale=cfg["upscale"], transparent_bg=cfg["transparent"], smooth=t["smooth"],
                                merge_delta=t["merge"], sketch=t["sketch"], sketch_wave=t["wave"], misregister=t["mis"],
                                verify_edge_f1=GOAL["edge_f1"], verify_iou=GOAL["iou"], clear_at=gaps)
        res = i2v.trace_image(rgba, opts)
        f = res.report["fidelity"]
        m = misses(f)
        v = res.report.get("verify") or {}
        log.append({"try": n, "colors": t["colors"], "smooth": t["smooth"], "merge": t["merge"], "sketch": round(v.get("amp_used", t["sketch"]), 2),
                    "paths": res.report["paths"], "fidelity": f, "miss": round(m, 4), "seconds": round(time.time() - t0)})
        print(f"{name} 試行{n}: 色{t['colors']} 平滑{t['smooth']} 統合{t['merge']} ゆらぎ{log[-1]['sketch']}px → "
              f"SSIM {f['ssim']} ΔE {f['delta_e']} 輪郭 {f['edge_f1']} IoU {f['iou']}  {'合格' if m == 0 else f'不足 {m:.3f}'}  ({log[-1]['seconds']}秒)")
        if best is None or m < best[0]:
            best = (m, res, n)
        if m == 0:
            break
    m, res, n = best
    print(f"{name}: 試行{n}を採用 ({'基準を満たした' if m == 0 else '基準に届かず、最良を採用'})")
    files = i2v.write_outputs(res, out, name, cfg["png_h"])
    (out / f"{name}.attempts.json").write_text(json.dumps({"goal": GOAL, "chosen": n, "attempts": log}, ensure_ascii=False, indent=2), encoding="utf-8")
    rep = res.report
    anchor = None
    if name in ANCHORS and rep.get("crop"):
        key, lm = ANCHORS[name]
        ax, ay = design["landmarks"][lm]
        x0, y0, x1, y1 = rep["crop"]
        anchor = (key, [round((ax * cfg["scale"] - x0) / (x1 - x0), 3), round((ay * cfg["scale"] - y0) / (y1 - y0), 3)])
    return {"files": files, "anchor": anchor, "report": rep}


def install(name: str, built: dict, out: Path) -> None:
    cfg = ASSETS[name]
    shutil.copy(built["files"]["png"], ROOT / "app" / "assets" / cfg["asset"])
    shutil.copy(out / f"{name}.svg", ROOT / "art-src" / f"{name}.svg")
    shutil.copy(out / f"{name}.report.json", ROOT / "art-src" / f"{name}.report.json")
    if (out / f"{name}.attempts.json").exists():
        shutil.copy(out / f"{name}.attempts.json", ROOT / "art-src" / f"{name}.attempts.json")
    prov_path = ROOT / "art-src" / "provenance.json"
    prov = json.loads(prov_path.read_text(encoding="utf-8"))
    prov["assets"]["assets/" + cfg["asset"]] = {
        "source": "program",
        "note": f"art-src/design/{name}.json(デザインデータ)を tools/artgen がコードで描き、tools/img2vector で手書き風にした。AI 不使用",
        "svg": f"art-src/{name}.svg",
    }
    prov_path.write_text(json.dumps(prov, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if built["anchor"]:
        art_path = ROOT / "app" / "data" / "art.json"
        art = json.loads(art_path.read_text(encoding="utf-8"))
        art[built["anchor"][0]] = built["anchor"][1]
        art_path.write_text(json.dumps(art, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def sheet(names, out: Path) -> Path:
    """案シート: 元絵と素材を並べて、1枚の PNG にする(承認を得るために見せる用)。"""
    h = 600
    tiles = []
    for n in names:
        for suffix in ("", ):
            im = Image.open(out / f"{n}.png").convert("RGBA")
            im = im.resize((max(1, round(im.width * h / im.height)), h), Image.LANCZOS)
            bg = Image.new("RGB", im.size, (158, 196, 122) if ASSETS[n]["transparent"] else (255, 255, 255))
            bg.paste(im, (0, 0), im)
            tiles.append(bg)
    W = sum(t.width for t in tiles) + 20 * (len(tiles) + 1)
    sh = Image.new("RGB", (W, h + 40), (240, 236, 224))
    x = 20
    for t in tiles:
        sh.paste(t, (x, 20))
        x += t.width + 20
    p = out / "sheet.png"
    sh.save(p)
    return p


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="素材をすべてコードで作る(デザインデータ → 元絵 → 手書き風)")
    ap.add_argument("--only", choices=list(ASSETS), help="1つだけ作る")
    ap.add_argument("--out", default=str(ROOT / "art-src" / "build"), help="下書きの出力先")
    ap.add_argument("--install", action="store_true", help="ゲーム(app/assets)に入れ、出どころを program にする")
    a = ap.parse_args(argv)
    names = [a.only] if a.only else list(ASSETS)
    out = Path(a.out)
    built = {n: build(n, out) for n in names}
    print("案シート:", sheet(names, out))
    if a.install:
        for n in names:
            install(n, built[n], out)
        print("ゲームに入れた。python tools/check_art_provenance.py で検査すること")
    return 0


if __name__ == "__main__":
    sys.exit(main())
