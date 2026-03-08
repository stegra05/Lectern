from __future__ import annotations

from typing import Any, Dict, Iterable, List, Set


def normalize_positive_int(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value if value > 0 else None
    if isinstance(value, float):
        int_value = int(value)
        return int_value if int_value > 0 else None
    if isinstance(value, str):
        stripped = value.strip()
        if stripped.isdigit():
            int_value = int(stripped)
            return int_value if int_value > 0 else None
    return None


def normalize_page_references(value: Any) -> List[int]:
    if value is None:
        return []
    if isinstance(value, (int, float, str)):
        normalized = normalize_positive_int(value)
        return [normalized] if normalized is not None else []

    refs: List[int] = []
    if isinstance(value, list):
        for item in value:
            normalized = normalize_positive_int(item)
            if normalized is not None and normalized not in refs:
                refs.append(normalized)
    return refs


def normalize_string_list(value: Any) -> List[str]:
    if value is None:
        return []
    if isinstance(value, str):
        items = [segment.strip() for segment in value.split(",")]
    elif isinstance(value, list):
        items = [str(item).strip() for item in value]
    else:
        return []
    return [item for item in items if item]


def get_card_page_references(card: Dict[str, Any]) -> List[int]:
    source_pages = normalize_page_references(card.get("source_pages"))
    if source_pages:
        return source_pages

    slide_number = normalize_positive_int(card.get("slide_number"))
    return [slide_number] if slide_number is not None else []


def get_card_concept_ids(card: Dict[str, Any]) -> List[str]:
    return normalize_string_list(card.get("concept_ids"))


def build_coverage_catalog(concept_map: Dict[str, Any], total_pages: int) -> Dict[str, Any]:
    concepts = concept_map.get("concepts") if isinstance(concept_map, dict) else []
    relations = concept_map.get("relations") if isinstance(concept_map, dict) else []

    concept_catalog: List[Dict[str, Any]] = []
    for concept in concepts if isinstance(concepts, list) else []:
        if not isinstance(concept, dict):
            continue
        concept_catalog.append(
            {
                "id": str(concept.get("id") or "").strip(),
                "name": str(concept.get("name") or "").strip(),
                "importance": str(concept.get("importance") or "medium"),
                "difficulty": str(concept.get("difficulty") or "intermediate"),
                "page_references": normalize_page_references(concept.get("page_references")),
            }
        )

    relation_catalog: List[Dict[str, Any]] = []
    for relation in relations if isinstance(relations, list) else []:
        if not isinstance(relation, dict):
            continue
        relation_catalog.append(
            {
                "source": str(relation.get("source") or "").strip(),
                "target": str(relation.get("target") or "").strip(),
                "type": str(relation.get("type") or "").strip(),
                "page_references": normalize_page_references(
                    relation.get("page_references") or relation.get("page_reference")
                ),
            }
        )

    return {
        "total_pages": int(total_pages),
        "document_type": concept_map.get("document_type") if isinstance(concept_map, dict) else None,
        "concept_catalog": concept_catalog,
        "relation_catalog": relation_catalog,
    }


def compute_coverage_data(
    *,
    cards: List[Dict[str, Any]],
    concept_map: Dict[str, Any],
    total_pages: int,
) -> Dict[str, Any]:
    catalog = build_coverage_catalog(concept_map, total_pages)
    concept_catalog = catalog.get("concept_catalog", [])

    covered_pages: Set[int] = set()
    explicit_concept_ids: Set[str] = set()
    covered_concepts_by_page: Set[str] = set()

    for card in cards:
        if not isinstance(card, dict):
            continue
        page_refs = get_card_page_references(card)
        covered_pages.update(page_refs)
        explicit_concept_ids.update(get_card_concept_ids(card))

        if page_refs and concept_catalog:
            page_ref_set = set(page_refs)
            for concept in concept_catalog:
                concept_id = str(concept.get("id") or "").strip()
                concept_pages = set(normalize_page_references(concept.get("page_references")))
                if concept_id and concept_pages and page_ref_set.intersection(concept_pages):
                    covered_concepts_by_page.add(concept_id)

    covered_concept_ids = sorted(explicit_concept_ids.union(covered_concepts_by_page))
    concept_ids = [str(concept.get("id") or "").strip() for concept in concept_catalog if concept.get("id")]
    high_priority_ids = [
        str(concept.get("id") or "").strip()
        for concept in concept_catalog
        if str(concept.get("importance") or "").strip() == "high" and concept.get("id")
    ]

    uncovered_pages = [
        page for page in range(1, int(total_pages) + 1) if page not in covered_pages
    ]
    uncovered_concepts = [
        {
            "id": str(concept.get("id") or "").strip(),
            "name": str(concept.get("name") or "").strip(),
            "importance": str(concept.get("importance") or "medium"),
            "page_references": normalize_page_references(concept.get("page_references")),
        }
        for concept in concept_catalog
        if str(concept.get("id") or "").strip() not in covered_concept_ids
    ]
    missing_high_priority = [
        concept for concept in uncovered_concepts if concept.get("importance") == "high"
    ]

    return {
        **catalog,
        "covered_pages": sorted(covered_pages),
        "uncovered_pages": uncovered_pages,
        "covered_page_count": len(covered_pages),
        "page_coverage_pct": round((len(covered_pages) / total_pages) * 100) if total_pages > 0 else 0,
        "covered_concept_ids": covered_concept_ids,
        "covered_concept_count": len(covered_concept_ids),
        "total_concepts": len(concept_ids),
        "concept_coverage_pct": round((len(covered_concept_ids) / len(concept_ids)) * 100)
        if concept_ids
        else 0,
        "high_priority_total": len(high_priority_ids),
        "high_priority_covered": len([concept_id for concept_id in high_priority_ids if concept_id in covered_concept_ids]),
        "missing_high_priority": missing_high_priority,
        "uncovered_concepts": uncovered_concepts,
    }


def build_generation_gap_text(coverage_data: Dict[str, Any]) -> str:
    uncovered_pages = coverage_data.get("uncovered_pages") or []
    uncovered_concepts = coverage_data.get("uncovered_concepts") or []
    missing_high_priority = coverage_data.get("missing_high_priority") or []

    lines = [
        "- COVERAGE LEDGER:",
        f"  - Pages covered: {coverage_data.get('covered_page_count', 0)}/{coverage_data.get('total_pages', 0)}.",
        f"  - Concepts covered: {coverage_data.get('covered_concept_count', 0)}/{coverage_data.get('total_concepts', 0)}.",
    ]

    if uncovered_pages:
        preview = ", ".join(str(page) for page in uncovered_pages[:15])
        suffix = "..." if len(uncovered_pages) > 15 else ""
        lines.append(f"  - Prioritize uncovered pages: {preview}{suffix}")

    if missing_high_priority:
        preview = ", ".join(
            f"{item.get('name') or item.get('id')}@{','.join(str(p) for p in item.get('page_references') or []) or '?'}"
            for item in missing_high_priority[:8]
        )
        suffix = "..." if len(missing_high_priority) > 8 else ""
        lines.append(f"  - Missing HIGH priority concepts: {preview}{suffix}")
    elif uncovered_concepts:
        preview = ", ".join(
            f"{item.get('name') or item.get('id')}@{','.join(str(p) for p in item.get('page_references') or []) or '?'}"
            for item in uncovered_concepts[:8]
        )
        suffix = "..." if len(uncovered_concepts) > 8 else ""
        lines.append(f"  - Remaining concepts: {preview}{suffix}")

    return "\n".join(lines) + "\n"


def build_reflection_gap_text(coverage_data: Dict[str, Any]) -> str:
    missing_high_priority = coverage_data.get("missing_high_priority") or []
    uncovered_pages = coverage_data.get("uncovered_pages") or []

    lines = [
        "Coverage audit:",
        f"- Page coverage: {coverage_data.get('covered_page_count', 0)}/{coverage_data.get('total_pages', 0)}.",
        f"- Concept coverage: {coverage_data.get('covered_concept_count', 0)}/{coverage_data.get('total_concepts', 0)}.",
        f"- High-priority concept coverage: {coverage_data.get('high_priority_covered', 0)}/{coverage_data.get('high_priority_total', 0)}.",
    ]
    if uncovered_pages:
        lines.append(
            "- Uncovered pages: "
            + ", ".join(str(page) for page in uncovered_pages[:15])
            + ("..." if len(uncovered_pages) > 15 else "")
        )
    if missing_high_priority:
        lines.append(
            "- Missing high-priority concepts: "
            + ", ".join(str(item.get("name") or item.get("id")) for item in missing_high_priority[:10])
            + ("..." if len(missing_high_priority) > 10 else "")
        )
    return "\n".join(lines)
