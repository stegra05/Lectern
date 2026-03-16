from __future__ import annotations

import logging
import re
import uuid
import warnings
from dataclasses import dataclass, field
from html import unescape
from typing import Any, Callable, Dict, Generator, Iterable, List, Optional

from lectern.ai_pacing import PacingState
from lectern.coverage import (
    build_generation_gap_text,
    build_reflection_gap_text,
    compute_coverage_data,
    get_card_concept_ids,
    get_card_page_references,
    get_card_relation_keys,
)
from lectern.utils.error_handling import capture_exception

logger = logging.getLogger(__name__)

# Default values for reflection configuration
_HTML_RE = re.compile(r"<[^>]+>")
_WHITESPACE_RE = re.compile(r"\s+")
_CLOZE_RE = re.compile(r"\{\{c\d+::(.*?)(?:::[^}]*)?\}\}")
_NON_WORD_RE = re.compile(r"[^\w\s]")


def get_card_key(card: Dict[str, Any]) -> str:
    fields = card.get("fields") or {}
    val = str(
        card.get("text")
        or card.get("front")
        or fields.get("Text")
        or fields.get("Front")
        or ""
    )
    val = _strip_markup(val)
    val = _CLOZE_RE.sub(r"\1", val)
    val = _NON_WORD_RE.sub(" ", val)
    return " ".join(val.lower().split())


def _strip_markup(value: str) -> str:
    return _WHITESPACE_RE.sub(
        " ", _HTML_RE.sub(" ", unescape(str(value or "")))
    ).strip()


def _get_card_field(card: Dict[str, Any], field_name: str) -> str:
    fields = card.get("fields") or {}
    if isinstance(fields, dict):
        return str(fields.get(field_name) or "")
    return ""


def _get_card_front(card: Dict[str, Any]) -> str:
    return str(
        card.get("front")
        or _get_card_field(card, "Front")
        or card.get("text")
        or _get_card_field(card, "Text")
        or ""
    )


def _get_card_back(card: Dict[str, Any]) -> str:
    return str(card.get("back") or _get_card_field(card, "Back") or "")


def _estimate_card_quality(
    card: Dict[str, Any],
    *,
    high_priority_ids: set[str] | None = None,
) -> tuple[float, List[str]]:
    high_priority_ids = high_priority_ids or set()
    flags: List[str] = []
    score = 30.0

    front = _strip_markup(_get_card_front(card))
    back = _strip_markup(_get_card_back(card))
    text = _strip_markup(str(card.get("text") or _get_card_field(card, "Text") or ""))
    answer_text = text or back
    source_pages = get_card_page_references(card)
    concept_ids = get_card_concept_ids(card)
    relation_keys = get_card_relation_keys(card)
    rationale = _strip_markup(str(card.get("rationale") or ""))
    source_excerpt = _strip_markup(str(card.get("source_excerpt") or ""))

    if front or text:
        score += 12
    else:
        flags.append("missing_prompt_text")
        score -= 20

    if answer_text:
        score += 10
    else:
        flags.append("missing_answer_text")
        score -= 15

    if source_pages:
        score += 12
    else:
        flags.append("missing_source_pages")
        score -= 10

    if concept_ids:
        score += 12
    else:
        flags.append("missing_concept_ids")
        score -= 8

    if relation_keys:
        score += 6

    if rationale:
        score += 7
    else:
        flags.append("missing_rationale")
        score -= 4

    if source_excerpt:
        score += 6
    else:
        flags.append("missing_source_excerpt")
        score -= 4

    if card.get("slide_number"):
        score += 3

    if len(front) > 180:
        flags.append("long_front")
        score -= 8
    if len(answer_text) > 420:
        flags.append("long_answer")
        score -= 8
    if len(source_pages) > 3:
        flags.append("broad_grounding")
        score -= 3
    if high_priority_ids.intersection(concept_ids):
        score += 5

    return max(0.0, min(100.0, score)), sorted(set(flags))


def _annotate_card_quality(
    card: Dict[str, Any],
    *,
    high_priority_ids: set[str] | None = None,
) -> Dict[str, Any]:
    annotated = dict(card)
    score, flags = _estimate_card_quality(
        annotated, high_priority_ids=high_priority_ids
    )
    annotated["quality_score"] = round(score, 1)
    annotated["quality_flags"] = flags
    return annotated


def _coverage_is_sufficient(coverage_data: Dict[str, Any]) -> bool:
    high_priority_total = int(coverage_data.get("high_priority_total") or 0)
    high_priority_covered = int(coverage_data.get("high_priority_covered") or 0)
    high_priority_ok = (
        high_priority_total == 0 or high_priority_covered >= high_priority_total
    )
    page_pct = float(coverage_data.get("page_coverage_pct") or 0)
    explicit_concept_pct = float(
        coverage_data.get("explicit_concept_coverage_pct") or 0
    )
    relation_pct = float(coverage_data.get("relation_coverage_pct") or 0)
    total_relations = int(coverage_data.get("total_relations") or 0)
    relation_ok = total_relations == 0 or relation_pct >= 50
    return (
        high_priority_ok
        and relation_ok
        and (explicit_concept_pct >= 60 or page_pct >= 75)
    )


