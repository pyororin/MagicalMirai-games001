"""img2vector — 画像を「べた塗り+輪郭」だけのベクター画像に模写する。

入力: 画像(PNG/JPG など)。出力: SVG(単色の塗りのパスだけ。グラデーション・フィルター・透明度は使わない)と、
その SVG を描き直した PNG、精度のレポート(JSON)。

処理の流れ:
  1. 読み込み・拡大(曲線をなめらかに取るため)。背景が単色なら透過にする(任意)
  2. なだらかな色の変化(グラデーション・アンチエイリアス)をならして、はっきりした色の面にする
  3. Lab 色空間で k-means 減色 → 近い色の統合 → 小さな島・穴の除去(ラベルの多数決)
  4. 色の面を vtracer(Rust 製)で曲線のパスにする
  5. SVG を resvg で描き直し、元画像との差(SSIM・色差)を測る
  --auto なら色数をいくつか試し、見た目が最も近く、パス数が少ない設定を選ぶ

使い方: python tools/img2vector/img2vector.py 入力.png -o 出力フォルダ [--colors 16 | --auto] [--transparent-bg]
詳しくは README.md。他の企画からも、このファイルを呼び出して使える(`trace_image()`)。
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass, field, asdict
from pathlib import Path

import cv2
import numpy as np
import resvg_py
import vtracer
from PIL import Image
from skimage.color import rgb2lab, deltaE_ciede2000
from skimage.metrics import structural_similarity

# SVG にあってはならないもの(べた塗りだけという約束)
FORBIDDEN_SVG_TAGS = ("linearGradient", "radialGradient", "filter", "opacity", "mask", "pattern", "<image")


@dataclass
class TraceOptions:
    colors: int = 16            # 減色後の色数(--auto のときは候補から選ぶ)
    upscale: float = 2.0        # 最初に拡大する倍率。大きいほど曲線が細かく取れる
    smooth: int = 2             # 色をならす強さ(0 で無し。大きいほど面がはっきりするが細部が消える)
    min_area: int = 12          # この面積(拡大後の px)より小さい島・穴は消す
    merge_delta: float = 6.0    # この色差(CIEDE2000)より近い色は1色にまとめる
    transparent_bg: bool = False  # 画像の四隅の色を背景として透過にする
    bg_tolerance: float = 12.0  # 背景とみなす色差
    crop_margin: int = 6        # 透過の余白を切り詰めるときに残す余白(px)
    sketch: float = 0.0         # 手書き風のゆらぎの大きさ(元画像 px 換算。0 で無し。1〜2 が目安)
    sketch_seed: int = 1        # ゆらぎの乱数の種(同じ種なら同じ絵)
    sketch_wave: float = 24.0   # ゆらぎの波長(元画像 px 換算。長いほどゆったり)
    misregister: float = 0.6    # 色の面ごとのずれ(版ずれ。元画像 px 換算)。sketch>0 のときだけ効く
    verify_edge_f1: float = 0.80   # 形の確認: 輪郭の一致度(F値)がこれ未満ならゆらぎを弱めて作り直す
    verify_iou: float = 0.96       # 形の確認: 透過の絵のシルエット IoU がこれ未満なら同上
    verify_rounds: int = 6         # 確認と作り直しの最大回数
    clear_at: list = field(default_factory=list)  # [[x,y],...] 元画像の座標。そこにつながる背景色の領域も透過にする(囲まれた隙間用)
    corner_threshold: int = 60  # 角とみなす角度(小さいほど角が増える)
    length_threshold: float = 3.5  # パスの最小区間長(小さいほど細かい)
    splice_threshold: int = 45
    path_precision: int = 2     # SVG の小数桁数


@dataclass
class TraceResult:
    svg: str
    png: bytes
    quantized: np.ndarray  # 減色後の画像 (H,W,3) uint8(拡大後サイズ)
    report: dict = field(default_factory=dict)


# ---------------------------------------------------------------- 読み込み

def load_rgba(path: str | Path) -> np.ndarray:
    im = Image.open(path).convert("RGBA")
    return np.array(im)


def background_mask(rgb: np.ndarray, tol: float, seeds=()) -> np.ndarray:
    """四隅の色に近く、かつ画像の縁につながっている領域を背景とする(中の白い襟などは残す)。
    seeds は、縁につながっていない背景色の隙間(腕と体のあいだなど)を指す座標 [x, y]。"""
    h, w = rgb.shape[:2]
    lab = rgb2lab(rgb)
    corners = np.array([lab[0, 0], lab[0, w - 1], lab[h - 1, 0], lab[h - 1, w - 1]])
    ref = np.median(corners, axis=0)
    dist = np.linalg.norm(lab - ref, axis=2)
    cand = (dist <= tol).astype(np.uint8)
    n, lbl = cv2.connectedComponents(cand, connectivity=4)
    edge_ids = set(np.unique(np.concatenate([lbl[0], lbl[-1], lbl[:, 0], lbl[:, -1]]))) - {0}
    for x, y in seeds:
        if lbl[int(y), int(x)] != 0:
            edge_ids.add(int(lbl[int(y), int(x)]))
        else:
            raise ValueError(f'clear_at ({x},{y}) は背景色ではない(色差が許容を超える)')
    return np.isin(lbl, list(edge_ids))


# ---------------------------------------------------------------- 減色

def flatten_colors(rgb: np.ndarray, smooth: int) -> np.ndarray:
    """エッジを保ったまま色をならす。smooth=0 なら何もしない。"""
    out = rgb
    for _ in range(smooth):
        out = cv2.bilateralFilter(out, d=7, sigmaColor=28, sigmaSpace=5)
    if smooth:
        out = cv2.pyrMeanShiftFiltering(out, sp=4, sr=14)
    return out


def kmeans_palette(rgb: np.ndarray, k: int, valid: np.ndarray | None, seed: int = 7):
    lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB).astype(np.float32)
    h, w = lab.shape[:2]
    pts = lab.reshape(-1, 3)
    sel = pts if valid is None else pts[valid.reshape(-1)]
    # 速さのために標本を間引く(乱数は固定。同じ入力は同じ結果)
    rng = np.random.default_rng(seed)
    if len(sel) > 200_000:
        sel = sel[rng.choice(len(sel), 200_000, replace=False)]
    crit = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 40, 0.5)
    cv2.setRNGSeed(seed)
    _, _, centers = cv2.kmeans(sel, k, None, crit, 3, cv2.KMEANS_PP_CENTERS)
    return centers  # (k,3) OpenCV Lab(uint8 相当の値域)


def assign_labels(rgb: np.ndarray, centers: np.ndarray) -> np.ndarray:
    lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB).astype(np.float32).reshape(-1, 3)
    d = ((lab[:, None, :] - centers[None, :, :]) ** 2).sum(axis=2)
    return d.argmin(axis=1).reshape(rgb.shape[:2]).astype(np.int32)


def centers_to_rgb(centers: np.ndarray) -> np.ndarray:
    c = np.clip(centers, 0, 255).astype(np.uint8).reshape(-1, 1, 3)
    return cv2.cvtColor(c, cv2.COLOR_LAB2RGB).reshape(-1, 3)


def merge_close(centers: np.ndarray, labels: np.ndarray, delta: float):
    """近い色(CIEDE2000)を1色にまとめる。使われていない色も落とす。"""
    rgb = centers_to_rgb(centers)
    lab = rgb2lab(rgb.reshape(-1, 1, 3) / 255.0).reshape(-1, 3)
    counts = np.bincount(labels.reshape(-1), minlength=len(centers))
    parent = list(range(len(centers)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    order = np.argsort(-counts)  # 面積の大きい色を代表にする
    for a_i, a in enumerate(order):
        for b in order[a_i + 1:]:
            if counts[b] == 0 or counts[a] == 0:
                continue
            if deltaE_ciede2000(lab[a:a + 1], lab[b:b + 1])[0] < delta:
                ra, rb = find(a), find(b)
                if ra != rb:
                    parent[rb] = ra
    roots = sorted({find(i) for i in range(len(centers)) if counts[i] > 0})
    remap = {r: n for n, r in enumerate(roots)}
    lut = np.array([remap[find(i)] if counts[i] > 0 else 0 for i in range(len(centers))])
    # 統合後の色は、統合された面積で重みづけした平均
    new_rgb = []
    for r in roots:
        members = [i for i in range(len(centers)) if counts[i] > 0 and find(i) == r]
        w = counts[members].astype(float)
        new_rgb.append((rgb[members] * w[:, None]).sum(axis=0) / w.sum())
    return lut[labels], np.round(np.array(new_rgb)).astype(np.uint8)


def clean_labels(labels: np.ndarray, valid: np.ndarray | None, min_area: int) -> np.ndarray:
    """小さな島・穴を、まわりで最も多いラベルに置き換える(多数決を繰り返す)。"""
    lab = labels.copy()
    n_colors = int(lab.max()) + 1
    for _ in range(4):
        changed = False
        for c in range(n_colors):
            mask = (lab == c).astype(np.uint8)
            n, cc, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=4)
            small = [i for i in range(1, n) if stats[i, cv2.CC_STAT_AREA] < min_area]
            for i in small:
                comp = (cc == i).astype(np.uint8)
                ring = cv2.dilate(comp, np.ones((3, 3), np.uint8)) - comp
                neigh = lab[ring.astype(bool)]
                neigh = neigh[neigh != c]
                if neigh.size:
                    lab[comp.astype(bool)] = np.bincount(neigh).argmax()
                    changed = True
        if not changed:
            break
    return lab


# ---------------------------------------------------------------- ベクター化・採点

def vectorize(rgb: np.ndarray, alpha: np.ndarray | None, o: TraceOptions) -> str:
    h, w = rgb.shape[:2]
    rgba = np.dstack([rgb, np.full((h, w), 255, np.uint8) if alpha is None else alpha])
    pixels = [tuple(int(v) for v in p) for p in rgba.reshape(-1, 4)]
    return vtracer.convert_pixels_to_svg(
        pixels, (w, h),
        colormode="color", hierarchical="stacked", mode="spline",
        filter_speckle=0, color_precision=8, layer_difference=1,
        corner_threshold=o.corner_threshold, length_threshold=o.length_threshold,
        max_iterations=10, splice_threshold=o.splice_threshold, path_precision=o.path_precision,
    )


def fit_svg_to_size(svg: str, src_w: int, src_h: int, work_w: int, work_h: int) -> str:
    """作業サイズ(拡大後)の SVG を、元画像のサイズで見えるようにする(viewBox は作業サイズのまま)。"""
    svg = re.sub(r'width="\d+"', f'width="{src_w}"', svg, count=1)
    svg = re.sub(r'height="\d+"', f'height="{src_h}"', svg, count=1)
    return svg.replace("<svg ", f'<svg viewBox="0 0 {work_w} {work_h}" ', 1)


def assert_flat(svg: str) -> None:
    bad = [t for t in FORBIDDEN_SVG_TAGS if t in svg]
    if bad:
        raise ValueError(f"SVG にべた塗り以外の表現が含まれている: {bad}")


def render_png(svg: str, width: int, height: int) -> bytes:
    return bytes(resvg_py.svg_to_bytes(svg_string=svg, width=width, height=height))


def score(original_rgb: np.ndarray, original_alpha: np.ndarray | None, rendered_png: bytes) -> dict:
    """元画像と、描き直した画像の近さ。透過部分は白の上に置いて比べる。"""
    h, w = original_rgb.shape[:2]
    out = np.array(Image.open(__import__("io").BytesIO(rendered_png)).convert("RGBA")).astype(float)
    if out.shape[:2] != (h, w):
        out = np.array(Image.fromarray(out.astype(np.uint8)).resize((w, h), Image.LANCZOS)).astype(float)

    def over_white(rgb, a):
        a = a[..., None] / 255.0
        return (rgb * a + 255 * (1 - a)).astype(np.uint8)

    a0 = np.full((h, w), 255.0) if original_alpha is None else original_alpha.astype(float)
    ref = over_white(original_rgb.astype(float), a0)
    got = over_white(out[..., :3], out[..., 3])
    ssim = float(structural_similarity(ref, got, channel_axis=2, data_range=255))
    de = deltaE_ciede2000(rgb2lab(ref / 255.0), rgb2lab(got / 255.0))
    return {"ssim": round(ssim, 4), "delta_e_mean": round(float(de.mean()), 3),
            "delta_e_p95": round(float(np.percentile(de, 95)), 3)}


def warp_y(rgba: np.ndarray, pairs) -> np.ndarray:
    """縦方向だけを区分線形に伸び縮みさせる。pairs = [(元の高さ比, 変換後の高さ比), ...](0〜1)。
    端点(0→0, 1→1)は自動で足す。例: 球場のホームの位置を 0.59 → 0.70 に動かす。"""
    h, w = rgba.shape[:2]
    pts = sorted({(0.0, 0.0), (1.0, 1.0), *[(float(a), float(b)) for a, b in pairs]})
    src = np.array([p[0] for p in pts]) * (h - 1)
    dst = np.array([p[1] for p in pts]) * (h - 1)
    if np.any(np.diff(dst) <= 0) or np.any(np.diff(src) <= 0):
        raise ValueError("warp_y の指定は、元・変換後とも増加する並びにする")
    ys = np.interp(np.arange(h), dst, src).astype(np.float32)  # 変換後の行 → 元の行
    map_y = np.repeat(ys[:, None], w, axis=1)
    map_x = np.repeat(np.arange(w, dtype=np.float32)[None, :], h, axis=0)
    return cv2.remap(rgba, map_x, map_y, cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)


# ---------------------------------------------------------------- 手書き風・形の確認

_TOKEN = re.compile(r"[MCLZ]|-?\d+(?:\.\d+)?(?:e-?\d+)?")
_ARGS = {"M": 1, "L": 1, "C": 3, "Z": 0}
_PATH = re.compile(r'<path d="([^"]*)" fill="(#[0-9A-Fa-f]{6})" transform="translate\((-?[\d.]+),(-?[\d.]+)\)"\s*/>')


def _noise_field(h: int, w: int, wave: float, seed: int) -> np.ndarray:
    """なめらかな乱数の場 (h,w) 値域およそ -1..1。波長 wave px。"""
    rng = np.random.default_rng(seed)
    gh, gw = max(2, int(np.ceil(h / wave)) + 3), max(2, int(np.ceil(w / wave)) + 3)
    g = rng.uniform(-1, 1, (gh, gw)).astype(np.float32)
    f = cv2.resize(g, (gw * 8, gh * 8), interpolation=cv2.INTER_CUBIC)  # 8 倍で補間
    return f  # 1 マス = wave/8 px。参照時は座標 / (wave/8)


def _sample(field: np.ndarray, xs: np.ndarray, ys: np.ndarray, wave: float) -> np.ndarray:
    k = 8.0 / wave
    fx = np.clip(xs * k, 0, field.shape[1] - 1.001)
    fy = np.clip(ys * k, 0, field.shape[0] - 1.001)
    x0, y0 = fx.astype(int), fy.astype(int)
    tx, ty = fx - x0, fy - y0
    a = field[y0, x0] * (1 - tx) + field[y0, x0 + 1] * tx
    b = field[y0 + 1, x0] * (1 - tx) + field[y0 + 1, x0 + 1] * tx
    return a * (1 - ty) + b * ty


def sketchify_svg(svg: str, width: float, height: float, amp: float, wave: float,
                  misregister: float, seed: int) -> str:
    """SVG の全パスの点を、なめらかな乱数で少しずらして、手書きのゆらぎを出す。
    ・全体のうねり(波長 wave、大きさ amp) と、ペンの細かい震え(波長 wave/4、大きさ amp*0.3)
    ・色ごとの版ずれ(色の面を、色ごとに決まった向きへ misregister px だけずらす)
    座標は作業サイズ(viewBox)の px。同じ種なら同じ結果。"""
    big = _noise_field(int(height), int(width), wave, seed)
    big2 = _noise_field(int(height), int(width), max(wave / 4, 2.0), seed + 101)
    big3 = _noise_field(int(height), int(width), wave, seed + 202)
    big4 = _noise_field(int(height), int(width), max(wave / 4, 2.0), seed + 303)

    def shift_for(color: str):
        r = np.random.default_rng(int(color[1:], 16) + seed * 7919)
        a = r.uniform(0, 2 * np.pi)
        return misregister * np.cos(a), misregister * np.sin(a)

    def repl(m):
        d, color, tx, ty = m.group(1), m.group(2), float(m.group(3)), float(m.group(4))
        toks = _TOKEN.findall(d)
        if not toks:
            return m.group(0)
        nums = np.array([float(t) for t in toks if t not in _ARGS], dtype=np.float64).reshape(-1, 2)
        xs, ys = nums[:, 0] + tx, nums[:, 1] + ty
        dx = amp * _sample(big, xs, ys, wave) + amp * 0.3 * _sample(big2, xs, ys, max(wave / 4, 2.0))
        dy = amp * _sample(big3, xs, ys, wave) + amp * 0.3 * _sample(big4, xs, ys, max(wave / 4, 2.0))
        mx, my = shift_for(color)
        xs, ys = xs + dx + mx, ys + dy + my
        # 再構成: コマンドごとに引数ぶんの点を並べる
        parts, i = [], 0
        for t in toks:
            if t in _ARGS:
                parts.append(t)
                for _ in range(_ARGS[t]):
                    parts.append(f"{xs[i]:.1f} {ys[i]:.1f}")
                    i += 1
        return f'<path d="{" ".join(parts)}" fill="{color}"/>'

    return _PATH.sub(repl, svg)


def _composite_white(rgb: np.ndarray, a: np.ndarray) -> np.ndarray:
    al = (a.astype(np.float32) / 255.0)[..., None]
    return (rgb.astype(np.float32) * al + 255 * (1 - al)).astype(np.uint8)


def _edges(rgb: np.ndarray) -> np.ndarray:
    g = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    g = cv2.GaussianBlur(g, (0, 0), 1.0)
    return cv2.Canny(g, 40, 110) > 0


def shape_similarity(ref_rgb: np.ndarray, ref_a: np.ndarray | None, got_rgb: np.ndarray,
                     got_a: np.ndarray | None, tol: int = 3) -> dict:
    """「似た形か」の測定。
    edge_f1 … 輪郭線(Canny)が、許容 tol px 以内で重なる割合の F 値(1 で完全一致)
    chamfer … 元の輪郭から、写しの輪郭までの平均距離(px)。小さいほど近い
    iou … 透過の絵のシルエット(不透明部分)の IoU。透過が無ければ None"""
    a_ref = np.full(ref_rgb.shape[:2], 255, np.uint8) if ref_a is None else ref_a
    a_got = np.full(got_rgb.shape[:2], 255, np.uint8) if got_a is None else got_a
    e1 = _edges(_composite_white(ref_rgb, a_ref))
    e2 = _edges(_composite_white(got_rgb, a_got))
    if not e1.any() or not e2.any():
        return {"edge_f1": 0.0, "chamfer": 99.0, "iou": None}
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * tol + 1, 2 * tol + 1))
    d1, d2 = cv2.dilate(e1.astype(np.uint8), k) > 0, cv2.dilate(e2.astype(np.uint8), k) > 0
    recall = float((e1 & d2).sum() / e1.sum())
    precision = float((e2 & d1).sum() / e2.sum())
    f1 = 0.0 if recall + precision == 0 else 2 * recall * precision / (recall + precision)
    dist = cv2.distanceTransform((~e2).astype(np.uint8), cv2.DIST_L2, 3)
    chamfer = float(dist[e1].mean())
    iou = None
    if ref_a is not None and got_a is not None:
        m1, m2 = ref_a > 127, got_a > 127
        iou = float((m1 & m2).sum() / max(1, (m1 | m2).sum()))
    return {"edge_f1": round(f1, 4), "chamfer": round(chamfer, 3), "iou": None if iou is None else round(iou, 4)}


def flip_x(rgba: np.ndarray) -> np.ndarray:
    """左右反転(打者を右打ちにするなど)。"""
    return np.ascontiguousarray(rgba[:, ::-1])


def inpaint_red(rgba: np.ndarray, box) -> np.ndarray:
    """box=(x0,y0,x1,y1) の中の赤い文字・印(反転すると読めなくなる数字など)を、まわりの色で塗りつぶして消す。"""
    x0, y0, x1, y1 = [int(v) for v in box]
    out = rgba.copy()
    rgb = out[..., :3]
    sub = rgb[y0:y1, x0:x1].astype(int)
    red = (sub[..., 0] > 140) & (sub[..., 0] - sub[..., 1] > 55) & (sub[..., 0] - sub[..., 2] > 35)
    mask = np.zeros(rgb.shape[:2], np.uint8)
    mask[y0:y1, x0:x1] = red.astype(np.uint8) * 255
    mask = cv2.dilate(mask, np.ones((5, 5), np.uint8))
    out[..., :3] = cv2.inpaint(np.ascontiguousarray(rgb), mask, 4, cv2.INPAINT_TELEA)
    return out


# ---------------------------------------------------------------- 本体

def _decode_png(png: bytes):
    im = np.array(Image.open(__import__("io").BytesIO(png)).convert("RGBA"))
    return im[..., :3], im[..., 3]


def _for_check(rgb, a, limit=640):
    """形の確認は、実際に見る大きさ(長辺 limit px 程度)に縮めてから行う。ゆらぎが画面で目立つ大きさかどうかが問題だから。"""
    h, w = rgb.shape[:2]
    k = min(1.0, limit / max(h, w))
    if k >= 1.0:
        return rgb, a
    size = (max(1, round(w * k)), max(1, round(h * k)))
    return (cv2.resize(rgb, size, interpolation=cv2.INTER_AREA),
            None if a is None else cv2.resize(a, size, interpolation=cv2.INTER_AREA))


def fidelity(rgb0, a0, png: bytes) -> dict:
    """元絵に対する再現度。表示サイズ(長辺 640px 程度)に縮めて、見た目の近さ(SSIM)・色差(ΔE 平均)・輪郭一致・シルエット IoU を測る。"""
    g_rgb, g_a = _decode_png(png)
    ref_rgb, ref_a = _for_check(rgb0, a0)
    r2, a2 = _for_check(g_rgb, g_a if a0 is not None else None)
    h, w = ref_rgb.shape[:2]
    if r2.shape[:2] != (h, w):
        r2 = cv2.resize(r2, (w, h), interpolation=cv2.INTER_AREA)
        a2 = None if a2 is None else cv2.resize(a2, (w, h), interpolation=cv2.INTER_AREA)
    one = np.full((h, w), 255, np.uint8)
    a_ref = one if ref_a is None else ref_a
    a_got = one if a2 is None else a2
    A = _composite_white(ref_rgb, a_ref)
    B = _composite_white(r2, a_got)
    ssim = float(structural_similarity(A, B, channel_axis=2, data_range=255))
    de = float(deltaE_ciede2000(rgb2lab(A / 255.0), rgb2lab(B / 255.0)).mean())
    sim = shape_similarity(ref_rgb, ref_a, r2, a2)
    return {"ssim": round(ssim, 4), "delta_e": round(de, 3), "edge_f1": sim["edge_f1"], "iou": sim["iou"]}


def _sketch_with_verification(base_svg, rgb0, a0, src_w, src_h, work_w, work_h, o: TraceOptions) -> dict:
    """ゆらぎを足す → 形の類似度を測る → 基準に届かなければゆらぎを 0.7 倍にして繰り返す。"""
    up = work_w / src_w
    amp = o.sketch
    ref_png = render_png(base_svg, src_w, src_h)
    g_rgb, g_a = _decode_png(ref_png)
    ref_rgb, ref_a = _for_check(rgb0, a0)
    def sim_of(rgb, a):
        r2, a2 = _for_check(rgb, a if a0 is not None else None)
        return shape_similarity(ref_rgb, ref_a, r2, a2)
    base = sim_of(g_rgb, g_a)
    log = []
    for r in range(max(1, o.verify_rounds)):
        svg = sketchify_svg(base_svg, work_w, work_h, amp * up, o.sketch_wave * up, o.misregister * up * (amp / o.sketch), o.sketch_seed)
        png = render_png(svg, src_w, src_h)
        g_rgb, g_a = _decode_png(png)
        sim = sim_of(g_rgb, g_a)
        ok = sim["edge_f1"] >= o.verify_edge_f1 and (sim["iou"] is None or sim["iou"] >= o.verify_iou)
        log.append({"round": r + 1, "amp": round(amp, 3), **sim, "ok": ok})
        if ok:
            break
        amp *= 0.7
    return {"svg": svg, "png": png, "passed": ok, "amp_used": round(amp, 3), "plain": base, "rounds": log}


def trace_image(rgba: np.ndarray, opts: TraceOptions | None = None) -> TraceResult:
    """RGBA 画像(H,W,4 uint8)を模写して TraceResult を返す。"""
    o = opts or TraceOptions()
    src_h, src_w = rgba.shape[:2]
    rgb0, a0 = rgba[..., :3].copy(), rgba[..., 3].copy()
    if o.transparent_bg:
        bg = background_mask(rgb0, o.bg_tolerance, o.clear_at)
        a0 = np.where(bg, 0, a0).astype(np.uint8)
    has_alpha = bool((a0 < 255).any())
    crop = None
    if has_alpha:  # 透過した余白を切り詰める(処理が軽くなり、足元が画像の下端になる)
        ys, xs = np.where(a0 > 0)
        if len(ys):
            m = o.crop_margin
            x0, x1 = max(xs.min() - m, 0), min(xs.max() + 1 + m, src_w)
            y0, y1 = max(ys.min() - m, 0), min(ys.max() + 1 + m, src_h)
            rgb0, a0 = rgb0[y0:y1, x0:x1], a0[y0:y1, x0:x1]
            crop = [int(x0), int(y0), int(x1), int(y1)]
            src_h, src_w = rgb0.shape[:2]

    work_w, work_h = int(round(src_w * o.upscale)), int(round(src_h * o.upscale))
    rgb = cv2.resize(rgb0, (work_w, work_h), interpolation=cv2.INTER_LANCZOS4)
    alpha = cv2.resize(a0, (work_w, work_h), interpolation=cv2.INTER_NEAREST) if has_alpha else None
    # 透過部分の色が輪郭に混ざらないよう、背景は隣の色で埋める代わりに有効画素だけで色を求める
    valid = None if alpha is None else alpha > 127

    flat = flatten_colors(rgb, o.smooth)
    centers = kmeans_palette(flat, o.colors, valid)
    labels = assign_labels(flat, centers)
    labels, palette = merge_close(centers, labels, o.merge_delta)
    labels = clean_labels(labels, valid, o.min_area)
    quant = palette[labels]
    if alpha is not None:
        alpha = np.where(valid, 255, 0).astype(np.uint8)

    base_svg = vectorize(quant, alpha, o)
    base_svg = fit_svg_to_size(base_svg, src_w, src_h, work_w, work_h)
    assert_flat(base_svg)
    svg, png = base_svg, render_png(base_svg, src_w, src_h)
    verify = None
    if o.sketch > 0:
        # 手書き風のゆらぎを足し、元と「似た形か」を測る。足りなければゆらぎを弱めて作り直す(最大 verify_rounds 回)
        verify = _sketch_with_verification(base_svg, rgb0, a0 if has_alpha else None, src_w, src_h, work_w, work_h, o)
        svg, png = verify.pop("svg"), verify.pop("png")
        assert_flat(svg)
    rep = score(rgb0, a0 if has_alpha else None, png)
    rep["fidelity"] = fidelity(rgb0, a0 if has_alpha else None, png)
    rep.update({"colors_requested": o.colors, "colors_used": int(len(palette)),
                "paths": svg.count("<path"), "svg_bytes": len(svg.encode()),
                "palette": ["#%02x%02x%02x" % tuple(c) for c in palette],
                "size": [src_w, src_h], "crop": crop, "verify": verify, "options": asdict(o)})
    return TraceResult(svg=svg, png=png, quantized=quant, report=rep)


def trace_auto(rgba: np.ndarray, base: TraceOptions | None = None,
               candidates=(8, 12, 16, 24, 32, 48), tolerance: float = 0.004) -> TraceResult:
    """色数を変えて試し、最高の SSIM から tolerance 以内で、パス数が最も少ないものを選ぶ。"""
    base = base or TraceOptions()
    runs = []
    for k in candidates:
        o = TraceOptions(**{**asdict(base), "colors": k})
        runs.append(trace_image(rgba, o))
    best = max(r.report["ssim"] for r in runs)
    ok = [r for r in runs if r.report["ssim"] >= best - tolerance]
    chosen = min(ok, key=lambda r: r.report["paths"])
    chosen.report["auto"] = [{"colors": r.report["colors_requested"], "ssim": r.report["ssim"],
                               "paths": r.report["paths"]} for r in runs]
    return chosen


def write_outputs(res: TraceResult, out_dir: str | Path, stem: str, png_height: int | None = None) -> dict:
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    (out / f"{stem}.svg").write_text(res.svg, encoding="utf-8")
    png = res.png
    if png_height:  # ベクターなので、好きな大きさで描き直せる(ゲーム用の素材サイズなど)
        w0, h0 = res.report["size"]
        png = render_png(res.svg, max(1, round(w0 * png_height / h0)), png_height)
    (out / f"{stem}.png").write_bytes(png)
    Image.fromarray(res.quantized).save(out / f"{stem}.quantized.png")
    (out / f"{stem}.report.json").write_text(json.dumps(res.report, ensure_ascii=False, indent=2), encoding="utf-8")
    return {k: str(out / f"{stem}{s}") for k, s in
            {"svg": ".svg", "png": ".png", "report": ".report.json"}.items()}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="画像をべた塗りのベクター画像(SVG)に模写する")
    ap.add_argument("input", help="入力画像")
    ap.add_argument("-o", "--out", default="img2vector_out", help="出力フォルダ")
    ap.add_argument("--stem", help="出力ファイル名(拡張子なし)。省略時は入力名")
    ap.add_argument("--colors", type=int, default=16, help="減色後の色数")
    ap.add_argument("--auto", action="store_true", help="色数を自動で選ぶ(8〜48を試す)")
    ap.add_argument("--upscale", type=float, default=2.0)
    ap.add_argument("--smooth", type=int, default=2)
    ap.add_argument("--min-area", type=int, default=12)
    ap.add_argument("--merge-delta", type=float, default=6.0)
    ap.add_argument("--transparent-bg", action="store_true", help="四隅の色の背景を透過にする")
    ap.add_argument("--bg-tolerance", type=float, default=12.0)
    ap.add_argument("--corner", type=int, default=60)
    ap.add_argument("--length", type=float, default=3.5)
    ap.add_argument("--png-height", type=int, help="PNG の高さ(px)。SVG から描き直す。省略時は入力と同じ大きさ")
    ap.add_argument("--warp-y", help="縦の補正。'元:後,元:後' (高さの比 0〜1)。例 0.42:0.40,0.59:0.70")
    ap.add_argument("--sketch", type=float, default=0.0, help="手書き風のゆらぎの大きさ(元画像 px 換算)。1〜2 が目安。0 で無し")
    ap.add_argument("--sketch-seed", type=int, default=1)
    ap.add_argument("--sketch-wave", type=float, default=24.0, help="ゆらぎの波長(px)")
    ap.add_argument("--misregister", type=float, default=0.6, help="色の面ごとの版ずれ(px)")
    ap.add_argument("--verify-edge-f1", type=float, default=0.80, help="形の確認: 輪郭の一致度の下限。届かなければゆらぎを弱めて作り直す")
    ap.add_argument("--verify-iou", type=float, default=0.96, help="形の確認: 透過の絵のシルエット IoU の下限")
    ap.add_argument("--flip-x", action="store_true", help="先に左右反転する(右打ちにするなど)")
    ap.add_argument("--inpaint-red", help="x0,y0,x1,y1 反転後の座標。その中の赤い文字・印を消す(反転で読めなくなる数字など)")
    ap.add_argument("--clear-at", help="囲まれた背景色の隙間を透過にする座標。'x,y;x,y' (元画像の座標)")
    a = ap.parse_args(argv)

    o = TraceOptions(colors=a.colors, upscale=a.upscale, smooth=a.smooth, min_area=a.min_area,
                     merge_delta=a.merge_delta, transparent_bg=a.transparent_bg,
                     bg_tolerance=a.bg_tolerance, corner_threshold=a.corner, length_threshold=a.length,
                     clear_at=[[int(v) for v in p.split(",")] for p in a.clear_at.split(";")] if a.clear_at else [],
                     sketch=a.sketch, sketch_seed=a.sketch_seed, sketch_wave=a.sketch_wave, misregister=a.misregister,
                     verify_edge_f1=a.verify_edge_f1, verify_iou=a.verify_iou)
    rgba = load_rgba(a.input)
    if a.flip_x:
        rgba = flip_x(rgba)
    if a.inpaint_red:
        rgba = inpaint_red(rgba, a.inpaint_red.split(","))
    if a.warp_y:
        rgba = warp_y(rgba, [tuple(float(v) for v in p.split(":")) for p in a.warp_y.split(",")])
    res = trace_auto(rgba, o) if a.auto else trace_image(rgba, o)
    paths = write_outputs(res, a.out, a.stem or Path(a.input).stem, a.png_height)
    r = res.report
    print(f"SSIM {r['ssim']}  色差 平均 {r['delta_e_mean']} / 95% {r['delta_e_p95']}  "
          f"色 {r['colors_used']}  パス {r['paths']}  SVG {r['svg_bytes'] // 1024}KB")
    if r.get("verify"):
        for v in r["verify"]["rounds"]:
            print(f"  形の確認 {v['round']}回目: ゆらぎ {v['amp']}px  輪郭一致 {v['edge_f1']}  輪郭のずれ {v['chamfer']}px  シルエット {v['iou']}  {'合格' if v['ok'] else '不合格→弱める'}")
        print(f"  素の模写: 輪郭一致 {r['verify']['plain']['edge_f1']}  輪郭のずれ {r['verify']['plain']['chamfer']}px")
    for k, v in paths.items():
        print(f"  {k}: {v}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
