"""miku-butter-paradox: バター猫のパラドックス × ねこみみミク の回転 GIF/APNG ジェネレータ。

横向きの全身図で、頭〜尻尾の体軸まわりにロールし続ける（着地できない）アニメーション。
トースト・足・尻尾・頭部の各パーツは擬似 3D（断面座標の回転）で配置し、
顔は球面上の点として首振り(ヨー)+ロールで変換している。

使い方:
    python generate.py                 # 透過版 (GIF + APNG) を output/ に出力
    python generate.py --with-bg       # 背景・効果線・字幕付き版も出力
    python generate.py --keyframes     # 確認用に 0/90/180/270 度の静止 PNG も出力
依存: Pillow (requirements.txt)
"""
import argparse
import os
import math
from PIL import Image, ImageDraw, ImageFont

SS = 2
W = H = 480
FRAMES = 36
DUR = 45
K = 0.78                 # global scale of local units

TEAL = (57, 197, 187)
TEAL_D = (30, 150, 142)
TEAL_L = (140, 230, 224)
PINK = (231, 84, 128)
RED = (215, 60, 80)
OUT = (50, 50, 60)
FUR = (245, 245, 247)
GREY = (90, 92, 100)
SHIRT = (200, 202, 210)
BLACK = (40, 40, 48)
SKIN = (255, 228, 212)
SKIN_S = (240, 195, 180)
CRUST = (198, 134, 66)
CRUST_D = (160, 100, 45)
BREAD = (245, 220, 165)
BUTTER = (255, 217, 59)
BUTTER_L = (255, 240, 150)
BUTTER_D = (225, 175, 30)
TEAL_S = (24, 135, 130)
SHIRT_D = (150, 152, 168)
SHIRT_L = (238, 239, 245)
FUR_S = (205, 205, 218)
BLACK_L = (85, 85, 105)
SKIN_SH = (238, 196, 180)
BREAD_D = (222, 190, 135)
IRIS_D = (22, 110, 110)
WHITE = (255, 255, 255)
FONT_CANDIDATES = [
    "/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc",          # macOS
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",       # Linux (fonts-noto-cjk)
    "/usr/share/fonts/truetype/noto/NotoSansCJK-Bold.ttc",
    "C:/Windows/Fonts/meiryob.ttc",                              # Windows
]


def load_fonts():
    """caption fonts (background version only); falls back to Pillow's default."""
    for path in FONT_CANDIDATES:
        if os.path.exists(path):
            return (ImageFont.truetype(path, int(s(20))), ImageFont.truetype(path, int(s(14))),
                    ImageFont.truetype(path, int(s(30))))
    f = ImageFont.load_default()
    return f, f, f

# scene geometry (local units, body center = origin, +x toward head, +y down)
R = 50            # body radius
BODY_X0, BODY_X1 = -130, 90
HEAD_X, HEAD_R = 125, 56
TOAST_X0, TOAST_X1 = -108, 6
TOAST_W, TOAST_T, BUTTER_T = 116, 22, 9
LEG_L = 58

CX, CY = 240, 222   # screen center of body


def s(v):
    return v * SS


class Ctx:
    """Local -> screen mapping with an offset (for the body position)."""
    def __init__(self, d, ox=0, oy=0):
        self.d, self.ox, self.oy = d, ox, oy

    def P(self, x, y):
        return ((x * K + self.ox) * SS, (y * K + self.oy) * SS)

    def ell(self, cx, cy, rx, ry, fill, outline=OUT, width=4):
        self.d.ellipse([self.P(cx - rx, cy - ry), self.P(cx + rx, cy + ry)], fill=fill,
                       outline=outline, width=int(s(width)) if outline else 0)

    def rrect(self, x0, y0, x1, y1, r, fill, outline=OUT, width=4):
        self.d.rounded_rectangle([self.P(x0, y0), self.P(x1, y1)], radius=s(r * K), fill=fill,
                                 outline=outline, width=int(s(width)) if outline else 0)

    def poly(self, pts, fill, outline=OUT, width=4):
        self.d.polygon([self.P(*p) for p in pts], fill=fill, outline=outline,
                       width=int(s(width)) if outline else 0)

    def line(self, pts, fill, width):
        self.d.line([self.P(*p) for p in pts], fill=fill, width=int(s(width * K)), joint="curve")

    def arc(self, x0, y0, x1, y1, a0, a1, fill, width):
        self.d.arc([self.P(x0, y0), self.P(x1, y1)], start=a0, end=a1, fill=fill, width=int(s(width * K)))


