#!/usr/bin/env python3
"""Summarize a GitHub user (profile, profile README, top repositories) into context.txt.

Usage:
  python3 resumeGithub.py <username> [--repos 8] [--dry-run]

Uses the public GitHub API. Set GITHUB_TOKEN to raise the rate limit (60 -> 5000 requests/hour).
"""

from __future__ import annotations

import html
import os
import re
import urllib.parse
from collections import Counter

from tools.context_tools import (
    append_to_context,
    base_parser,
    bullet_lines,
    clean,
    fail,
    get_json,
    request,
    truncate,
)

API = "https://api.github.com"


def headers() -> dict[str, str]:
    result = {
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    token = os.environ.get("GITHUB_TOKEN")
    if token:
        result["Authorization"] = f"Bearer {token}"
    return result


def profile_readme(username: str) -> str:
    try:
        raw = request(
            f"{API}/repos/{username}/{username}/readme",
            headers={**headers(), "Accept": "application/vnd.github.raw+json"},
        ).decode("utf-8", "replace")
    except RuntimeError:
        return ""
    # Drop comments, images, HTML tags, badges and link targets, keep the readable text.
    raw = re.sub(r"<!--[\s\S]*?(-->|$)", "", raw)
    raw = re.sub(r"!\[[^\]]*\]\([^)]*\)", "", raw)
    raw = re.sub(r"<[^>]+>", "", raw)
    raw = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", raw)
    raw = re.sub(r"^\s*(#+\s*|```\w*\s*$)", "", raw, flags=re.MULTILINE)
    raw = html.unescape(raw).replace("\xa0", " ")
    return clean(
        "\n".join(
            line
            for line in raw.splitlines()
            if re.search(r"\w", line) or not line.strip()
        )
    )


def main() -> None:
    parser = base_parser(__doc__.splitlines()[0])
    parser.add_argument("username")
    parser.add_argument(
        "--repos", type=int, default=8, help="repositories to include (default: 8)"
    )
    args = parser.parse_args()

    username = urllib.parse.quote(args.username.strip().lstrip("@"))
    try:
        user = get_json(f"{API}/users/{username}", headers=headers())
        repos = get_json(
            f"{API}/users/{username}/repos?per_page=100&type=owner&sort=updated",
            headers=headers(),
        )
    except RuntimeError as error:
        fail(str(error))
        return

    assert isinstance(user, dict) and isinstance(repos, list)
    own = [repo for repo in repos if not repo.get("fork") and not repo.get("archived")]
    top = sorted(
        own,
        key=lambda repo: (repo.get("stargazers_count", 0), repo.get("pushed_at", "")),
        reverse=True,
    )
    languages = Counter(repo["language"] for repo in own if repo.get("language"))

    facts = [
        f"Name: {user.get('name') or user.get('login')}",
        f"GitHub: {user.get('html_url')}",
        f"Bio: {user['bio']}" if user.get("bio") else "",
        f"Company: {user['company']}" if user.get("company") else "",
        f"Location: {user['location']}" if user.get("location") else "",
        f"Website: {user['blog']}" if user.get("blog") else "",
        f"Public repositories: {user.get('public_repos', 0)}, followers: {user.get('followers', 0)}",
        "Main languages: " + ", ".join(name for name, _ in languages.most_common(6))
        if languages
        else "",
    ]

    sections = [bullet_lines(facts)]
    readme = profile_readme(username)
    if readme:
        sections.append("Profile README:\n" + truncate(readme, 1200))

    if top:
        lines = []
        for repo in top[: args.repos]:
            details = [
                repo.get("language") or "",
                f"{repo.get('stargazers_count', 0)} stars",
            ]
            line = f"{repo['name']} ({', '.join(d for d in details if d)})"
            if repo.get("description"):
                line += f": {repo['description']}"
            if repo.get("topics"):
                line += f" [topics: {', '.join(repo['topics'][:6])}]"
            if repo.get("homepage"):
                line += f" - {repo['homepage']}"
            lines.append(line)
        sections.append("Notable repositories:\n" + bullet_lines(lines))

    append_to_context(
        "resumeGithub",
        f"GitHub profile: {user.get('login')}",
        "\n\n".join(sections),
        args,
    )


if __name__ == "__main__":
    main()
