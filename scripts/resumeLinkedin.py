#!/usr/bin/env python3
"""Summarize a LinkedIn profile into context.txt from your LinkedIn data export or profile PDF.

Usage:
  python3 resumeLinkedin.py <export.zip | export-folder | profile.pdf> [--dry-run]

LinkedIn does not allow scraping (profiles are behind a login wall and its terms forbid it),
so this tool reads the files LinkedIn gives you:
  - Data export: LinkedIn > Settings > Data privacy > Get a copy of your data. Pick at least
    Profile, Positions, Education and Skills. You receive a ZIP with CSV files.
  - Profile PDF: open the profile > More > Save to PDF. Needs `pdftotext` (poppler).

Private fields in the export (address, birth date, phone, email) are never copied.
"""

from __future__ import annotations

import csv
import io
import shutil
import subprocess
import zipfile
from pathlib import Path

from tools.context_tools import (
    append_to_context,
    base_parser,
    bullet_lines,
    clean,
    fail,
    truncate,
)


def read_csv_files(source: Path) -> dict[str, list[dict[str, str]]]:
    files: dict[str, str] = {}
    if source.is_dir():
        for path in source.rglob("*.csv"):
            files[path.name.lower()] = path.read_text(
                encoding="utf-8-sig", errors="replace"
            )
    else:
        with zipfile.ZipFile(source) as archive:
            for name in archive.namelist():
                if name.lower().endswith(".csv"):
                    files[Path(name).name.lower()] = archive.read(name).decode(
                        "utf-8-sig", "replace"
                    )

    tables: dict[str, list[dict[str, str]]] = {}
    for name, text in files.items():
        lines = text.splitlines()
        # Some exports start with "Notes:" lines before the real header.
        start = next(
            (
                i
                for i, line in enumerate(lines)
                if "," in line and not line.startswith("Notes")
            ),
            0,
        )
        reader = csv.DictReader(io.StringIO("\n".join(lines[start:])))
        tables[name] = [
            {(k or "").strip(): (v or "").strip() for k, v in row.items()}
            for row in reader
        ]
    return tables


def period(row: dict[str, str], start: str, end: str) -> str:
    begin, finish = row.get(start, ""), row.get(end, "")
    if not begin and not finish:
        return ""
    return f" ({begin or '?'} - {finish or 'present'})"


def from_export(source: Path, max_positions: int) -> tuple[str, str]:
    tables = read_csv_files(source)
    if not tables:
        fail(f"no CSV files found in {source}")

    profile = (tables.get("profile.csv") or [{}])[0]
    name = (
        " ".join(filter(None, [profile.get("First Name"), profile.get("Last Name")]))
        or "LinkedIn profile"
    )
    sections = [
        bullet_lines(
            [
                f"Name: {name}",
                f"Headline: {profile['Headline']}" if profile.get("Headline") else "",
                f"Industry: {profile['Industry']}" if profile.get("Industry") else "",
                f"Location: {profile['Geo Location']}"
                if profile.get("Geo Location")
                else "",
                f"Websites: {profile['Websites']}" if profile.get("Websites") else "",
            ]
        )
    ]
    if profile.get("Summary"):
        sections.append("Summary:\n" + truncate(clean(profile["Summary"]), 1000))

    positions = [
        f"{row.get('Title', '')} at {row.get('Company Name', '')}{period(row, 'Started On', 'Finished On')}"
        + (
            f": {truncate(clean(row['Description']), 250)}"
            if row.get("Description")
            else ""
        )
        for row in tables.get("positions.csv", [])[:max_positions]
    ]
    if positions:
        sections.append("Experience:\n" + bullet_lines(positions))

    education = [
        ", ".join(filter(None, [row.get("Degree Name"), row.get("School Name")]))
        + period(row, "Start Date", "End Date")
        for row in tables.get("education.csv", [])
    ]
    if education:
        sections.append("Education:\n" + bullet_lines(education))

    certifications = [
        ", ".join(filter(None, [row.get("Name"), row.get("Authority")]))
        for row in tables.get("certifications.csv", [])
    ]
    if certifications:
        sections.append("Certifications:\n" + bullet_lines(certifications))

    projects = [
        row.get("Title", "")
        + (
            f": {truncate(clean(row['Description']), 200)}"
            if row.get("Description")
            else ""
        )
        for row in tables.get("projects.csv", [])
    ]
    if projects:
        sections.append("Projects:\n" + bullet_lines(projects))

    skills = [
        row.get("Name", "") for row in tables.get("skills.csv", []) if row.get("Name")
    ]
    if skills:
        sections.append("Skills: " + ", ".join(skills[:30]))

    languages = [
        row.get("Name", "")
        + (f" ({row['Proficiency']})" if row.get("Proficiency") else "")
        for row in tables.get("languages.csv", [])
    ]
    if languages:
        sections.append("Languages: " + ", ".join(languages))

    return name, "\n\n".join(sections)


def from_pdf(source: Path) -> tuple[str, str]:
    if not shutil.which("pdftotext"):
        fail(
            "pdftotext is required for PDF files (macOS: brew install poppler, Debian: apt install poppler-utils)"
        )
    text = subprocess.run(
        ["pdftotext", "-layout", str(source), "-"],
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    # LinkedIn PDFs end every page with "Page N of M".
    lines = [line for line in text.splitlines() if not line.strip().startswith("Page ")]
    body = clean("\n".join(lines))
    name = next((line.strip() for line in lines if line.strip()), "LinkedIn profile")
    return name, body


def main() -> None:
    parser = base_parser(__doc__.splitlines()[0])
    parser.add_argument(
        "source",
        type=Path,
        help="LinkedIn export ZIP, extracted folder, or profile PDF",
    )
    parser.add_argument(
        "--positions", type=int, default=6, help="positions to include (default: 6)"
    )
    args = parser.parse_args()

    source: Path = args.source.expanduser()
    if not source.exists():
        fail(f"{source} does not exist")
    if source.suffix.lower() == ".pdf":
        name, body = from_pdf(source)
    elif source.is_dir() or zipfile.is_zipfile(source):
        name, body = from_export(source, args.positions)
    else:
        fail("use a LinkedIn data export (ZIP or folder) or a profile PDF")
        return

    append_to_context("resumeLinkedin", f"LinkedIn profile: {name}", body, args)


if __name__ == "__main__":
    main()