def bezier(p0, p1, p2, p3, n=40):
    pts = []
    for i in range(n + 1):
        t = i / n
        u = 1 - t
        pts.append((u**3 * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t**3 * p3[0],
                    u**3 * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t**3 * p3[1]))
    return pts


def ribbon(c, pts, w0, w1, fill, outline=None):
    left, right = [], []
    n = len(pts)
    for i, (x, y) in enumerate(pts):
        if i < n - 1:
            dx, dy = pts[i + 1][0] - x, pts[i + 1][1] - y
        else:
            dx, dy = x - pts[i - 1][0], y - pts[i - 1][1]
        L = math.hypot(dx, dy) or 1
        nx, ny = -dy / L, dx / L
        w = w0 + (w1 - w0) * (i / (n - 1))
        left.append((x + nx * w / 2, y + ny * w / 2))
        right.append((x - nx * w / 2, y - ny * w / 2))
    c.poly(left + right[::-1], fill, outline=outline, width=4 if outline else 0)


def shift(pts, dx, dy):
    return [(x + dx, y + dy) for x, y in pts]


def cel_ribbon(c, pts, w0, w1, dark, light, hi=None):
    """anime cel shading: dark full shape + lighter shape offset toward the light (top-left)."""
    ribbon(c, pts, w0, w1, dark, OUT)
    ribbon(c, shift(pts, -3, -4), w0 * 0.8, w1 * 0.6, light)
    if hi:
        ribbon(c, shift(pts[4:-4], -6, -8), w0 * 0.22, 2, hi)


def star(c, x, y, r, fill=WHITE):
    pts = []
    for k in range(8):
        a = math.pi / 4 * k
        rr = r if k % 2 == 0 else r * 0.35
        pts.append((x + rr * math.cos(a), y + rr * math.sin(a)))
    c.poly(pts, fill, outline=TEAL_D, width=2)


# ---------------------------------------------------------------- head (pseudo-3D sphere)
HR = HEAD_R


PSI = math.radians(25)   # head yaw: face turned partly toward the direction of travel (+x)


def sph(fx, fy, rad=HR):
    """frontal-face coords -> 3D point on/at the head sphere (z toward viewer)."""
    z2 = rad * rad - fx * fx - fy * fy
    return fx, fy, math.sqrt(z2) if z2 > 0 else 0.0


def yaw(p):
    fx, fy, fz = p
    return fx * math.cos(PSI) + fz * math.sin(PSI), fy, -fx * math.sin(PSI) + fz * math.cos(PSI)


def roll(p, theta):
    """rotate about the body (x) axis, same sense as the toast: top -> viewer -> bottom."""
    fx, fy, fz = p
    y = fy * math.cos(theta) + fz * math.sin(theta)
    z = -fy * math.sin(theta) + fz * math.cos(theta)
    return fx, y, z


def T(fx, fy, theta, rad=HR):
    x, y, z = roll(yaw(sph(fx, fy, rad)), theta)
    if rad == HR and z < 0:            # surface point on the far side: clamp to the silhouette
        r = math.hypot(x, y)
        if r > 0:
            x, y = x * HR / r, y * HR / r
    return (HEAD_X + x, y), z


def ellipse_pts(cx, cy, rx, ry, n=28):
    return [(cx + rx * math.cos(2 * math.pi * k / n), cy + ry * math.sin(2 * math.pi * k / n)) for k in range(n)]


