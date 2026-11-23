"""artgen — デザインデータ(JSON)から、元絵(SVG と高解像度 PNG)をコードで描く。

画像生成 AI は使わない。形・色・位置はすべて人が(コードの AI 支援を受けて)JSON に書いたデザインデータ。
ここで描くのは「元絵」で、このあと tools/img2vector が、べた塗り+手書き風のゆらぎを足して、ゲームで使う素材にする。

デザインデータ(JSON)の形:
{
  "name": "batter", "size": [420, 600],        # 作業キャンバス(px)。PNG は scale 倍で出す
  "bg": "#FFFFFF",                             # 背景色。null で透過
  "outline": "#5E4033", "w": 4,                # 既定の輪郭線の色と太さ
  "colors": {"hair": "#6FBBBB"},               # 名前付きの色。図形では "$hair" と書く
  "shapes": [                                  # 奥から手前の順に描く
    {"t": "path", "d": "M10 10 C ... Z", "fill": "$hair"},          # SVG の path(M L C Q A Z)
    {"t": "ellipse", "cx": 100, "cy": 80, "rx": 30, "ry": 20, "rot": -10, "fill": "#fff"},
    {"t": "rrect", "x": 10, "y": 10, "w": 40, "h": 60, "r": 12, "fill": "#eee"},
    {"t": "poly", "pts": [[0,0],[10,0],[5,9]], "fill": "#f00"},
    {"t": "line", "pts": [[0,0],[50,40]], "stroke": "#000", "w": 6},   # 開いた線(塗りなし)
    {"t": "limb", "pts": [[100,10],[96,60],[90,110]], "widths": [40,30,24], "fill": "#333"},   # 先細りの手足(中心線と太さ)
    {"t": "path", "d": "...", "part": "hair_tail", "fill": "$hair"},   # "part": 検査で「髪を除いて」描くときの名前
    {"t": "group", "tx": 10, "ty": 20, "rot": 15, "sx": 1, "sy": 1, "shapes": [ ... ]}   # 動かして使い回す
  ]
}
陰影(アニメ塗り): 図形に "shade": {"c": "$hairD", "dx": -6, "dy": -5}(影)や "hl": {"c": "#fff", "dx": 4, "dy": 5}(ハイライト)を書くと、
  形から、(dx, dy) ずらした同じ形を引いた「三日月」だけがその色で塗られる(ずらした側と反対の縁に出る。光が左上なら影は dx, dy を負に)。
線の強弱: 設計の最上位に "ink": [1.2, 1.6] を書くと、輪郭の太さが、その向き(右下)だけ少し増える。図形ごとに "ink": null で無効。
共通: "w"(rrect では "lw")が輪郭の太さ。0 で輪郭なし、"stroke": 輪郭の色、"fill": "none" で塗りなし。
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from xml.sax.saxutils import quoteattr

import resvg_py


def _color(v, colors, default):
    if v is None:
        return default
    if isinstance(v, str) and v.startswith("$"):
        return colors[v[1:]]
    return v


def _num(v) -> str:
    return f"{v:.2f}".rstrip("0").rstrip(".") if isinstance(v, float) else str(v)


def _limb_path(pts, widths) -> str:
    """中心線(pts)と各点の太さ(widths)から、先細りの手足の輪郭(なめらかな閉じた path)を作る。"""
    import math
    n = len(pts)
    left, right = [], []
    for i, (x, y) in enumerate(pts):
        x0, y0 = pts[max(i - 1, 0)]
        x1, y1 = pts[min(i + 1, n - 1)]
        dx, dy = x1 - x0, y1 - y0
        d = math.hypot(dx, dy) or 1.0
        nx, ny = -dy / d, dx / d
        h = widths[i] / 2
        left.append((x + nx * h, y + ny * h))
        right.append((x - nx * h, y - ny * h))
    poly = left + right[::-1]

    def smooth(seq):  # Catmull-Rom → 3 次ベジェ
        out = []
        for i in range(len(seq) - 1):
            p0 = seq[max(i - 1, 0)]
            p1, p2 = seq[i], seq[i + 1]
            p3 = seq[min(i + 2, len(seq) - 1)]
            c1 = (p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6)
            c2 = (p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6)
            out.append(f"C{c1[0]:.1f} {c1[1]:.1f} {c2[0]:.1f} {c2[1]:.1f} {p2[0]:.1f} {p2[1]:.1f}")
        return " ".join(out)

    d = f"M{left[0][0]:.1f} {left[0][1]:.1f} " + smooth(left)
    d += f" L{right[-1][0]:.1f} {right[-1][1]:.1f} " + smooth(right[::-1]) + " Z"
    return d


def _geom(sh: dict) -> tuple[str, str]:
    """図形の形だけ(塗り・線なし)。 (タグ名, 属性) を返す。"""
    t = sh.get("t", "path")
    tf = ""
    if sh.get("rot") and t in ("ellipse", "rrect"):
        cx = sh["cx"] if t == "ellipse" else sh["x"] + sh["w"] / 2
        cy = sh["cy"] if t == "ellipse" else sh["y"] + sh["h"] / 2
        tf = f' transform="rotate({_num(sh["rot"])} {_num(cx)} {_num(cy)})"'
    if t == "path":
        return "path", f"d={quoteattr(sh['d'])}"
    if t == "limb":
        return "path", f"d={quoteattr(_limb_path(sh['pts'], sh['widths']))}"
    if t == "ellipse":
        return "ellipse", f'cx="{_num(sh["cx"])}" cy="{_num(sh["cy"])}" rx="{_num(sh["rx"])}" ry="{_num(sh["ry"])}"{tf}'
    if t == "rrect":
        return "rect", f'x="{_num(sh["x"])}" y="{_num(sh["y"])}" width="{_num(sh["w"])}" height="{_num(sh["h"])}" rx="{_num(sh.get("r", 0))}"{tf}'
    if t == "poly":
        return "polygon", 'points="' + " ".join(f"{_num(x)},{_num(y)}" for x, y in sh["pts"]) + '"'
    raise ValueError(f"不明な図形 t={t!r}")


def _shape(sh: dict, ctx: dict) -> str:
    t = sh.get("t", "path")
    colors = ctx["colors"]
    if sh.get("part") and sh["part"] in ctx.get("skip", ()):
        return ""  # 検査のために、この部品(例: 髪)を除いて描く
    if t == "group":
        tr = []
        if sh.get("tx") or sh.get("ty"):
            tr.append(f"translate({_num(sh.get('tx', 0))} {_num(sh.get('ty', 0))})")
        if sh.get("rot"):
            tr.append(f"rotate({_num(sh['rot'])} {_num(sh.get('ox', 0))} {_num(sh.get('oy', 0))})")
        if sh.get("sx", 1) != 1 or sh.get("sy", 1) != 1:
            tr.append(f"scale({_num(sh.get('sx', 1))} {_num(sh.get('sy', 1))})")
        inner = "".join(_shape(c, ctx) for c in sh["shapes"])
        return f'<g transform="{" ".join(tr)}">{inner}</g>' if tr else f"<g>{inner}</g>"
    if t == "line":
        pts = " ".join(f"{_num(x)},{_num(y)}" for x, y in sh["pts"])
        w2 = sh.get("w", ctx["w"]) or ctx["w"]
        s2 = _color(sh.get("stroke"), colors, ctx["outline"])
        return f'<polyline points="{pts}" fill="none" stroke="{s2}" stroke-width="{_num(w2)}" stroke-linejoin="round" stroke-linecap="round"/>'
    fill = _color(sh.get("fill"), colors, "none")
    # 輪郭線の太さ: rrect は "w" が幅なので "lw" を使う(他の図形は "w" でも "lw" でもよい)
    w = sh.get("lw", ctx["w"] if t == "rrect" else sh.get("w", ctx["w"]))
    stroke = _color(sh.get("stroke"), colors, ctx["outline"])
    tag, geo = _geom(sh)
    st = f'stroke="{stroke}" stroke-width="{_num(w)}" stroke-linejoin="round" stroke-linecap="round"' if w else ""
    out = []
    ink = sh.get("ink", ctx.get("ink"))
    if w and ink and fill != "none":
        # 線の太さの強弱: 輪郭だけを少しずらして、奥(下)に敷く。光の反対側(ずらした側)の線が太く見える
        out.append(f'<g transform="translate({_num(ink[0])} {_num(ink[1])})"><{tag} {geo} fill="none" {st}/></g>')
    out.append(f'<{tag} {geo} fill="{fill}"/>')
    # 陰影(アニメ塗り): 形から、ずらした同じ形を引いた「三日月」だけを、影・ハイライトの色で塗る
    for key in ("shade", "hl"):
        e = sh.get(key)
        if not e or fill == "none":
            continue
        ctx["n"] = ctx.get("n", 0) + 1
        mid = f"m{ctx['n']}"
        c = _color(e["c"], colors, "#000")
        dx, dy = e.get("dx", 0), e.get("dy", 0)
        out.append(
            f'<mask id="{mid}" maskUnits="userSpaceOnUse" x="-100" y="-100" width="{ctx["W"] + 200}" height="{ctx["H"] + 200}">'
            f'<{tag} {geo} fill="#fff"/><g transform="translate({_num(dx)} {_num(dy)})"><{tag} {geo} fill="#000"/></g></mask>'
            f'<{tag} {geo} fill="{c}" mask="url(#{mid})"/>'
        )
    if w:
        out.append(f'<{tag} {geo} fill="none" {st}/>')
    return "".join(out)


def render_svg(design: dict, skip_parts=()) -> str:
    w, h = design["size"]
    ctx = {"colors": design.get("colors", {}), "outline": design.get("outline", "#5E4033"), "w": design.get("w", 4),
           "ink": design.get("ink"), "W": w, "H": h, "skip": set(skip_parts)}
    body = "".join(_shape(s, ctx) for s in design["shapes"])
    bg = design.get("bg", "#FFFFFF")
    rect = f'<rect width="{w}" height="{h}" fill="{bg}"/>' if bg else ""
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}">{rect}{body}</svg>'


def render_png(svg: str, width: int, height: int) -> bytes:
    return bytes(resvg_py.svg_to_bytes(svg_string=svg, width=width, height=height))


def load_design(path: str | Path) -> dict:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def write(design: dict, out_dir: str | Path, scale: float = 3.0, stem: str | None = None) -> dict:
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    stem = stem or design["name"]
    svg = render_svg(design)
    w, h = design["size"]
    (out / f"{stem}.src.svg").write_text(svg, encoding="utf-8")
    (out / f"{stem}.src.png").write_bytes(render_png(svg, round(w * scale), round(h * scale)))
    return {"svg": str(out / f"{stem}.src.svg"), "png": str(out / f"{stem}.src.png")}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="デザインデータ(JSON)から元絵を描く")
    ap.add_argument("design", help="デザインデータ(JSON)")
    ap.add_argument("-o", "--out", default="artgen_out")
    ap.add_argument("--scale", type=float, default=3.0, help="PNG の拡大倍率(既定 3)")
    a = ap.parse_args(argv)
    r = write(load_design(a.design), a.out, a.scale)
    print(r["svg"])
    print(r["png"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
