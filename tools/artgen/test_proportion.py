"""デッサンの検査(proportion_check)のテスト。  python -m unittest discover -s tools/artgen -v
・実際のデザインデータ(batter / pitcher)が全部の検査に通ること
・わざと崩した絵(頭が大きすぎる・棒立ち・重心が外れる・嘘の目印)を、検査が見つけること"""
import copy
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import artgen  # noqa: E402
import proportion_check as pc  # noqa: E402


def load(n):
    return artgen.load_design(pc.DESIGN_DIR / f"{n}.json")


def failed(d):
    return {r.id for r in pc.check(d) if not r.ok}


class RealDesignsTest(unittest.TestCase):
    def test_batter_passes_all(self):
        bad = [r for r in pc.check(load("batter")) if not r.ok]
        self.assertEqual(bad, [], [(r.id, r.name, r.value) for r in bad])

    def test_pitcher_passes_all(self):
        bad = [r for r in pc.check(load("pitcher")) if not r.ok]
        self.assertEqual(bad, [], [(r.id, r.name, r.value) for r in bad])

    def test_every_rule_family_is_exercised(self):
        ids = {r.id for n in ("batter", "pitcher") for r in pc.check(load(n))}
        for want in ("P1", "P2", "P3", "P4", "P5", "P6", "P7", "P9", "P11", "P12", "P13"):
            self.assertIn(want, ids)

    def test_batter_stance_is_athletic_not_standing_at_attention(self):
        r = {(x.id, x.name[:6]): x.value for x in pc.check(load("batter"))}
        knees = [x.value for x in pc.check(load("batter")) if x.id == "P12"]
        self.assertTrue(all(v <= 168 for v in knees), knees)       # 膝が曲がっている
        lean = [x.value for x in pc.check(load("batter")) if x.id == "P13"][0]
        self.assertGreaterEqual(lean, 3.0)                          # 胴が前へ傾いている

    def test_declared_exceptions_have_reasons(self):
        for n in ("batter", "pitcher"):
            st = load(n).get("style", {})
            if st.get("skip") or st.get("override"):
                self.assertTrue(st.get("why"), f"{n}: skip/override には理由(why)を書く")


class DetectsBadDrawingsTest(unittest.TestCase):
    def test_head_too_big(self):
        d = load("batter")
        lm = d["landmarks"]
        lm["chin"] = [lm["chin"][0], lm["chin"][1] + 90]           # 頭が縦に大きい → 頭身が足りない
        self.assertIn("P1", failed(d))

    def test_eye_too_high(self):
        d = load("pitcher")
        d["landmarks"]["eye"] = [83, 22]
        self.assertIn("P2", failed(d) | {"P11"})                    # 目が頭頂近く(P2)、または目印が嘘(P11)
        d2 = load("pitcher"); d2["landmarks"]["eye"] = [83, 82]
        d2["style"]["override"] = {"P2": [0.20, 0.40]}
        self.assertIn("P2", failed(d2))

    def test_legs_too_long_or_short(self):
        d = load("batter")
        d["landmarks"]["hip"] = [214, 250]                          # 股が高い → 脚が長すぎ
        self.assertIn("P4", failed(d))
        d = load("batter")
        d["landmarks"]["hip"] = [214, 470]
        self.assertIn("P4", failed(d))

    def test_straight_knees_flagged(self):
        d = load("batter")
        d["landmarks"]["leg_a"]["knee"] = [175, 452]                # ほぼ一直線
        d["landmarks"]["leg_a"]["ankle"] = [150, 552]
        d["landmarks"]["leg_a"]["hip"] = [200, 352]
        d["landmarks"]["leg_a"]["knee"] = [175, 452]
        self.assertIn("P12", failed(d))

    def test_upright_torso_flagged(self):
        d = load("batter")
        d["landmarks"]["neck"] = [214, 182]
        d["landmarks"]["hip"] = [214, 350]
        self.assertIn("P13", failed(d))

    def test_center_of_mass_outside_support(self):
        d = load("pitcher")
        d["style"]["support_x"] = [150, 190]                        # 支え足が体から離れている → 倒れる
        self.assertIn("P9", failed(d))

    def test_uneven_legs(self):
        d = load("batter")
        d["landmarks"]["leg_a"]["sole"] = [150, 520]
        self.assertIn("P8", failed(d) | {"P11"})

    def test_fake_landmarks_are_caught(self):
        d = load("batter")
        d["landmarks"]["fist"] = [30, 30]                           # 絵の上の別の所
        self.assertIn("P11", failed(d))
        d = load("batter")
        d["landmarks"]["leg_b"]["sole"] = [290, 560]                # 足裏の位置が嘘
        self.assertIn("P11", failed(d))

    def test_missing_landmarks_skip_instead_of_crashing(self):
        d = load("pitcher")
        d["landmarks"] = {"head_top": [100, 10], "chin": [100, 118]}
        self.assertIsInstance(pc.check(d), list)

    def test_hair_share_limit(self):
        d = load("batter")
        d["style"]["hair_max"] = 0.10
        self.assertIn("P10", failed(d))


class LimbShapeTest(unittest.TestCase):
    def test_limb_is_tapered_and_closed(self):
        d = {"name": "t", "size": [100, 200], "bg": "#FFFFFF", "w": 0,
             "shapes": [{"t": "limb", "pts": [[50, 10], [50, 100], [50, 190]], "widths": [60, 20, 40], "fill": "#000000"}]}
        import io
        import numpy as np
        from PIL import Image
        a = np.array(Image.open(io.BytesIO(artgen.render_png(artgen.render_svg(d), 100, 200))).convert("L"))
        w_top = (a[20] < 128).sum()
        w_mid = (a[100] < 128).sum()
        w_bot = (a[185] < 128).sum()
        self.assertGreater(w_top, w_mid)
        self.assertGreater(w_bot, w_mid)
        self.assertLess(abs(w_mid - 20), 4)


if __name__ == "__main__":
    unittest.main()