def tpoly(c, pts, theta, fill, outline=OUT, width=3, rad=HR):
    c.poly([T(x, y, theta, rad)[0] for x, y in pts], fill, outline=outline, width=width)


def center_z(pts, theta, rad=HR):
    cx = sum(p[0] for p in pts) / len(pts)
    cy = sum(p[1] for p in pts) / len(pts)
    return T(cx, cy, theta, rad)[1]


BANG = [(-58, -35), (-63, 8), (-52, 22), (-44, 0), (-33, 24), (-24, -2), (-14, 20), (-6, -4), (2, 18),
        (10, -6), (18, 22), (27, -2), (37, 24), (45, 2), (54, 18), (62, -35)]
EARS = [[(sgn * 20, -50), (sgn * 44, -100), (sgn * 54, -44)] for sgn in (-1, 1)]
EARS_IN = [[(sgn * 27, -54), (sgn * 42, -86), (sgn * 49, -50)] for sgn in (-1, 1)]


def T3(p, theta):
    x, y, z = roll(yaw(p), theta)
    return (HEAD_X + x, y), z


def bezier3(p0, p1, p2, p3, n=40):
    out = []
    for i in range(n + 1):
        t = i / n
        u = 1 - t
        out.append(tuple(u**3 * p0[k] + 3 * u * u * t * p1[k] + 3 * u * t * t * p2[k] + t**3 * p3[k] for k in range(3)))
    return out


def draw_twin_tails(c, theta, wob, front=None):
    """front=None: both; True/False: only the tails whose mid-section is on that side of the body."""
    for sgn in (-1, 1):
        curve = bezier3((sgn * 50, -28, 18), (sgn * 120, 10 + wob, 40), (sgn * 95, 120 - wob, 30),
                        (sgn * 135, 195 + wob * sgn, 0))
        proj_pts = [T3(p, theta) for p in curve]
        depth = sum(z for _, z in proj_pts[8:28]) / 20
        if front is not None and (depth >= 0) != front:
            continue
        pts = [p for p, _ in proj_pts]
        # split, pointed tip: two spikes diverging from near the end
        (x0, y0), (x1, y1) = pts[-6], pts[-1]
        dx, dy = x1 - x0, y1 - y0
        L = math.hypot(dx, dy) or 1
        nx, ny = -dy / L, dx / L
        spike = pts[-6:-1] + [(x1 + nx * 22 + dx * 0.3, y1 + ny * 22 + dy * 0.3)]
        ribbon(c, spike, 14, 1, TEAL_S, OUT)
        cel_ribbon(c, pts, 40, 3, TEAL_S, TEAL, TEAL_L)