def _select_best_reflection_cards(
    *,
    original_cards: List[Dict[str, Any]],
    reflected_cards: List[Dict[str, Any]],
    limit: int,
    concept_map: Dict[str, Any],
    total_pages: int,
) -> tuple[List[Dict[str, Any]], Dict[str, Any]]:
    baseline = compute_coverage_data(
        cards=[], concept_map=concept_map, total_pages=total_pages
    )
    high_priority_ids = {
        str(item.get("id") or "").strip()
        for item in (baseline.get("missing_high_priority") or [])
        if str(item.get("id") or "").strip()
    }
    candidates: List[Dict[str, Any]] = []
    for card in original_cards + reflected_cards:
        if not isinstance(card, dict):
            continue
        annotated = _annotate_card_quality(card, high_priority_ids=high_priority_ids)
        if get_card_key(annotated):
            candidates.append(annotated)

    selected: List[Dict[str, Any]] = []
    selected_keys: set[str] = set()
    selected_pages: set[int] = set()
    selected_concepts: set[str] = set()
    selected_relations: set[str] = set()
    per_page_counts: Dict[int, int] = {}

    def candidate_priority(card: Dict[str, Any]) -> float:
        base_score = float(card.get("quality_score") or 0.0)
        pages = set(get_card_page_references(card))
        concepts = set(get_card_concept_ids(card))
        relations = set(get_card_relation_keys(card))
        new_pages = pages.difference(selected_pages)
        new_concepts = concepts.difference(selected_concepts)
        new_relations = relations.difference(selected_relations)
        new_high_priority = high_priority_ids.intersection(new_concepts)
        saturation_penalty = sum(
            max((per_page_counts.get(page, 0) + 1) - 2, 0) for page in pages
        )
        return (
            base_score
            + len(new_high_priority) * 8.0
            + len(new_concepts) * 4.0
            + len(new_relations) * 3.0
            + len(new_pages) * 1.5
            - saturation_penalty * 6.0
        )

    remaining = list(candidates)
    while remaining and len(selected) < limit:
        best_idx = -1
        best_priority = float("-inf")
        for idx, card in enumerate(remaining):
            card_key = get_card_key(card)
            if not card_key or card_key in selected_keys:
                continue
            priority = candidate_priority(card)
            if priority > best_priority:
                best_priority = priority
                best_idx = idx
        if best_idx < 0:
            break
        chosen = remaining.pop(best_idx)
        selected.append(chosen)
        selected_keys.add(get_card_key(chosen))
        pages = get_card_page_references(chosen)
        selected_pages.update(pages)
        selected_concepts.update(get_card_concept_ids(chosen))
        selected_relations.update(get_card_relation_keys(chosen))
        for page in pages:
            per_page_counts[page] = per_page_counts.get(page, 0) + 1

    if not selected:
        selected = [
            _annotate_card_quality(card, high_priority_ids=high_priority_ids)
            for card in original_cards[:limit]
        ]

    selected_coverage = compute_coverage_data(
        cards=selected,
        concept_map=concept_map,
        total_pages=total_pages,
    )
    original_coverage = compute_coverage_data(
        cards=original_cards,
        concept_map=concept_map,
        total_pages=total_pages,
    )
    selected_avg = round(
        sum(float(card.get("quality_score") or 0.0) for card in selected)
        / max(len(selected), 1),
        1,
    )
    original_avg = round(
        sum(
            float(
                _annotate_card_quality(card, high_priority_ids=high_priority_ids).get(
                    "quality_score"
                )
                or 0.0
            )
            for card in original_cards
        )
        / max(len(original_cards), 1),
        1,
    )
    return selected, {
        "selected_avg_quality": selected_avg,
        "original_avg_quality": original_avg,
        "quality_delta": round(selected_avg - original_avg, 1),
        "page_coverage_delta": int(selected_coverage.get("covered_page_count", 0))
        - int(original_coverage.get("covered_page_count", 0)),
        "concept_coverage_delta": int(
            selected_coverage.get("explicit_concept_count", 0)
        )
        - int(original_coverage.get("explicit_concept_count", 0)),
        "relation_coverage_delta": int(
            selected_coverage.get("explicit_relation_count", 0)
        )
        - int(original_coverage.get("explicit_relation_count", 0)),
    }


def _rebuild_seen_keys(cards: List[Dict[str, Any]]) -> set[str]:
    return {key for key in (get_card_key(card) for card in cards) if key}


def collect_card_fronts(cards: List[Dict[str, Any]]) -> List[str]:
    """Collect all card fronts from a list of cards."""
    return [_get_card_front(c) for c in cards if _get_card_front(c)]
