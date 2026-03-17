from __future__ import annotations

import re
from dataclasses import dataclass, field
from html import unescape
from typing import Any, Protocol

from lectern.coverage import (
    get_card_concept_ids,
    get_card_page_references,
    get_card_relation_keys,
)

_HTML_RE = re.compile(r"<[^>]+>")
_WHITESPACE_RE = re.compile(r"\s+")


def _strip_markup(value: str) -> str:
    return _WHITESPACE_RE.sub(
        " ", _HTML_RE.sub(" ", unescape(str(value or "")))
    ).strip()


def _get_card_field(card: dict[str, Any], field_name: str) -> str:
    fields = card.get("fields") or {}
    if isinstance(fields, dict):
        return str(fields.get(field_name) or "")
    return ""


def _get_card_front(card: dict[str, Any]) -> str:
    return str(
        card.get("front")
        or _get_card_field(card, "Front")
        or card.get("text")
        or _get_card_field(card, "Text")
        or ""
    )


def _get_card_back(card: dict[str, Any]) -> str:
    return str(card.get("back") or _get_card_field(card, "Back") or "")


@dataclass(frozen=True)
class CardQualityWeights:
    base_score: float = 30.0
    prompt_present_bonus: float = 12.0
    prompt_missing_penalty: float = 20.0
    answer_present_bonus: float = 10.0
    answer_missing_penalty: float = 15.0
    source_pages_present_bonus: float = 12.0
    source_pages_missing_penalty: float = 10.0
    concept_ids_present_bonus: float = 12.0
    concept_ids_missing_penalty: float = 8.0
    relation_keys_present_bonus: float = 6.0
    rationale_present_bonus: float = 7.0
    rationale_missing_penalty: float = 4.0
    source_excerpt_present_bonus: float = 6.0
    source_excerpt_missing_penalty: float = 4.0
    slide_number_bonus: float = 3.0
    long_front_penalty: float = 8.0
    long_answer_penalty: float = 8.0
    broad_grounding_penalty: float = 3.0
    high_priority_concept_bonus: float = 5.0
    long_front_threshold: int = 180
    long_answer_threshold: int = 420
    broad_grounding_threshold: int = 3


@dataclass(frozen=True)
class CardQualityContext:
    card: dict[str, Any]
    high_priority_ids: set[str]
    front: str
    answer_text: str
    source_pages: list[int]
    concept_ids: list[str]
    relation_keys: list[str]
    rationale: str
    source_excerpt: str
    has_slide_number: bool
    has_prompt_text: bool

    @classmethod
    def from_card(
        cls, card: dict[str, Any], high_priority_ids: set[str] | None
    ) -> "CardQualityContext":
        front = _strip_markup(_get_card_front(card))
        back = _strip_markup(_get_card_back(card))
        text = _strip_markup(
            str(card.get("text") or _get_card_field(card, "Text") or "")
        )
        answer_text = text or back
        return cls(
            card=card,
            high_priority_ids=high_priority_ids or set(),
            front=front,
            answer_text=answer_text,
            source_pages=get_card_page_references(card),
            concept_ids=get_card_concept_ids(card),
            relation_keys=get_card_relation_keys(card),
            rationale=_strip_markup(str(card.get("rationale") or "")),
            source_excerpt=_strip_markup(str(card.get("source_excerpt") or "")),
            has_slide_number=bool(card.get("slide_number")),
            has_prompt_text=bool(front or text),
        )


@dataclass
class CardQualityAccumulator:
    score: float
    flags: list[str] = field(default_factory=list)

    def add(self, delta: float) -> None:
        self.score += delta

    def flag(self, value: str) -> None:
        self.flags.append(value)


class CardQualityRule(Protocol):
    def apply(
        self,
        ctx: CardQualityContext,
        acc: CardQualityAccumulator,
        weights: CardQualityWeights,
    ) -> None: ...


class PromptTextRule:
    def apply(
        self,
        ctx: CardQualityContext,
        acc: CardQualityAccumulator,
        weights: CardQualityWeights,
    ) -> None:
        if ctx.has_prompt_text:
            acc.add(weights.prompt_present_bonus)
        else:
            acc.flag("missing_prompt_text")
            acc.add(-weights.prompt_missing_penalty)


class AnswerTextRule:
    def apply(
        self,
        ctx: CardQualityContext,
        acc: CardQualityAccumulator,
        weights: CardQualityWeights,
    ) -> None:
        if ctx.answer_text:
            acc.add(weights.answer_present_bonus)
        else:
            acc.flag("missing_answer_text")
            acc.add(-weights.answer_missing_penalty)


