"""img2vector の単体テスト。  python -m unittest discover -s tools/img2vector -v"""
import io
import sys
import unittest
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

sys.path.insert(0, str(Path(__file__).parent))
import img2vector as m  # noqa: E402


def sample(w=120, h=160) -> np.ndarray:
    """グラデーションの体・茶色の輪郭・白い襟・白い背景を持つ小さな絵(少しぼかす)。"""
    im = Image.new("RGB", (w, h), "white")
    d = ImageDraw.Draw(im)
    for y in range(70, 150):
        d.line([(40, y), (80, y)], fill=(int(120 + y * 0.3), 170, int(200 - y * 0.2)))
    d.ellipse([34, 12, 86, 66], fill=(255, 224, 200), outline=(90, 50, 30), width=3)
    d.polygon([(48, 64), (72, 64), (60, 80)], fill=(255, 255, 255), outline=(90, 50, 30))
    d.rectangle([40, 70, 80, 150], outline=(90, 50, 30), width=3)
    im = im.filter(ImageFilter.GaussianBlur(0.7))
    return np.dstack([np.array(im), np.full((h, w), 255, np.uint8)])


class Img2VectorTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.img = sample()
        cls.res = m.trace_image(cls.img, m.TraceOptions(colors=8, upscale=2.0))

    def test_flat_svg_only(self):
        for tag in m.FORBIDDEN_SVG_TAGS:
            self.assertNotIn(tag, self.res.svg)
        self.assertIn("<path", self.res.svg)
        self.assertIn('viewBox="0 0 240 320"', self.res.svg)  # 拡大後の座標で描き、元の大きさ(120x160)で表示する
        self.assertIn('width="120"', self.res.svg)

    def test_close_to_original(self):
        self.assertGreater(self.res.report["ssim"], 0.95)
        self.assertLess(self.res.report["delta_e_mean"], 3.0)

    def test_palette_is_small_and_flat(self):
        self.assertLessEqual(self.res.report["colors_used"], 8)
        self.assertEqual(len(set(map(tuple, self.res.quantized.reshape(-1, 3)))), self.res.report["colors_used"])

    def test_deterministic(self):
        again = m.trace_image(self.img, m.TraceOptions(colors=8, upscale=2.0))
        self.assertEqual(self.res.svg, again.svg)

    def test_transparent_bg_and_crop(self):
        r = m.trace_image(self.img, m.TraceOptions(colors=8, upscale=2.0, transparent_bg=True))
        out = np.array(Image.open(io.BytesIO(r.png)).convert("RGBA"))
        self.assertEqual(out[0, 0, 3], 0)  # 隅は透過
        self.assertGreater(out[out.shape[0] // 2, out.shape[1] // 2, 3], 200)  # 中身は不透明
        self.assertIsNotNone(r.report["crop"])
        self.assertLess(r.report["size"][0], 120)  # 余白が切り詰められる

    def test_clear_at_makes_enclosed_gap_transparent(self):
        im = np.full((100, 100, 4), 255, np.uint8)
        im[..., :3] = 255
        im[10:90, 10:90, :3] = (200, 60, 60)      # 赤い板
        im[40:60, 40:60, :3] = 255                # 板に囲まれた白い隙間
        kept = m.background_mask(im[..., :3], 12.0)
        self.assertFalse(kept[50, 50])
        cleared = m.background_mask(im[..., :3], 12.0, seeds=[[50, 50]])
        self.assertTrue(cleared[50, 50])
        with self.assertRaises(ValueError):
            m.background_mask(im[..., :3], 12.0, seeds=[[20, 20]])  # 背景色でない点は指定できない

    def test_warp_y_moves_marker(self):
        im = np.full((200, 20, 4), 255, np.uint8)
        im[118:122, :, :3] = 0  # 高さ 0.6 の黒い線
        out = m.warp_y(im, [(0.6, 0.75)])
        rows = np.where(out[:, 0, 0] < 128)[0]
        self.assertAlmostEqual(rows.mean() / 199, 0.75, delta=0.02)
        with self.assertRaises(ValueError):
            m.warp_y(im, [(0.6, 0.3), (0.7, 0.2)])


class SketchTest(unittest.TestCase):
    """手書き風: 元と「似た形」のまま、素の模写とは違う(ゆらぎがある)ことを、種と強さを変えて繰り返し確認する。"""

    @classmethod
    def setUpClass(cls):
        cls.img = sample()
        cls.rgb, cls.a = cls.img[..., :3], np.full(cls.img.shape[:2], 255, np.uint8)
        cls.plain = m.trace_image(cls.img, m.TraceOptions(colors=8, upscale=2.0, transparent_bg=True))
        cls.rgb_t = cls.rgb
        # 背景透過で切り詰めた元(比較は同じ範囲どうしで行う)
        x0, y0, x1, y1 = cls.plain.report["crop"]
        cls.ref_rgb = cls.img[y0:y1, x0:x1, :3]
        cls.ref_a = np.where(m.background_mask(cls.img[..., :3], 12.0), 0, 255).astype(np.uint8)[y0:y1, x0:x1]

    def trace(self, **kw):
        return m.trace_image(self.img, m.TraceOptions(colors=8, upscale=2.0, transparent_bg=True, **kw))

    def sim(self, res):
        rgb, a = m._decode_png(res.png)
        return m.shape_similarity(self.ref_rgb, self.ref_a, rgb, a)

    def test_similar_shape_across_seeds_and_strengths(self):
        for seed in (1, 2, 3, 4, 5):
            for amp in (0.8, 1.5, 2.5):
                with self.subTest(seed=seed, amp=amp):
                    r = self.trace(sketch=amp, sketch_seed=seed, verify_rounds=1, verify_edge_f1=0, verify_iou=0)
                    sim = self.sim(r)
                    self.assertGreaterEqual(sim["edge_f1"], 0.85, sim)   # 輪郭がほぼ同じ場所にある
                    self.assertLessEqual(sim["chamfer"], 2.0, sim)       # 輪郭のずれは平均 2px 以内
                    # シルエットが重なる(この試験画像は 70x140px 程度と小さく、2.5px のゆらぎは大きい。実寸の絵は verify_iou=0.96 で確認する)
                    self.assertGreaterEqual(sim["iou"], 0.92, sim)
                    self.assertGreaterEqual(sim["iou"], self.sim(self.plain)["iou"] - 0.08, sim)
                    self.assertEqual(r.report["verify"]["rounds"][0]["amp"], amp)

    def test_differs_from_plain_trace(self):
        plain = self.sim(self.plain)
        for seed in (1, 2, 3):
            r = self.trace(sketch=2.0, sketch_seed=seed, verify_rounds=1, verify_edge_f1=0, verify_iou=0)
            self.assertGreater(self.sim(r)["chamfer"], plain["chamfer"] + 0.1)  # 手書きらしいずれがある
            self.assertNotEqual(r.svg, self.plain.svg)

    def test_stronger_sketch_wobbles_more(self):
        c = [self.sim(self.trace(sketch=a, verify_rounds=1, verify_edge_f1=0, verify_iou=0))["chamfer"] for a in (0.5, 1.5, 3.0)]
        self.assertLess(c[0], c[2])

    def test_seed_is_deterministic_and_different_seeds_differ(self):
        a1 = self.trace(sketch=1.5, sketch_seed=3)
        a2 = self.trace(sketch=1.5, sketch_seed=3)
        b = self.trace(sketch=1.5, sketch_seed=4)
        self.assertEqual(a1.svg, a2.svg)
        self.assertNotEqual(a1.svg, b.svg)

    def test_verify_loop_weakens_wobble_until_similar(self):
        # わざと厳しい基準を置くと、ゆらぎを弱めて繰り返し、最後は基準を満たすか、回数を使い切る
        r = self.trace(sketch=6.0, verify_edge_f1=0.97, verify_iou=0.985, verify_rounds=6)
        v = r.report["verify"]
        self.assertGreater(len(v["rounds"]), 1)
        amps = [x["amp"] for x in v["rounds"]]
        self.assertEqual(amps, sorted(amps, reverse=True))
        self.assertLess(v["amp_used"], 6.0)
        self.assertTrue(v["passed"] or len(v["rounds"]) == 6)

    def test_sketch_svg_is_still_flat_and_small_change_in_size(self):
        r = self.trace(sketch=2.0)
        for tag in m.FORBIDDEN_SVG_TAGS:
            self.assertNotIn(tag, r.svg)
        self.assertLess(r.report["svg_bytes"], self.plain.report["svg_bytes"] * 1.3)

    def test_default_is_unchanged_when_sketch_is_zero(self):
        self.assertIsNone(self.plain.report["verify"])


class PrepTest(unittest.TestCase):
    def test_flip_x(self):
        im = np.zeros((4, 6, 4), np.uint8)
        im[:, 0, 0] = 255
        out = m.flip_x(im)
        self.assertEqual(out[0, -1, 0], 255)
        self.assertEqual(out[0, 0, 0], 0)

    def test_inpaint_red_removes_red_mark_only_inside_box(self):
        im = np.full((60, 60, 4), 255, np.uint8)
        im[..., :3] = (250, 220, 200)                 # 肌
        im[20:30, 20:40, :3] = (205, 40, 70)          # 箱の中の赤い印
        im[50:56, 50:56, :3] = (205, 40, 70)          # 箱の外の赤は残す
        out = m.inpaint_red(im, (10, 10, 45, 45))
        self.assertLess(abs(int(out[25, 30, 0]) - 250), 30)
        self.assertGreater(abs(int(out[25, 30, 1]) - 40), 100)
        self.assertEqual(tuple(out[52, 52, :3]), (205, 40, 70))


if __name__ == "__main__":
    unittest.main()
