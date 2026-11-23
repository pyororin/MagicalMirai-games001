"""proportion_check — キャラクターの絵が、デッサンとデザインの基本(docs/character-design-basics.md)に合っているかを測る。

デザインデータ(JSON)の "style" と "landmarks"(絵の上の位置の目印)から、次を調べる。
  P1 頭身 / P2 目の高さ / P3 肩幅(正面)・胴の厚み(横向き) / P4 脚の長さ / P5 膝の位置 / P6 腕とこぶし / P7 足の長さ /
  P8 脚の左右 / P9 重心(プラムライン) / P10 髪の量 / P11 目印が絵と合っているか(嘘の目印を防ぐ) /
  P12 膝の曲げ・P13 胴の傾き・P14 頭の位置(構えの安定。style.stance = "athletic" のとき)

  python tools/artgen/proportion_check.py lyric-homerun/art-src/design/batter.json
  python tools/artgen/proportion_check.py --all        # 3つとも。1つでも不合格なら終了コード 1

"style": {"kind": "stylized" | "chibi", "view": "side" | "front", "heads": [4.0, 5.2],
          "stance": "athletic",                # 任意。構えの安定を検査する
          "skip": ["P8"],                      # この検査はしない(理由は style の "why" に書く)
          "override": {"P4": [0.30, 0.45]},    # 幅を、このキャラだけ変える(理由を書く)
          "hair_part": "hair_tail", "hair_max": 0.58,
          "support_x": [x0, x1],               # 足の支え(両足の外側のあいだ)。重心の検査に使う
          "balance_skip_parts": ["hair_tail"]} # 重心を測るときに除く部品
"landmarks": {head_top, chin, head_left, head_right, eye, neck, hip, shoulder, elbow, wrist, fist_d,
              torso_back, torso_front, shoulder_l, shoulder_r,
              leg_a: {hip, knee, ankle, sole}, leg_b: {...}, foot_a: {heel, toe}, foot_b: {...}}  (どれも [x, y]。無ければ、その検査は飛ばす)
"""

from __future__ import annotations

import argparse
import io
import json
import math
import sys
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
import artgen  # noqa: E402

DESIGN_DIR = Path(__file__).resolve().parents[2] / "lyric-homerun" / "art-src" / "design"

# 幅(アニメ調 stylized / ちび調 chibi)。根拠: docs/character-design-basics.md §2
RANGES = {
    "P2": {"stylized": (0.50, 0.66), "chibi": (0.55, 0.72)},
    "P3": {"front": (1.0, 2.0), "side": (0.45, 1.3)},
    "P4": {"stylized": (0.38, 0.50), "chibi": (0.30, 0.42)},
    "P5": {"stylized": (0.40, 0.62), "chibi": (0.40, 0.62)},
    "P6_arm": (0.85, 1.45),
    "P6_fist": (0.30, 0.60),
    "P7": (0.50, 1.05),
    "P8": (0.0, 0.12),
    "P9": (0.10, 0.90),
    "P12": (135.0, 168.0),   # 膝の角度(度)。180 が棒立ち
    "P13": (3.0, 18.0),      # 胴の傾き(度)。0 が直立
}


@dataclass
class Result:
    id: str
    name: str
    value: float | None
    lo: float
    hi: float
    ok: bool
    note: str = ""


def _d(a, b) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])


def _angle(a, b, c) -> float:
    """b を頂点とする、a-b-c の角度(度)。"""
    v1 = (a[0] - b[0], a[1] - b[1])
    v2 = (c[0] - b[0], c[1] - b[1])
    cos = (v1[0] * v2[0] + v1[1] * v2[1]) / ((math.hypot(*v1) * math.hypot(*v2)) or 1)
    return math.degrees(math.acos(max(-1, min(1, cos))))


def _rng(style: dict, key: str, sub: str | None = None):
    if key in style.get("override", {}):
        return tuple(style["override"][key])
    r = RANGES[key]
    return r[sub] if sub else r


def _mask(design: dict, skip_parts=()) -> np.ndarray:
    """絵の「何かが描いてある」画素(背景色でない画素)。"""
    svg = artgen.render_svg(design, skip_parts)
    w, h = design["size"]
    im = np.array(Image.open(io.BytesIO(artgen.render_png(svg, w, h))).convert("RGB")).astype(int)
    bg = np.array([int(design.get("bg", "#FFFFFF")[i:i + 2], 16) for i in (1, 3, 5)])
    return np.abs(im - bg).sum(axis=2) > 24, im