def draw_head(c, theta, wob):
    band = [(-62 * math.cos(a), -62 * math.sin(a)) for a in [math.radians(k) for k in range(10, 171, 8)]]
    band_t = [(T(x, y, theta, 62)) for x, y in band]

    def features(front):
        # headphone band segments
        for (p0, z0), (p1, z1) in zip(band_t, band_t[1:]):
            if ((z0 + z1) / 2 >= 0) == front:
                c.line([p0, p1], BLACK, 9)
        top_front = roll(yaw((0, -HR, 0)), theta)[2] >= 0
        for ear, inner in zip(EARS, EARS_IN):
            if top_front == front:
                tpoly(c, ear, theta, TEAL)
                tpoly(c, inner, theta, (250, 190, 200), outline=None)
        for sgn in (-1, 1):   # hair ties at twin-tail roots
            pts = ellipse_pts(sgn * 50, -28, 8, 8, 12)
            if (center_z(pts, theta) >= 0) == front:
                tpoly(c, pts, theta, RED, width=2)

    features(False)
    # head sphere: hair everywhere, cel shadow on the lower part, angel-ring highlight
    c.ell(HEAD_X, 0, HR, HR, TEAL)
    c.d.chord([c.P(HEAD_X - HR, -HR), c.P(HEAD_X + HR, HR)], start=28, end=152, fill=TEAL_S)
    if roll(yaw((0, -HR, 0)), theta)[2] > -10:
        ring = [(fx, -47 + 3 * math.sin(fx / 9)) for fx in range(-42, 43, 6)]
        rp = [T(x, y, theta)[0] for x, y in ring]
        ribbon(c, rp, 7, 7, TEAL_L)
        ribbon(c, [T(x, y + 12, theta)[0] for x, y in ring[3:-3]], 3, 3, TEAL_L)
    for sgn in (-1, 1):   # headphone cups (on the head's left/right, yawed with the face)
        cup = [(sgn * 56 - 8, -18), (sgn * 56 + 8, -18), (sgn * 56 + 8, 18), (sgn * 56 - 8, 18)]
        if center_z(cup, theta) >= -8:
            tpoly(c, cup, theta, BLACK, outline=None)
            tpoly(c, ellipse_pts(sgn * 56, 0, 4.5, 4.5, 10), theta, PINK, outline=None)
    # face (skin) when it faces the viewer
    if T(0, 15, theta)[1] > 0:
        rim = [(HR * math.cos(math.radians(a)), HR * math.sin(math.radians(a))) for a in range(12, 169, 8)]
        skin = [(-58, -35)] + list(reversed(rim)) + [(62, -35)]
        tpoly(c, skin, theta, SKIN, outline=None)
        # cheek/chin cel shadow (lower part of the face)
        chin = [(HR * math.cos(math.radians(a)), HR * math.sin(math.radians(a))) for a in range(20, 161, 10)]
        tpoly(c, chin + [(40, 30), (0, 36), (-40, 30)], theta, SKIN_SH, outline=None)
        # bang shadow on the forehead, then bangs (dark hem + lighter body)
        tpoly(c, shift(BANG, 2, 8), theta, SKIN_SH, outline=None)
        tpoly(c, BANG, theta, TEAL_S)
        tpoly(c, shift(BANG[1:-1], -2, -6), theta, TEAL, outline=None)
        for sgn in (-1, 1):
            ex, ey = sgn * 18, 24
            if T(ex, ey, theta)[1] > 0:
                # anime eye: big white, iris dark top / light bottom, pupil, two highlights, heavy lash
                tpoly(c, ellipse_pts(ex, ey - 2, 12, 18), theta, WHITE, width=2)
                tpoly(c, ellipse_pts(ex, ey, 9.5, 14), theta, TEAL, outline=None)
                tpoly(c, ellipse_pts(ex, ey - 6, 9.5, 9), theta, IRIS_D, outline=None)
                tpoly(c, ellipse_pts(ex, ey + 7, 6, 5), theta, TEAL_L, outline=None)
                tpoly(c, ellipse_pts(ex, ey + 1, 4, 7), theta, (18, 50, 55), outline=None)
                tpoly(c, ellipse_pts(ex - 4, ey - 8, 4, 4, 12), theta, WHITE, outline=None)
                tpoly(c, ellipse_pts(ex + 4, ey + 8, 2, 2, 8), theta, WHITE, outline=None)
                lash = [T(ex + k, ey - 20 + 0.02 * k * k, theta)[0] for k in range(-13, 14, 3)]
                c.line(lash, OUT, 5.5)
                c.line([T(ex + sgn * 13, ey - 17, theta)[0], T(ex + sgn * 19, ey - 25, theta, 1)[0]], OUT, 4)
                c.line([T(ex - 9, ey - 32, theta)[0], T(ex + 9, ey - 34, theta)[0]], TEAL_S, 2.5)  # brow
                tpoly(c, ellipse_pts(sgn * 33, 42, 9, 5, 12), theta, (255, 165, 175), outline=None)
                for k in (-6, 0, 6):   # anime blush strokes
                    c.line([T(sgn * 33 + k, 39, theta)[0], T(sgn * 33 + k + 3, 45, theta)[0]], (235, 120, 140), 1.5)
                for dy0, dy1 in ((30, 24), (38, 38), (46, 52)):
                    c.line([T(sgn * 42, dy0, theta)[0], T(sgn * 80, dy1, theta, 1)[0]], OUT, 2.5)
        if T(0, 46, theta)[1] > 4:
            m = [T(x, y, theta)[0] for x, y in ((-7, 44), (-3.5, 49), (0, 44), (3.5, 49), (7, 44))]
            c.line(m, OUT, 2.5)
    c.ell(HEAD_X, 0, HR, HR, None)
    features(True)
    # sweat drop (in the air next to the head)
    c.poly([(HEAD_X + 66, -60), (HEAD_X + 74, -42), (HEAD_X + 58, -42)], (120, 200, 255), outline=None)
    c.ell(HEAD_X + 66, -40, 8, 6, (120, 200, 255), outline=None)


