"""Shared helpers for the resume* scripts.

Every script collects information, formats it as plain text, and appends it to the end of
context/context.txt. Nothing is overwritten. Each block is marked with its source and date so
it is easy to find, review, and delete.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_CONTEXT = ROOT / "../context" / "context.txt"
USER_AGENT = "itsme-context-tools/1.0 (+https://github.com/ZhengLinLei/itsme)"
MAX_DOWNLOAD_BYTES = 5_000_000
# Small local models have a short context window (OLLAMA_CONTEXT_LENGTH=4096 tokens), and the
# conversation history needs room too.
CONTEXT_WARN_CHARS = 8_000


def base_parser(description: str) -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=description)
    parser.add_argument(
        "--context",
        type=Path,
        default=DEFAULT_CONTEXT,
        help=f"context file to append to (default: {DEFAULT_CONTEXT.relative_to(ROOT)})",
    )
    parser.add_argument(
        "--max-chars",
        type=int,
        default=4000,
        help="maximum characters to append (default: 4000)",
    )
    parser.add_argument(
        "--dry-run", action="store_true", help="print the block instead of appending it"
    )
    return parser


def fail(message: str) -> None:
    print(f"error: {message}", file=sys.stderr)
    sys.exit(1)


def request(
    url: str,
    *,
    headers: dict[str, str] | None = None,
    data: bytes | None = None,
    method: str | None = None,
    timeout: int = 20,
) -> bytes:
    req = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={"User-Agent": USER_AGENT, **(headers or {})},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            body = response.read(MAX_DOWNLOAD_BYTES + 1)
    except urllib.error.HTTPError as error:
        detail = error.read(2000).decode("utf-8", "replace")
        raise RuntimeError(f"{url} returned HTTP {error.code}: {detail}") from None
    except urllib.error.URLError as error:
        raise RuntimeError(f"could not reach {url}: {error.reason}") from None
    if len(body) > MAX_DOWNLOAD_BYTES:
        raise RuntimeError(f"{url} is larger than {MAX_DOWNLOAD_BYTES} bytes")
    return body


def get_json(url: str, **kwargs) -> object:
    return json.loads(request(url, **kwargs).decode("utf-8"))


def clean(text: str | None) -> str:
    """Collapse whitespace while keeping paragraph breaks."""
    if not text:
        return ""
    text = re.sub(r"[ \t\r\f\v]+", " ", text)
    text = re.sub(r"\n\s*\n\s*", "\n\n", text)
    return text.strip()


def truncate(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    cut = text[:limit].rsplit(" ", 1)[0]
    return f"{cut}..."


def bullet_lines(items: list[str]) -> str:
    return "\n".join(f"- {item}" for item in items if item)


def append_to_context(
    tool: str, title: str, body: str, args: argparse.Namespace
) -> None:
    body = truncate(clean(body), args.max_chars)
    if not body:
        fail("nothing to add: no information was found")

    stamp = dt.datetime.now().strftime("%Y-%m-%d %H:%M")
    block = (
        f"\n\n### {title}\n[added by {tool} on {stamp} - review before use]\n{body}\n"
    )

    if args.dry_run:
        print(block.strip())
        return

    path: Path = args.context
    path.parent.mkdir(parents=True, exist_ok=True)
    existing = path.read_text(encoding="utf-8") if path.exists() else ""
    with path.open("a", encoding="utf-8") as file:
        file.write(block if existing.strip() else block.lstrip())

    total = len(existing) + len(block)
    print(f'Appended {len(block.strip())} characters to {path} (section: "{title}").')
    print(
        "\n>> Please review the new section now. The API reloads the file automatically, so the\n"
        "   assistant already uses it: fix anything wrong and remove anything private."
    )
    if total > CONTEXT_WARN_CHARS:
        print(
            f"\n>> The context file has {total} characters. Small local models may forget part of"
            "\n   it: shorten it, raise OLLAMA_CONTEXT_LENGTH, or use a bigger model."
        )
