"""check_art_provenance の単体テスト。  python -m unittest discover -s tools -p "test_check*.py" -v"""
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import check_art_provenance as c  # noqa: E402


def project(assets: dict, files=("a.png",), art=None):
    d = Path(tempfile.mkdtemp())
    (d / "app" / "assets").mkdir(parents=True)
    (d / "app" / "data").mkdir(parents=True)
    (d / "art-src").mkdir()
    for f in files:
        (d / "app" / "assets" / f).write_bytes(b"x")
    (d / "art-src" / "provenance.json").write_text(json.dumps({"assets": assets}), encoding="utf-8")
    (d / "app" / "data" / "art.json").write_text(json.dumps(art or {}), encoding="utf-8")
    return d


class ProvenanceTest(unittest.TestCase):
    def test_program_and_human_pass(self):
        for src in ("program", "human"):
            self.assertEqual(c.check(project({"a.png": {"source": src}})), [])

    def test_ai_and_ai_derived_fail(self):
        for src in ("ai", "ai-derived"):
            self.assertTrue(c.check(project({"a.png": {"source": src}})))

    def test_unlisted_image_fails(self):
        self.assertTrue(c.check(project({}, files=("a.png",))))

    def test_licensed_needs_author(self):
        self.assertTrue(c.check(project({"a.png": {"source": "licensed"}})))
        self.assertEqual(c.check(project({"a.png": {"source": "licensed", "author": "X"}})), [])

    def test_unknown_source_fails(self):
        self.assertTrue(c.check(project({"a.png": {"source": "unknown"}})))

    def test_art_json_reference_must_be_listed(self):
        d = project({"a.png": {"source": "program"}}, art={"background": "assets/b.png"})
        self.assertTrue(c.check(d))


if __name__ == "__main__":
    unittest.main()