# ---------------------------------------------------------------- scene
def proj(u, v, phi):
    """cross-section point (u tangent, v radial) at roll phi -> (screen_y, depth)."""
    return -(v * math.cos(phi) - u * math.sin(phi)), v * math.sin(phi) + u * math.cos(phi)


def draw_toast(c, theta):
    phi = theta
    corners = [proj(u, v, phi)[0] for u in (-TOAST_W / 2, TOAST_W / 2) for v in (R - 2, R + TOAST_T + BUTTER_T)]
    ymin, ymax = min(corners), max(corners)
    c.rrect(TOAST_X0, ymin, TOAST_X1, ymax, 8, CRUST_D)
    c.rrect(TOAST_X0 + 4, ymin + 3, TOAST_X1 - 6, ymax - 7, 6, CRUST, outline=None)
    if abs(math.cos(phi)) > 0.35:          # butter strip visible at the edge
        sy = [proj(u, v, phi)[0] for u in (-TOAST_W / 2, TOAST_W / 2) for v in (R + TOAST_T, R + TOAST_T + BUTTER_T)]
        y0, y1 = min(sy), max(sy)
        if math.cos(phi) > 0:
            y1 = min(y1, ymin + BUTTER_T + 3)
        else:
            y0 = max(y0, ymax - BUTTER_T - 3)
        c.rrect(TOAST_X0 + 4, y0, TOAST_X1 - 4, y1, 3, BUTTER_D, outline=(190, 140, 20), width=2)
        c.rrect(TOAST_X0 + 8, y0 + 1, TOAST_X1 - 12, y1 - 3, 2, BUTTER, outline=None)
    sn = math.sin(phi)
    if abs(sn) > 0.12:
        v = R + TOAST_T if sn > 0 else R
        yc = proj(0, v, phi)[0]
        hh = TOAST_W / 2 * abs(sn)
        c.rrect(TOAST_X0 + 7, yc - hh + 6, TOAST_X1 - 7, yc + hh - 6, 6, BREAD_D, outline=None)
        c.rrect(TOAST_X0 + 9, yc - hh + 8, TOAST_X1 - 12, yc + hh - 12, 5, BREAD, outline=None)
        if sn > 0:                          # butter face toward viewer
            c.rrect(TOAST_X0 + 20, yc - hh * 0.55, TOAST_X1 - 20, yc + hh * 0.55, 4, BUTTER_D,
                    outline=(190, 140, 20), width=2)
            c.rrect(TOAST_X0 + 23, yc - hh * 0.5, TOAST_X1 - 26, yc + hh * 0.42, 3, BUTTER, outline=None)
            c.rrect(TOAST_X0 + 26, yc - hh * 0.44, TOAST_X0 + 40, yc - hh * 0.26, 2, BUTTER_L, outline=None)
            c.rrect(TOAST_X0 + 26, yc - hh * 0.2, TOAST_X0 + 31, yc - hh * 0.05, 1, WHITE, outline=None)
    # straps over toast (down to body)
    for x in (TOAST_X0 + 12, TOAST_X1 - 12):
        c.line([(x, min(ymin, -R)), (x, max(ymax, R))], GREY, 6)


