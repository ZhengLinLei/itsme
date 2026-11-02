#!/usr/bin/env python3
"""Summarize a Google Business Profile (Google Maps place) into context.txt.

Usage:
  python3 resumeGoogleBusiness.py "Business name, city" [--reviews 3] [--language en]
  python3 resumeGoogleBusiness.py --place-id ChIJ... [--dry-run]

Uses the Google Places API (New). Create a key in Google Cloud with "Places API (New)" enabled
and export it as GOOGLE_MAPS_API_KEY (or pass --key). Reviewer names are never copied.
"""

from __future__ import annotations

import json
import os
import urllib.parse

from tools.context_tools import (
    append_to_context,
    base_parser,
    bullet_lines,
    clean,
    fail,
    get_json,
    truncate,
)

API = "https://places.googleapis.com/v1"
DETAIL_FIELDS = ",".join(
    [
        "id",
        "displayName",
        "formattedAddress",
        "nationalPhoneNumber",
        "internationalPhoneNumber",
        "websiteUri",
        "googleMapsUri",
        "regularOpeningHours",
        "rating",
        "userRatingCount",
        "priceLevel",
        "editorialSummary",
        "reviews",
        "businessStatus",
        "primaryTypeDisplayName",
        "paymentOptions",
        "accessibilityOptions",
        "parkingOptions",
        "delivery",
        "dineIn",
        "takeout",
        "reservable",
    ]
)
PRICE_LEVELS = {
    "PRICE_LEVEL_FREE": "free",
    "PRICE_LEVEL_INEXPENSIVE": "inexpensive",
    "PRICE_LEVEL_MODERATE": "moderate",
    "PRICE_LEVEL_EXPENSIVE": "expensive",
    "PRICE_LEVEL_VERY_EXPENSIVE": "very expensive",
}


def text_of(value: object) -> str:
    return value.get("text", "") if isinstance(value, dict) else ""


def find_place(query: str, key: str, language: str) -> str:
    result = get_json(
        f"{API}/places:searchText",
        method="POST",
        data=json.dumps({"textQuery": query, "languageCode": language}).encode(),
        headers={
            "Content-Type": "application/json",
            "X-Goog-Api-Key": key,
            "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress",
        },
    )
    places = result.get("places", []) if isinstance(result, dict) else []
    if not places:
        fail(f'no place found for "{query}"')
    if len(places) > 1:
        print(
            "Several places matched, using the first one. Use --place-id to pick another:"
        )
        for place in places[:5]:
            print(
                f"  {place['id']}  {text_of(place.get('displayName'))} - {place.get('formattedAddress', '')}"
            )
    return places[0]["id"]


def yes_options(options: object) -> str:
    if not isinstance(options, dict):
        return ""
    names = [
        name[0].upper()
        + "".join(f" {c.lower()}" if c.isupper() else c for c in name[1:])
        for name, enabled in options.items()
        if enabled is True
    ]
    return ", ".join(names)


def main() -> None:
    parser = base_parser(__doc__.splitlines()[0])
    parser.add_argument(
        "query", nargs="?", help='business name and city, e.g. "Cafe Central, Madrid"'
    )
    parser.add_argument("--place-id", help="Google place id (skips the search)")
    parser.add_argument(
        "--key", default=os.environ.get("GOOGLE_MAPS_API_KEY"), help="Places API key"
    )
    parser.add_argument(
        "--language", default="en", help="language of the results (default: en)"
    )
    parser.add_argument(
        "--reviews", type=int, default=3, help="reviews to include (default: 3, max: 5)"
    )
    args = parser.parse_args()

    if not args.key:
        fail("set GOOGLE_MAPS_API_KEY or pass --key")
    if not args.query and not args.place_id:
        fail("pass a search query or --place-id")

    try:
        place_id = args.place_id or find_place(args.query, args.key, args.language)
        place = get_json(
            f"{API}/places/{urllib.parse.quote(place_id)}?languageCode={urllib.parse.quote(args.language)}",
            headers={"X-Goog-Api-Key": args.key, "X-Goog-FieldMask": DETAIL_FIELDS},
        )
    except RuntimeError as error:
        fail(str(error))
        return
    assert isinstance(place, dict)

    name = text_of(place.get("displayName")) or "Business"
    services = [
        label
        for field, label in [
            ("delivery", "delivery"),
            ("takeout", "takeout"),
            ("dineIn", "dine-in"),
            ("reservable", "reservations"),
        ]
        if place.get(field) is True
    ]
    rating = (
        f"Google rating: {place['rating']}/5 from {place.get('userRatingCount', 0)} reviews"
        if place.get("rating")
        else ""
    )
    facts = [
        f"Name: {name}",
        f"Category: {text_of(place.get('primaryTypeDisplayName'))}"
        if place.get("primaryTypeDisplayName")
        else "",
        f"Address: {place['formattedAddress']}"
        if place.get("formattedAddress")
        else "",
        f"Phone: {place.get('internationalPhoneNumber') or place.get('nationalPhoneNumber')}"
        if place.get("internationalPhoneNumber") or place.get("nationalPhoneNumber")
        else "",
        f"Website: {place['websiteUri']}" if place.get("websiteUri") else "",
        f"Google Maps: {place['googleMapsUri']}" if place.get("googleMapsUri") else "",
        f"Status: {place['businessStatus'].replace('_', ' ').lower()}"
        if place.get("businessStatus") not in (None, "OPERATIONAL")
        else "",
        f"Price level: {PRICE_LEVELS.get(place.get('priceLevel', ''), '')}"
        if place.get("priceLevel") in PRICE_LEVELS
        else "",
        rating,
        f"Services: {', '.join(services)}" if services else "",
        f"Payment: {yes_options(place.get('paymentOptions'))}"
        if yes_options(place.get("paymentOptions"))
        else "",
        f"Accessibility: {yes_options(place.get('accessibilityOptions'))}"
        if yes_options(place.get("accessibilityOptions"))
        else "",
        f"Parking: {yes_options(place.get('parkingOptions'))}"
        if yes_options(place.get("parkingOptions"))
        else "",
    ]
    sections = [bullet_lines(facts)]

    if text_of(place.get("editorialSummary")):
        sections.append("Description: " + text_of(place.get("editorialSummary")))

    hours = (place.get("regularOpeningHours") or {}).get("weekdayDescriptions") or []
    if hours:
        sections.append("Opening hours:\n" + bullet_lines(hours))

    reviews = []
    for review in (place.get("reviews") or [])[: max(0, min(args.reviews, 5))]:
        text = clean(text_of(review.get("originalText")) or text_of(review.get("text")))
        if text:
            reviews.append(f"{review.get('rating', '?')}/5: {truncate(text, 280)}")
    if reviews:
        sections.append(
            "What customers say (recent reviews):\n" + bullet_lines(reviews)
        )

    append_to_context(
        "resumeGoogleBusiness", f"Business: {name}", "\n\n".join(sections), args
    )


if __name__ == "__main__":
    main()