def check(design: dict) -> list[Result]:
    st, lm = design.get("style", {}), design.get("landmarks", {})
    kind, view = st.get("kind", "stylized"), st.get("view", "side")
    skip = set(st.get("skip", []))
    out: list[Result] = []

    def add(id_, name, value, rng, note=""):
        if id_ in skip:
            return
        lo, hi = rng
        out.append(Result(id_, name, None if value is None else round(float(value), 3), lo, hi,
                          value is not None and lo <= value <= hi, note))

    need = lambda *k: all(x in lm for x in k)  # noqa: E731
    legs = [lm[k] for k in ("leg_a", "leg_b") if k in lm]
    sole_y = max((l["sole"][1] for l in legs), default=None)
    head_h = (lm["chin"][1] - lm["head_top"][1]) if need("head_top", "chin") else None
    head_w = (lm["head_right"][0] - lm["head_left"][0]) if need("head_left", "head_right") else None
    total = (sole_y - lm["head_top"][1]) if (sole_y is not None and need("head_top")) else None

    if head_h and total:
        add("P1", "頭身(頭頂〜足裏 ÷ 頭の高さ)", total / head_h, tuple(st["heads"]) if "heads" in st else (0, 99))
    if head_h and need("eye"):
        add("P2", "目の高さ(頭頂〜あごの何割か)", (lm["eye"][1] - lm["head_top"][1]) / head_h, _rng(st, "P2", kind))
    if head_w:
        if view == "front" and need("shoulder_l", "shoulder_r"):
            add("P3", "肩幅 ÷ 頭の幅", (lm["shoulder_r"][0] - lm["shoulder_l"][0]) / head_w, _rng(st, "P3", "front"))
        elif view == "side" and need("torso_back", "torso_front"):
            add("P3", "胴の厚み ÷ 頭の幅", (lm["torso_front"][0] - lm["torso_back"][0]) / head_w, _rng(st, "P3", "side"))
    if total and need("hip") and legs:
        add("P4", "脚の長さ(股〜足裏 ÷ 全身)", (sole_y - lm["hip"][1]) / total, _rng(st, "P4", kind))
    for k in ("leg_a", "leg_b"):
        if k in lm and need("hip") and "knee" in lm[k] and "ankle" in lm[k]:
            l = lm[k]
            f = (l["knee"][1] - l["hip"][1]) / ((l["ankle"][1] - l["hip"][1]) or 1)
            add("P5", f"膝の位置({k}: 股〜足首の何割か)", f, _rng(st, "P5", kind))
    if need("shoulder", "elbow", "wrist"):
        add("P6", "上腕 ÷ 前腕", _d(lm["shoulder"], lm["elbow"]) / _d(lm["elbow"], lm["wrist"]), _rng(st, "P6_arm"))
    if head_h and "fist_d" in lm:
        add("P6", "こぶしの直径 ÷ 頭の高さ", lm["fist_d"] / head_h, _rng(st, "P6_fist"))
    for k in ("foot_a", "foot_b"):
        if k in lm and head_h:
            add("P7", f"足の長さ({k} ÷ 頭の高さ)", abs(lm[k]["toe"][0] - lm[k]["heel"][0]) / head_h, _rng(st, "P7"))
    if len(legs) == 2 and need("hip"):
        la, lb = (sole_y - lm["hip"][1] for sole_y in (legs[0]["sole"][1], legs[1]["sole"][1]))
        add("P8", "脚の左右の差", abs(la - lb) / max(la, lb), _rng(st, "P8"))

    # 絵そのものを使う検査
    mask_all, im = _mask(design)
    parts = tuple(st.get("balance_skip_parts", []))
    mask_body, _ = _mask(design, parts)
    ys, xs = np.where(mask_body)
    if "support_x" in st and len(xs):
        lo, hi = st["support_x"]
        com = xs.mean()
        add("P9", "重心の x(足の支えの何割か)", (com - lo) / (hi - lo), _rng(st, "P9"), f"重心 x={com:.0f} 支え {lo:.0f}〜{hi:.0f}")
    if "hair_max" in st and len(xs):
        share = 1 - mask_body.sum() / max(1, mask_all.sum())
        add("P10", "髪(ツインテール)がシルエットに占める割合", share, (0.0, st["hair_max"]))

    if st.get("stance") == "athletic" and need("hip", "neck"):
        # P12 膝の曲げ: 2本とも(立つ脚を除く指定は skip で)
        for k in ("leg_a", "leg_b"):
            if k in lm and "knee" in lm[k]:
                l = lm[k]
                add("P12", f"膝の角度({k}。180°=棒立ち)", _angle(l["hip"], l["knee"], l["ankle"]), _rng(st, "P12"))
        v = (lm["neck"][0] - lm["hip"][0], lm["hip"][1] - lm["neck"][1])
        lean = abs(math.degrees(math.atan2(v[0], v[1])))
        add("P13", "胴の傾き(腰→首。0°=直立)", lean, _rng(st, "P13"))
        if "support_x" in st and "head_center" in lm:
            lo, hi = st["support_x"]
            add("P14", "頭の x(足の支えの何割か)", (lm["head_center"][0] - lo) / (hi - lo), (0.0, 1.0))

    # P11 目印の整合(嘘の目印を防ぐ)
    h, w = mask_all.shape

    def px(p):
        return im[min(h - 1, max(0, int(round(p[1])))), min(w - 1, max(0, int(round(p[0]))))]

    if "eye" in lm and "P11" not in skip:
        v = px(lm["eye"]).sum() / 3
        out.append(Result("P11", "目印 eye は暗い色の上(目)", round(float(v), 1), 0, 110, bool(v < 110)))
    if "fist" in lm and "P11" not in skip:
        skin = [int(design["colors"]["skin"][i:i + 2], 16) for i in (1, 3, 5)]
        dist = float(np.abs(px(lm["fist"]) - np.array(skin)).sum() / 3)
        on_art = bool(mask_all[min(h - 1, max(0, int(round(lm["fist"][1])))), min(w - 1, max(0, int(round(lm["fist"][0]))))])
        out.append(Result("P11", "目印 fist は絵の上の肌色(こぶし)", round(dist, 1) if on_art else 999.0, 0, 45, dist < 45 and on_art))
    if "P11" not in skip:
        for k in ("leg_a", "leg_b"):
            if k in lm:
                x, y = lm[k]["sole"]
                inside = mask_all[min(h - 1, int(y) - 3), int(x)]
                below = (not mask_all[min(h - 1, int(y) + 5), int(x)]) if y + 5 < h else True
                out.append(Result("P11", f"目印 {k}.sole は足裏(上は絵・下は背景)", 1.0 if (inside and below) else 0.0, 1, 1, bool(inside and below)))
        if "head_top" in lm:
            x, y = lm["head_top"]
            inside = mask_all[int(y) + 3, int(x)]
            above = not mask_all[max(0, int(y) - 5), int(x)]
            out.append(Result("P11", "目印 head_top は頭頂(上は背景・下は絵)", 1.0 if (inside and above) else 0.0, 1, 1, bool(inside and above)))
    return out