def draw_leg(c, x, phi, front):
    near = math.sin(phi) >= 0
    root_y = proj(0, R * (0.97 if near else 0.85), phi)[0]
    tip_y = proj(0, R + LEG_L, phi)[0]
    c.line([(x, root_y), (x, tip_y)], OUT, 28)
    c.line([(x, root_y), (x, tip_y)], BLACK, 21)
    c.line([(x - 6, root_y), (x - 6, tip_y)], BLACK_L, 4)
    c.ell(x, tip_y, 14, 11, FUR_S)
    c.ell(x - 2, tip_y - 2, 11, 8, FUR, outline=None)
    for tx in (-7, 0, 7):
        c.ell(x + tx, tip_y + (5 if tip_y > root_y else -5), 2.4, 2.4, SKIN_S, outline=None)
    if front:
        by = proj(0, R + 10, phi)[0]
        c.line([(x - 10, by), (x + 10, by)], TEAL, 3)


def draw_cat_tail(c, phi, wob):
    """tail defined in the body frame (x along body, u tangent, v radial) and rolled with it."""
    xv = bezier((BODY_X0 + 6, R * 0.7), (-180, R * 0.9), (-215, 105 + wob), (-172, 150 + wob))
    pts = []
    for i, (x, v) in enumerate(xv):
        t = i / (len(xv) - 1)
        u = 10 * math.sin(t * math.pi)          # slight sideways curl
        y, _ = proj(u, v, phi)
        pts.append((x, y))
    cel_ribbon(c, pts, 22, 13, FUR_S, FUR)
    c.ell(*pts[-1], 9, 9, TEAL_S)
    c.ell(pts[-1][0] - 2, pts[-1][1] - 2, 5, 5, TEAL, outline=None)


def draw_body(c):
    mx, hw = (BODY_X0 + BODY_X1) / 2, (BODY_X1 - BODY_X0) / 2
    c.ell(mx, 0, hw, R, SHIRT)
    c.d.chord([c.P(BODY_X0, -R), c.P(BODY_X1, R)], start=25, end=155, fill=SHIRT_D)   # cel shadow
    c.ell(BODY_X0 + 120, -R + 17, 30, 6, SHIRT_L, outline=None)                          # highlight
    # black skirt band at the rear end
    c.d.chord([c.P(BODY_X0, -R), c.P(BODY_X1, R)], start=110, end=250, fill=BLACK)
    c.ell(BODY_X0 + 36, -R + 22, 12, 4, BLACK_L, outline=None)
    c.line([(BODY_X0 + 22, -R + 4), (BODY_X0 + 22, R - 4)], TEAL, 3)
    c.ell(mx, 0, hw, R, None)
    # shirt collar (grey) near head
    c.line([(BODY_X1 - 8, -R + 6), (BODY_X1 - 8, R - 6)], GREY, 8)


def draw_bg(theta, cy):
    img = Image.new("RGB", (W * SS, H * SS))
    d = ImageDraw.Draw(img)
    for y in range(H * SS):
        t = y / (H * SS)
        d.line([(0, y), (W * SS, y)], fill=(int(150 + 90 * t), int(205 + 40 * t), int(235 + 18 * t)))
    # horizontal speed streaks (anime motion background)
    rnd = 12345
    for k in range(14):
        rnd = (rnd * 1103515245 + 12345) & 0x7FFFFFFF
        yy = 40 + (rnd % 380)
        rnd = (rnd * 1103515245 + 12345) & 0x7FFFFFFF
        x0 = -80 + (rnd % 400) + int(60 * math.cos(theta + k))
        ln = 90 + (rnd % 160)
        d.line([s(x0), s(yy), s(x0 + ln), s(yy)], fill=(255, 255, 255), width=int(s(2 + (k % 3))))
    # radial focus lines from the body center
    for k in range(48):
        a = math.radians(k * 7.5 + math.degrees(theta) * 0.25)
        r0 = 205 + 20 * math.sin(k * 1.7)
        r1 = 380
        d.line([s(CX + r0 * math.cos(a)), s(cy + r0 * math.sin(a)), s(CX + r1 * math.cos(a)), s(cy + r1 * math.sin(a))],
               fill=(255, 255, 255), width=int(s(1.5 + (k % 2) * 1.5)))
    d.rectangle([0, 425 * SS, W * SS, H * SS], fill=(222, 214, 205))
    d.line([(0, 425 * SS), (W * SS, 425 * SS)], fill=(120, 112, 105), width=int(s(4)))
    return img