class SourcePagesRule:
    def apply(
        self,
        ctx: CardQualityContext,
        acc: CardQualityAccumulator,
        weights: CardQualityWeights,
    ) -> None:
        if ctx.source_pages:
            acc.add(weights.source_pages_present_bonus)
        else:
            acc.flag("missing_source_pages")
            acc.add(-weights.source_pages_missing_penalty)


class ConceptIdsRule:
    def apply(
        self,
        ctx: CardQualityContext,
        acc: CardQualityAccumulator,
        weights: CardQualityWeights,
    ) -> None:
        if ctx.concept_ids:
            acc.add(weights.concept_ids_present_bonus)
        else:
            acc.flag("missing_concept_ids")
            acc.add(-weights.concept_ids_missing_penalty)


class RelationKeysRule:
    def apply(
        self,
        ctx: CardQualityContext,
        acc: CardQualityAccumulator,
        weights: CardQualityWeights,
    ) -> None:
        if ctx.relation_keys:
            acc.add(weights.relation_keys_present_bonus)


class RationaleRule:
    def apply(
        self,
        ctx: CardQualityContext,
        acc: CardQualityAccumulator,
        weights: CardQualityWeights,
    ) -> None:
        if ctx.rationale:
            acc.add(weights.rationale_present_bonus)
        else:
            acc.flag("missing_rationale")
            acc.add(-weights.rationale_missing_penalty)


class SourceExcerptRule:
    def apply(
        self,
        ctx: CardQualityContext,
        acc: CardQualityAccumulator,
        weights: CardQualityWeights,
    ) -> None:
        if ctx.source_excerpt:
            acc.add(weights.source_excerpt_present_bonus)
        else:
            acc.flag("missing_source_excerpt")
            acc.add(-weights.source_excerpt_missing_penalty)


class SlideNumberRule:
    def apply(
        self,
        ctx: CardQualityContext,
        acc: CardQualityAccumulator,
        weights: CardQualityWeights,
    ) -> None:
        if ctx.has_slide_number:
            acc.add(weights.slide_number_bonus)


class LongFrontRule:
    def apply(
        self,
        ctx: CardQualityContext,
        acc: CardQualityAccumulator,
        weights: CardQualityWeights,
    ) -> None:
        if len(ctx.front) > weights.long_front_threshold:
            acc.flag("long_front")
            acc.add(-weights.long_front_penalty)


class LongAnswerRule:
    def apply(
        self,
        ctx: CardQualityContext,
        acc: CardQualityAccumulator,
        weights: CardQualityWeights,
    ) -> None:
        if len(ctx.answer_text) > weights.long_answer_threshold:
            acc.flag("long_answer")
            acc.add(-weights.long_answer_penalty)


class BroadGroundingRule:
    def apply(
        self,
        ctx: CardQualityContext,
        acc: CardQualityAccumulator,
        weights: CardQualityWeights,
    ) -> None:
        if len(ctx.source_pages) > weights.broad_grounding_threshold:
            acc.flag("broad_grounding")
            acc.add(-weights.broad_grounding_penalty)


class HighPriorityConceptRule:
    def apply(
        self,
        ctx: CardQualityContext,
        acc: CardQualityAccumulator,
        weights: CardQualityWeights,
    ) -> None:
        if ctx.high_priority_ids.intersection(ctx.concept_ids):
            acc.add(weights.high_priority_concept_bonus)


DEFAULT_CARD_QUALITY_RULES: list[CardQualityRule] = [
    PromptTextRule(),
    AnswerTextRule(),
    SourcePagesRule(),
    ConceptIdsRule(),
    RelationKeysRule(),
    RationaleRule(),
    SourceExcerptRule(),
    SlideNumberRule(),
    LongFrontRule(),
    LongAnswerRule(),
    BroadGroundingRule(),
    HighPriorityConceptRule(),
]


class CardQualityEvaluator:
    def __init__(
        self,
        *,
        rules: list[CardQualityRule] | None = None,
        weights: CardQualityWeights | None = None,
    ) -> None:
        self.rules = rules or DEFAULT_CARD_QUALITY_RULES
        self.weights = weights or CardQualityWeights()

    def evaluate(
        self, card: dict[str, Any], *, high_priority_ids: set[str] | None = None
    ) -> tuple[float, list[str]]:
        ctx = CardQualityContext.from_card(card, high_priority_ids)
        acc = CardQualityAccumulator(score=self.weights.base_score)
        for rule in self.rules:
            rule.apply(ctx, acc, self.weights)
        return max(0.0, min(100.0, acc.score)), sorted(set(acc.flags))
