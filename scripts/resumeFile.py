#!/usr/bin/env python3
"""Add local documents (CV, menu, price list, FAQ...) to context.txt.

Usage:
  python3 scripts/resumeFile.py cv.pdf faq.md prices.docx [--title "Price list"] [--dry-run]

Supports .txt, .md, .csv, .json, .html, .docx and .pdf (PDF needs `pdftotext` from poppler).
"""

from __future__ import annotations

import html
import re
import shutil
import subprocess
import zipfile
from pathlib import Path

from tools.context_tools import append_to_context, base_parser, fail, truncate


def read_docx(path: Path) -> str:
    with zipfile.ZipFile(path) as archive:
        xml = archive.read("word/document.xml").decode("utf-8", "replace")
    xml = re.sub(r"</w:p>", "\n", xml)
    xml = re.sub(r"<w:tab/>", "\t", xml)
    return html.unescape(re.sub(r"<[^>]+>", "", xml))


def read_pdf(path: Path) -> str:
    if not shutil.which("pdftotext"):
        fail(
            "pdftotext is required for PDF files (macOS: brew install poppler, Debian: apt install poppler-utils)"
        )
    return subprocess.run(
        ["pdftotext", "-layout", str(path), "-"],
        check=True,
        capture_output=True,
        text=True,
    ).stdout


def read_file(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix == ".docx":
        return read_docx(path)
    if suffix == ".pdf":
        return read_pdf(path)
    if suffix in (".html", ".htm"):
        text = re.sub(
            r"<(script|style)[\s\S]*?</\1>",
            "",
            path.read_text(encoding="utf-8", errors="replace"),
        )
        return html.unescape(re.sub(r"<[^>]+>", "\n", text))
    if suffix in (".txt", ".md", ".csv", ".json", ".yaml", ".yml"):
        return path.read_text(encoding="utf-8", errors="replace")
    fail(f"unsupported file type: {path.name}")
    return ""


def main() -> None:
    parser = base_parser(__doc__.splitlines()[0])
    parser.add_argument("files", nargs="+", type=Path)
    parser.add_argument("--title", help="section title (default: the file names)")
    args = parser.parse_args()

    per_file = max(500, args.max_chars // len(args.files))
    sections = []
    for path in args.files:
        path = path.expanduser()
        if not path.is_file():
            fail(f"{path} does not exist")
        text = read_file(path).strip()
        if text:
            sections.append(f"From {path.name}:\n{truncate(text, per_file)}")

    title = args.title or "Documents: " + ", ".join(path.name for path in args.files)
    append_to_context("resumeFile", title, "\n\n".join(sections), args)


if __name__ == "__main__":
    main()