def main_bg(out_dir):
    font, font_s, font_o = load_fonts()
    frames = []
    for i in range(FRAMES):
        theta = 2 * math.pi * i / FRAMES
        wob = math.sin(theta * 2) * 5
        bob = math.sin(theta) * 5
        cy = CY + bob

        bg = draw_bg(theta, cy)
        d = ImageDraw.Draw(bg)
        # shadow
        sw = 150 - bob * 3
        d.ellipse([s(CX - sw), s(432), s(CX + sw), s(444)], fill=(180, 172, 165))
        # ground scribble like the cartoon
        for k in range(-3, 4):
            d.line([s(CX + k * 40 - 8), s(452), s(CX + k * 40 + 8), s(440)], fill=(120, 116, 110), width=int(s(3)))

        c = Ctx(d, CX, cy)
        head_cx, head_cy = CX + HEAD_X * K, cy

        # 1) twin tails (far behind)
        draw_twin_tails(c, theta, wob, front=False)

        # 2) depth-sorted attachments
        items = []
        items.append((math.sin(theta), lambda: draw_toast(c, theta)))
        for x, a, front in ((55, 0.5, True), (55, -0.5, True), (BODY_X0 + 28, 0.5, False), (BODY_X0 + 28, -0.5, False)):
            phi = theta + math.pi + a
            items.append((math.sin(phi), lambda x=x, phi=phi, front=front: draw_leg(c, x, phi, front)))
        tphi = theta + 0.35
        items.append((math.sin(tphi), lambda: draw_cat_tail(c, tphi, wob)))
        items.sort(key=lambda t: t[0])
        for depth, fn in items:
            if depth < 0:
                fn()
        draw_body(c)
        for depth, fn in items:
            if depth >= 0:
                fn()

        # 3) head (frontal face, rolling in-plane)
        draw_twin_tails(c, theta, wob, front=True)
        draw_head(c, theta, wob)

        # onomatopoeia (jiggles) and sparkles
        jig = 3 * math.sin(theta * 6)
        d.text((s(52 + jig), s(70 - jig)), "グルグル", font=font_o, fill=TEAL_D,
               stroke_width=int(s(3)), stroke_fill=WHITE)
        d.text((s(392 + jig), s(360)), "ふわ…", font=font_o, fill=(120, 100, 160),
               stroke_width=int(s(3)), stroke_fill=WHITE)
        for k, (sx, sy) in enumerate(((60, 300), (410, 120), (370, 300), (110, 130))):
            rr = 9 + 5 * math.sin(theta * 3 + k * 1.6)
            if rr > 6:
                star(c, (sx - CX) / K, (sy - cy) / K, rr / K)

        # motion arcs (roll indicators) around head and rear
        for hx, rr in ((head_cx, 92), (CX + (BODY_X0 + 10) * K, 80)):
            for k in range(2):
                a0 = math.degrees(theta) + k * 180 + 20
                d.arc([s(hx - rr), s(cy - rr), s(hx + rr), s(cy + rr)], start=a0, end=a0 + 55,
                      fill=(150, 210, 206), width=int(s(4)))
        # hover lines
        for hx in (CX - 190, CX + 200):
            for yy in (300, 330, 360):
                d.line([s(hx), s(yy), s(hx), s(yy + 18)], fill=(170, 200, 200), width=int(s(3)))

        # captions
        title = "バター猫パラドックス"
        tw = d.textlength(title, font=font)
        d.rounded_rectangle([s(CX) - tw / 2 - s(12), s(6), s(CX) + tw / 2 + s(12), s(40)],
                            radius=s(10), fill=(255, 255, 255), outline=TEAL_D, width=int(s(3)))
        d.text((s(CX) - tw / 2, s(12)), title, font=font, fill=TEAL_D)
        sub = "足は下へ × バターは下へ ＝ 着地できずに回り続ける"
        sw2 = d.textlength(sub, font=font_s)
        d.text((s(CX) - sw2 / 2, s(455)), sub, font=font_s, fill=(90, 90, 100))

        out = bg.resize((W, H), Image.LANCZOS)
        frames.append(out.quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE))
    path = os.path.join(out_dir, "buttercat_miku.gif")
    frames[0].save(path, save_all=True, append_images=frames[1:], duration=DUR, loop=0, optimize=False)
    print("wrote", path)


