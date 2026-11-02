#!/usr/bin/env python3
"""Summarize a website (home page plus about, FAQ, pricing, contact... pages) into context.txt.

Usage:
  python3 resumeWebsite.py https://zll.me [--pages 5] [--dry-run]

Only follows links on the same domain whose path looks useful for customers, and respects
robots.txt.
"""

from __future__ import annotations

import re
import urllib.parse
import urllib.robotparser
from html.parser import HTMLParser

from tools.context_tools import USER_AGENT, append_to_context, base_parser, clean, fail, request, truncate

USEFUL_PATHS = re.compile(
    r"about|company|team|faq|help|support|pricing|price|plans|services|products|contact|"
    r"shipping|delivery|returns|refund|policy|terms|hours|location|menu|"
    r"sobre|nosotros|empresa|preguntas|ayuda|precios|tarifas|servicios|productos|contacto|envios|devoluciones|horario",
    re.IGNORECASE,
)
SKIP_TAGS = {"script", "style", "noscript", "svg", "nav", "footer", "header", "form", "iframe", "template"}
BLOCK_TAGS = {"p", "div", "section", "article", "li", "br", "h1", "h2", "h3", "h4", "h5", "h6", "tr", "dd", "dt"}


class PageParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.links: list[str] = []
        self.title = ""
        self.description = ""
        self._skip = 0
        self._in_title = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = dict(attrs)
        if tag in SKIP_TAGS:
            self._skip += 1
        elif tag == "title":
            self._in_title = True
        elif tag == "a" and values.get("href"):
            self.links.append(values["href"] or "")
        elif tag == "meta" and (values.get("name") or "").lower() == "description":
            self.description = values.get("content") or ""
        if tag in BLOCK_TAGS:
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in SKIP_TAGS and self._skip:
            self._skip -= 1
        elif tag == "title":
            self._in_title = False
        if tag in BLOCK_TAGS:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if self._in_title:
            self.title += data
        elif not self._skip:
            self.parts.append(data)

    def text(self) -> str:
        lines = [line.strip() for line in "".join(self.parts).splitlines()]
        # Drop very short fragments (menu items, buttons) and repeated lines.
        seen: set[str] = set()
        kept = []
        for line in lines:
            if len(line) < 25 or line in seen:
                continue
            seen.add(line)
            kept.append(line)
        return "\n".join(kept)


def fetch(url: str) -> PageParser:
    html = request(url, headers={"Accept": "text/html"}).decode("utf-8", "replace")
    parser = PageParser()
    parser.feed(html)
    return parser


def main() -> None:
    parser = base_parser(__doc__.splitlines()[0])
    parser.add_argument("url")
    parser.add_argument("--pages", type=int, default=5, help="extra pages to read (default: 5)")
    parser.add_argument("--per-page", type=int, default=1200, help="characters per page (default: 1200)")
    args = parser.parse_args()

    start = args.url if "://" in args.url else f"https://{args.url}"
    origin = urllib.parse.urlsplit(start)
    if origin.scheme not in ("http", "https"):
        fail("only http and https URLs are supported")

    robots = urllib.robotparser.RobotFileParser(f"{origin.scheme}://{origin.netloc}/robots.txt")
    try:
        robots.read()
    except Exception:
        robots = None

    def allowed(url: str) -> bool:
        return robots is None or robots.can_fetch(USER_AGENT, url)

    if not allowed(start):
        fail(f"robots.txt does not allow reading {start}")
    try:
        home = fetch(start)
    except RuntimeError as error:
        fail(str(error))
        return

    candidates: list[str] = []
    for href in home.links:
        url = urllib.parse.urljoin(start, href).split("#")[0].rstrip("/")
        parts = urllib.parse.urlsplit(url)
        if (
            parts.netloc == origin.netloc
            and USEFUL_PATHS.search(parts.path)
            and url not in candidates
            and url != start.rstrip("/")
            and not re.search(r"\.(pdf|jpe?g|png|gif|zip|mp4)$", parts.path, re.IGNORECASE)
        ):
            candidates.append(url)

    name = clean(home.title) or origin.netloc
    sections = [f"Website: {start}"]
    if home.description:
        sections.append(f"Description: {clean(home.description)}")
    sections.append("Home page:\n" + truncate(home.text(), args.per_page))

    for url in candidates[: args.pages]:
        if not allowed(url):
            continue
        try:
            page = fetch(url)
        except RuntimeError as error:
            print(f"skipped {url}: {error}")
            continue
        text = page.text()
        if text:
            title = clean(page.title) or urllib.parse.urlsplit(url).path
            sections.append(f"{title} ({url}):\n" + truncate(text, args.per_page))
            print(f"read {url}")

    append_to_context("resumeWebsite", f"Website: {name}", "\n\n".join(sections), args)


if __name__ == "__main__":
    main()
