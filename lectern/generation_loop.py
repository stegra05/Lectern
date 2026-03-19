from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import Any, Dict, List, Literal

from lectern.card_quality import CardQualityEvaluator, _get_card_front, _strip_markup
from lectern.coverage import (
    compute_coverage_data,
    get_card_concept_ids,
    get_card_page_references,
    get_card_relation_keys,
)
from lectern.domain_types import CardData, ConceptMapData, CoverageData

logger = logging.getLogger(__name__)

# Default values for reflection configuration
_CLOZE_RE = re.compile(r"\{\{c\d+::(.*?)(?:::[^}]*)?\}\}")
_NON_WORD_RE = re.compile(r"[^\w\s]")
_CARD_QUALITY_EVALUATOR = CardQualityEvaluator()


def get_card_key(card: CardData) -> str:
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

def _estimate_card_quality(
    card: CardData,
    *,
    high_priority_ids: set[str] | None = None,
) -> tuple[float, List[str]]:
    score, flags = _CARD_QUALITY_EVALUATOR.evaluate(
        card, high_priority_ids=high_priority_ids
    )
    return score, flags


def _annotate_card_quality(
    card: CardData,
    *,
    high_priority_ids: set[str] | None = None,
) -> CardData:
    annotated = dict(card)
    score, flags = _estimate_card_quality(
        annotated, high_priority_ids=high_priority_ids
    )
    annotated["quality_score"] = round(score, 1)
    annotated["quality_flags"] = flags
    return annotated


@dataclass(frozen=True)
class RepairResult:
    input_card_key: str
    status: Literal["ok", "invalid_payload", "missing_output"]
    card: CardData | None = None


_GROUNDING_PROVENANCE_FLAGS = (
    "missing_source_excerpt",
    "missing_rationale",
    "missing_source_pages",
)


def evaluate_grounding_gate(
    card: CardData, *, min_quality: float
) -> tuple[bool, list[str]]:
    reasons: list[str] = []
    flags = set(card.get("quality_flags") or [])
    for provenance_flag in _GROUNDING_PROVENANCE_FLAGS:
        if provenance_flag in flags:
            reasons.append(provenance_flag)
    if float(card.get("quality_score") or 0.0) < min_quality:
        reasons.append("below_quality_threshold")
    return not reasons, reasons


def partition_by_gate(
    cards: list[CardData], *, min_quality: float
) -> tuple[list[CardData], list[CardData]]:
    promotable: list[CardData] = []
    needs_repair: list[CardData] = []
    for card in cards:
        passes, _ = evaluate_grounding_gate(card, min_quality=min_quality)
        if passes:
            promotable.append(card)
        else:
            needs_repair.append(card)
    return promotable, needs_repair


def _coverage_is_sufficient(coverage_data: CoverageData) -> bool:
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


@dataclass(frozen=True)
class ReflectionScoringWeights:
    high_priority_concept: float = 8.0
    new_concept: float = 4.0
    new_relation: float = 3.0
    new_page: float = 1.5
    saturation_penalty: float = 6.0


class CardPriorityScorer:
    def __init__(self, weights: ReflectionScoringWeights | None = None):
        self.weights = weights or ReflectionScoringWeights()

    def score(
        self,
        *,
        card: CardData,
        selected_pages: set[int],
        selected_concepts: set[str],
        selected_relations: set[str],
        per_page_counts: dict[int, int],
        high_priority_ids: set[str],
    ) -> float:
        base_score = float(card.get("quality_score") or 0.0)
        pages = set(get_card_page_references(card))
        concepts = set(get_card_concept_ids(card))
        relations = set(get_card_relation_keys(card))
        new_pages = pages.difference(selected_pages)
        new_concepts = concepts.difference(selected_concepts)
        new_relations = relations.difference(selected_relations)
        new_high_priority = high_priority_ids.intersection(new_concepts)
        saturation = sum(
            max((per_page_counts.get(page, 0) + 1) - 2, 0) for page in pages
        )
        return (
            base_score
            + len(new_high_priority) * self.weights.high_priority_concept
            + len(new_concepts) * self.weights.new_concept
            + len(new_relations) * self.weights.new_relation
            + len(new_pages) * self.weights.new_page
            - saturation * self.weights.saturation_penalty
        )


def _select_best_reflection_cards(
    *,
    original_cards: List[CardData],
    reflected_cards: List[CardData],
    limit: int,
    concept_map: ConceptMapData,
    total_pages: int,
    scorer: CardPriorityScorer | None = None,
) -> tuple[List[CardData], Dict[str, Any]]:
    scorer = scorer or CardPriorityScorer()
    baseline = compute_coverage_data(
        cards=[], concept_map=concept_map, total_pages=total_pages
    )
    high_priority_ids = {
        str(item.get("id") or "").strip()
        for item in (baseline.get("missing_high_priority") or [])
        if str(item.get("id") or "").strip()
    }
    candidates: List[CardData] = []
    for card in original_cards + reflected_cards:
        if not isinstance(card, dict):
            continue
        annotated = _annotate_card_quality(card, high_priority_ids=high_priority_ids)
        if get_card_key(annotated):
            candidates.append(annotated)

    selected: List[CardData] = []
    selected_keys: set[str] = set()
    selected_pages: set[int] = set()
    selected_concepts: set[str] = set()
    selected_relations: set[str] = set()
    per_page_counts: dict[int, int] = {}

    remaining = list(candidates)
    while remaining and len(selected) < limit:
        best_idx = -1
        best_priority = float("-inf")
        for idx, card in enumerate(remaining):
            card_key = get_card_key(card)
            if not card_key or card_key in selected_keys:
                continue
            priority = scorer.score(
                card=card,
                selected_pages=selected_pages,
                selected_concepts=selected_concepts,
                selected_relations=selected_relations,
                per_page_counts=per_page_counts,
                high_priority_ids=high_priority_ids,
            )
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


def _rebuild_seen_keys(cards: List[CardData]) -> set[str]:
    return {key for key in (get_card_key(card) for card in cards) if key}


def collect_card_fronts(cards: List[CardData]) -> List[str]:
    """Collect all card fronts from a list of cards."""
    return [_get_card_front(c) for c in cards if _get_card_front(c)]
