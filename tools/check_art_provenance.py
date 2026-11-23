"""素材の出どころ検査。  python tools/check_art_provenance.py [プロジェクトのディレクトリ(既定 lyric-homerun)]

app/ の下にあるすべての画像(サブフォルダも含む)が、art-src/provenance.json に全部載っていて、出どころが規約に合うかを調べる。
キーは app/ からの相対パス(例: "assets/bg.png")。
  OK  : program(コードで描いた) / human(人が描いた) / licensed(正規に許諾。author 必須)
  NG  : ai / ai-derived(画像生成 AI の出力、または、それを元絵にした模写) / 載っていない画像 / 不明な source
コンテスト規約は、作品に表示される絵に AI 生成物を使うことを一切認めない(docs/ai-art-policy.md)。
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

OK_SOURCES = {"program", "human", "licensed"}
IMAGE_EXT = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"}


def check(project: Path) -> list[str]:
    problems: list[str] = []
    app_dir = project / "app"
    prov_path = project / "art-src" / "provenance.json"
    if not prov_path.exists():
        return [f"{prov_path} が無い(素材の出どころを書くこと)"]
    prov = json.loads(prov_path.read_text(encoding="utf-8")).get("assets", {})
    files = sorted(p.relative_to(app_dir).as_posix() for p in app_dir.rglob("*") if p.is_file() and p.suffix.lower() in IMAGE_EXT) if app_dir.exists() else []
    for name in files:
        info = prov.get(name)
        if info is None:
            problems.append(f"{name}: provenance.json に出どころが載っていない")
            continue
        src = info.get("source")
        if src not in OK_SOURCES:
            problems.append(f"{name}: source={src!r} は使えない(ai / ai-derived は規約違反。program / human / licensed のみ)")
        elif src == "licensed" and not info.get("author"):
            problems.append(f"{name}: licensed には author(作者名)が必要。アプリ内にも明示すること")
    for name in prov:
        if name not in files:
            problems.append(f"{name}: provenance.json にあるが app/ に無い")
    art = project / "app" / "data" / "art.json"
    if art.exists():
        for key, path in json.loads(art.read_text(encoding="utf-8")).items():
            if isinstance(path, str) and path and Path(path).as_posix() not in prov and Path(path).suffix.lower() in IMAGE_EXT:
                problems.append(f"art.json の {key}: {path} の出どころが載っていない")
    return problems


def main(argv=None) -> int:
    root = Path(argv[0] if argv else "lyric-homerun")
    problems = check(root)
    if problems:
        print("素材の出どころの検査: NG")
        for p in problems:
            print("  -", p)
        return 1
    print("素材の出どころの検査: OK")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