def main_alpha(out_dir, keyframes=False):
    frames_rgba = []
    for i in range(FRAMES):
        theta = 2 * math.pi * i / FRAMES
        wob = math.sin(theta * 2) * 5
        bob = math.sin(theta) * 5
        cy = CY + bob

        img = Image.new("RGBA", (W * SS, H * SS), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        c = Ctx(d, CX, cy)

        draw_twin_tails(c, theta, wob, front=False)
        items = [(math.sin(theta), lambda: draw_toast(c, theta))]
        for x, a, front in ((55, 0.5, True), (55, -0.5, True), (BODY_X0 + 28, 0.5, False), (BODY_X0 + 28, -0.5, False)):
            phi = theta + math.pi + a
            items.append((math.sin(phi), lambda x=x, phi=phi, front=front: draw_leg(c, x, phi, front)))
        tphi = theta + 0.35
        items.append((math.sin(tphi), lambda: draw_cat_tail(c, tphi, wob)))
        items.sort(key=lambda t: t[0])
        for depth, fn in items:
            if depth < 0:
                fn()
        draw_body(c)
        for depth, fn in items:
            if depth >= 0:
                fn()
        draw_twin_tails(c, theta, wob, front=True)
        draw_head(c, theta, wob)

        out = img.resize((W, H), Image.LANCZOS)
        frames_rgba.append(out)
        if keyframes and i in (0, 9, 18, 27):
            out.save(os.path.join(out_dir, f"keyframe_{i:02d}.png"))

    # --- transparent GIF (1-bit alpha): matte edges toward the outline colour, reserve index 255
    MATTE = OUT
    gif_frames = []
    for fr in frames_rgba:
        alpha = fr.getchannel("A")
        matte = Image.new("RGBA", fr.size, MATTE + (255,))
        flat = Image.alpha_composite(matte, fr).convert("RGB")
        q = flat.quantize(colors=255, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
        mask = alpha.point(lambda a: 255 if a < 128 else 0)
        q.paste(255, mask=mask)
        pal = q.getpalette()
        pal[255 * 3:255 * 3 + 3] = [0, 0, 0]
        q.putpalette(pal)
        gif_frames.append(q)
    path = os.path.join(out_dir, "buttercat_miku_alpha.gif")
    gif_frames[0].save(path, save_all=True, append_images=gif_frames[1:],
                       duration=DUR, loop=0, transparency=255, disposal=2, optimize=False)
    print("wrote", path)

    # --- APNG with full alpha
    path = os.path.join(out_dir, "buttercat_miku_alpha.png")
    frames_rgba[0].save(path, save_all=True, append_images=frames_rgba[1:], duration=DUR, loop=0, format="PNG")
    print("wrote", path)




def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default="output", help="output directory (default: output)")
    ap.add_argument("--with-bg", action="store_true", help="also render the version with background/captions")
    ap.add_argument("--keyframes", action="store_true", help="also save 0/90/180/270-degree still PNGs")
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    main_alpha(args.out, keyframes=args.keyframes)
    if args.with_bg:
        main_bg(args.out)


if __name__ == "__main__":
    main()
