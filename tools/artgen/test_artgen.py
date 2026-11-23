"""artgen のテスト。  python -m unittest discover -s tools/artgen -v
デザインデータ(lyric-homerun/art-src/design/*.json)の検査も含む。"""
import io
import json
import sys
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
import artgen  # noqa: E402

DESIGN_DIR = Path(__file__).resolve().parents[2] / "lyric-homerun" / "art-src" / "design"


def load_strict(path: Path) -> dict:
    """同じキーが2回出たらエラーにする(rrect の "w" が幅と線の太さで衝突したような事故を防ぐ)。"""
    def hook(pairs):
        keys = [k for k, _ in pairs]
        dup = {k for k in keys if keys.count(k) > 1}
        if dup:
            raise ValueError(f"{path.name}: キーの重複 {dup}")
        return dict(pairs)
    return json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=hook)


def walk(shapes):
    """グループの中も含めて、すべての図形を順に返す。"""
    for s in shapes:
        yield s
        if s.get("t") == "group":
            yield from walk(s["shapes"])


def px(design, scale=1):
    svg = artgen.render_svg(design)
    w, h = design["size"]
    return np.array(Image.open(io.BytesIO(artgen.render_png(svg, round(w * scale), round(h * scale)))).convert("RGB"))


class RenderTest(unittest.TestCase):
    def test_shapes_render_in_place(self):
        d = {"name": "t", "size": [100, 100], "bg": "#FFFFFF", "w": 0, "colors": {"r": "#FF0000"},
             "shapes": [{"t": "rrect", "x": 10, "y": 10, "w": 30, "h": 20, "r": 4, "fill": "$r"},
                        {"t": "ellipse", "cx": 70, "cy": 70, "rx": 10, "ry": 10, "fill": "#0000FF"}]}
        a = px(d)
        self.assertEqual(tuple(a[20, 25]), (255, 0, 0))     # 四角の中
        self.assertEqual(tuple(a[70, 70]), (0, 0, 255))     # 円の中
        self.assertEqual(tuple(a[90, 10]), (255, 255, 255))  # 背景

    def test_rrect_outline_width_is_separate_from_size(self):
        d = {"name": "t", "size": [100, 100], "bg": "#FFFFFF", "w": 2, "outline": "#000000",
             "shapes": [{"t": "rrect", "x": 20, "y": 20, "w": 60, "h": 60, "r": 0, "fill": "#00FF00", "lw": 4}]}
        a = px(d)
        self.assertEqual(tuple(a[50, 50]), (0, 255, 0))     # 中は塗り(輪郭が幅いっぱいに広がらない)
        self.assertEqual(tuple(a[20, 50]), (0, 0, 0))       # 縁は輪郭
        self.assertEqual(tuple(a[5, 5]), (255, 255, 255))

    def test_group_transform_and_line(self):
        d = {"name": "t", "size": [100, 100], "bg": "#FFFFFF", "w": 0,
             "shapes": [{"t": "group", "tx": 50, "ty": 50, "shapes": [{"t": "poly", "fill": "#000000", "pts": [[-5, -5], [5, -5], [5, 5], [-5, 5]]}]},
                        {"t": "line", "stroke": "#FF0000", "w": 6, "pts": [[0, 5], [100, 5]]}]}
        a = px(d)
        self.assertEqual(tuple(a[50, 50]), (0, 0, 0))
        self.assertEqual(tuple(a[5, 50]), (255, 0, 0))

    def test_unknown_shape_is_an_error(self):
        with self.assertRaises(ValueError):
            artgen.render_svg({"name": "t", "size": [10, 10], "shapes": [{"t": "star"}]})

    def test_deterministic(self):
        d = load_strict(DESIGN_DIR / "pitcher.json")
        self.assertEqual(artgen.render_svg(d), artgen.render_svg(d))