def report(name: str, results: list[Result]) -> bool:
    ok_all = all(r.ok for r in results)
    print(f"== {name}  {'合格' if ok_all else '不合格'}")
    for r in results:
        mark = "  ok " if r.ok else " NG  "
        v = "—" if r.value is None else f"{r.value:g}"
        print(f"{mark}{r.id:<4}{r.name}: {v}  (基準 {r.lo:g}〜{r.hi:g}){'  ' + r.note if r.note else ''}")
    return ok_all


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="キャラクターのバランス検査(デッサンの基本)")
    ap.add_argument("design", nargs="?", help="デザインデータ(JSON)")
    ap.add_argument("--all", action="store_true", help="batter / pitcher の両方")
    ap.add_argument("--json", help="結果を JSON で書き出す")
    a = ap.parse_args(argv)
    files = [DESIGN_DIR / "batter.json", DESIGN_DIR / "pitcher.json"] if a.all else [Path(a.design)]
    ok = True
    dump = {}
    for f in files:
        d = artgen.load_design(f)
        res = check(d)
        ok &= report(f.name, res)
        dump[f.name] = [r.__dict__ for r in res]
    if a.json:
        Path(a.json).write_text(json.dumps(dump, ensure_ascii=False, indent=2), encoding="utf-8")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