class DesignDataTest(unittest.TestCase):
    """コードで描いた元絵のデザインデータが、ゲーム側の約束(設計 Artifact)と合っているか。"""

    @classmethod
    def setUpClass(cls):
        cls.d = {n: load_strict(DESIGN_DIR / f"{n}.json") for n in ("background", "batter", "pitcher")}

    def test_all_design_files_load_and_render(self):
        for n, d in self.d.items():
            with self.subTest(n):
                a = px(d)
                self.assertEqual(a.shape[:2], (d["size"][1], d["size"][0]))
                self.assertGreater(len(set(map(tuple, a.reshape(-1, 3)[::97]))), 6)  # 白紙ではない

    def test_background_mound_and_home_positions(self):
        d = self.d["background"]
        h = d["size"][1]
        mound = [s for s in d["shapes"] if s.get("t") == "ellipse" and s.get("rx") == 60 and s.get("ry") == 19][0]
        home = [s for s in d["shapes"] if s.get("t") == "ellipse" and s.get("rx") == 116][0]
        self.assertAlmostEqual(mound["cy"] / h, 0.40, delta=0.005)  # 投手の足元 = 上から 40%
        self.assertAlmostEqual(home["cy"] / h, 0.70, delta=0.005)   # ホーム = 上から 70%
        self.assertAlmostEqual(mound["cx"] / d["size"][0], 0.5, delta=0.005)

    def test_stands_cover_the_crowd_rows_of_the_game(self):
        # ゲームの観客は、画像の高さの 16.8%〜23.1% に描く(game.js drawCrowd)
        d = self.d["background"]
        h = d["size"][1]
        ys = [min(p[1] for p in s["pts"]) for s in d["shapes"] if s.get("t") == "poly" and s.get("fill") in ("#F7C3B8", "#BFD0E8", "#FBE59A", "#BFE0C8", "#D7C7EC")]
        ye = [max(p[1] for p in s["pts"]) for s in d["shapes"] if s.get("t") == "poly" and s.get("fill") in ("#F7C3B8", "#BFD0E8", "#FBE59A", "#BFE0C8", "#D7C7EC")]
        self.assertLessEqual(min(ys) / h, 0.168)
        self.assertGreaterEqual(max(ye) / h, 0.231)

    def test_batter_is_right_handed_facing_right(self):
        # 右打ち: 胸はホーム側(画面の右)を向く。拳は腰より右(前)にあり、顔(目)は体の中心より右にある
        lm = self.d["batter"]["landmarks"]
        self.assertGreater(lm["fist"][0], lm["hip"][0] + 60)
        self.assertGreater(lm["eye"][0], lm["hip"][0])
        self.assertGreater(lm["torso_front"][0], lm["torso_back"][0])
        # 拳の位置(ネギの付け根)に肌色がある
        a = px(self.d["batter"]).astype(int)
        x, y = [int(round(v)) for v in lm["fist"]]
        self.assertLess(np.abs(a[y, x] - np.array([255, 230, 212])).sum(), 60)

    def test_batter_has_no_01_mark(self):
        # 右打ちで手前に見えるのは右腕。「01」は左腕にあるので描かない(赤い文字が無い)
        a = px(self.d["batter"]).astype(int)
        red = (a[..., 0] > 190) & (a[..., 1] < 90) & (a[..., 2] < 120)
        self.assertLess(red.sum(), 30)

    def test_pitcher_face_rules(self):
        # 口は極小の細い線(幅 12 以内)、輪郭なしの目。たらこ唇にしない
        d = self.d["pitcher"]
        mouth = [s for s in d["shapes"] if s.get("_", "").startswith("口")][0]
        self.assertLessEqual(mouth.get("w", 99), 3)
        nums = [float(t) for t in mouth["d"].replace("M", " ").replace("C", " ").split()]
        xs = nums[0::2]
        self.assertLessEqual(max(xs) - min(xs), 12)

    def test_batter_mouth_is_tiny_line(self):
        d = self.d["batter"]
        mouth = [s for s in walk(d["shapes"]) if s.get("_", "").startswith("口")][0]
        self.assertLessEqual(mouth.get("w", 99), 3)
        self.assertEqual(mouth["fill"], "none")  # 塗りの唇にしない


if __name__ == "__main__":
    unittest.main()
