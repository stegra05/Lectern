from __future__ import annotations

from collections import Counter
from typing import Any, Dict, List, Set


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


def normalize_relation_key(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    parts = [segment.strip() for segment in value.split("|", 2)]
    if len(parts) != 3 or not all(parts):
        return ""
    return "|".join(parts)


def make_relation_key(source: Any, rel_type: Any, target: Any) -> str:
    return normalize_relation_key(
        f"{str(source or '').strip()}|{str(rel_type or '').strip()}|{str(target or '').strip()}"
    )


def get_card_relation_keys(card: Dict[str, Any]) -> List[str]:
    relation_keys = normalize_string_list(card.get("relation_keys"))
    normalized = [normalize_relation_key(value) for value in relation_keys]
    return [value for value in normalized if value]


def build_coverage_catalog(
    concept_map: Dict[str, Any], total_pages: int
) -> Dict[str, Any]:
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
                "page_references": normalize_page_references(
                    concept.get("page_references")
                ),
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
                "key": make_relation_key(
                    relation.get("source"),
                    relation.get("type"),
                    relation.get("target"),
                ),
                "page_references": normalize_page_references(
                    relation.get("page_references") or relation.get("page_reference")
                ),
            }
        )

    return {
        "total_pages": int(total_pages),
        "document_type": (
            concept_map.get("document_type") if isinstance(concept_map, dict) else None
        ),
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
    relation_catalog = catalog.get("relation_catalog", [])

    covered_pages: Set[int] = set()
    explicit_concept_ids: Set[str] = set()
    covered_concepts_by_page: Set[str] = set()
    explicit_relation_keys: Set[str] = set()
    covered_relations_by_page: Set[str] = set()
    cards_per_page: Counter[int] = Counter()

    for card in cards:
        if not isinstance(card, dict):
            continue
        page_refs = get_card_page_references(card)
        covered_pages.update(page_refs)
        for page in page_refs:
            cards_per_page[page] += 1
        explicit_concept_ids.update(get_card_concept_ids(card))
        explicit_relation_keys.update(get_card_relation_keys(card))

        if page_refs and concept_catalog:
            page_ref_set = set(page_refs)
            for concept in concept_catalog:
                concept_id = str(concept.get("id") or "").strip()
                concept_pages = set(
                    normalize_page_references(concept.get("page_references"))
                )
                if (
                    concept_id
                    and concept_pages
                    and page_ref_set.intersection(concept_pages)
                ):
                    covered_concepts_by_page.add(concept_id)
            for relation in relation_catalog:
                relation_key = str(relation.get("key") or "").strip()
                relation_pages = set(
                    normalize_page_references(relation.get("page_references"))
                )
                if (
                    relation_key
                    and relation_pages
                    and page_ref_set.intersection(relation_pages)
                ):
                    covered_relations_by_page.add(relation_key)

    covered_concept_ids_set = explicit_concept_ids.union(covered_concepts_by_page)
    covered_concept_ids = sorted(covered_concept_ids_set)
    concept_ids = [
        str(concept.get("id") or "").strip()
        for concept in concept_catalog
        if concept.get("id")
    ]
    high_priority_ids = [
        str(concept.get("id") or "").strip()
        for concept in concept_catalog
        if str(concept.get("importance") or "").strip() == "high" and concept.get("id")
    ]
    relation_keys = [
        str(relation.get("key") or "").strip()
        for relation in relation_catalog
        if relation.get("key")
    ]
    covered_relation_keys_set = explicit_relation_keys.union(covered_relations_by_page)

    uncovered_pages = [
        page for page in range(1, int(total_pages) + 1) if page not in covered_pages
    ]
    uncovered_concepts = [
        {
            "id": str(concept.get("id") or "").strip(),
            "name": str(concept.get("name") or "").strip(),
            "importance": str(concept.get("importance") or "medium"),
            "page_references": normalize_page_references(
                concept.get("page_references")
            ),
        }
        for concept in concept_catalog
        if str(concept.get("id") or "").strip() not in covered_concept_ids_set
    ]
    missing_high_priority = [
        concept for concept in uncovered_concepts if concept.get("importance") == "high"
    ]
    uncovered_relations = [
        {
            "key": str(relation.get("key") or "").strip(),
            "source": str(relation.get("source") or "").strip(),
            "target": str(relation.get("target") or "").strip(),
            "type": str(relation.get("type") or "").strip(),
            "page_references": normalize_page_references(
                relation.get("page_references")
            ),
        }
        for relation in relation_catalog
        if str(relation.get("key") or "").strip() not in covered_relation_keys_set
    ]
    saturated_pages = [
        page for page, count in sorted(cards_per_page.items()) if count > 2
    ]

    return {
        **catalog,
        "covered_pages": sorted(covered_pages),
        "uncovered_pages": uncovered_pages,
        "covered_page_count": len(covered_pages),
        "page_coverage_pct": (
            round((len(covered_pages) / total_pages) * 100) if total_pages > 0 else 0
        ),
        "saturated_pages": saturated_pages,
        "explicit_concept_count": len(explicit_concept_ids),
        "explicit_concept_coverage_pct": (
            round((len(explicit_concept_ids) / len(concept_ids)) * 100)
            if concept_ids
            else 0
        ),
        "covered_concept_ids": covered_concept_ids,
        "covered_concept_count": len(covered_concept_ids),
        "total_concepts": len(concept_ids),
        "concept_coverage_pct": (
            round((len(covered_concept_ids) / len(concept_ids)) * 100)
            if concept_ids
            else 0
        ),
        "explicit_relation_count": len(explicit_relation_keys),
        "covered_relation_count": len(covered_relation_keys_set),
        "total_relations": len(relation_keys),
        "relation_coverage_pct": (
            round((len(covered_relation_keys_set) / len(relation_keys)) * 100)
            if relation_keys
            else 0
        ),
        "high_priority_total": len(high_priority_ids),
        "high_priority_covered": len(
            [cid for cid in high_priority_ids if cid in covered_concept_ids_set]
        ),
        "missing_high_priority": missing_high_priority,
        "uncovered_concepts": uncovered_concepts,
        "uncovered_relations": uncovered_relations,
    }


def build_generation_gap_text(coverage_data: Dict[str, Any]) -> str:
    uncovered_pages = coverage_data.get("uncovered_pages") or []
    uncovered_concepts = coverage_data.get("uncovered_concepts") or []
    missing_high_priority = coverage_data.get("missing_high_priority") or []
    uncovered_relations = coverage_data.get("uncovered_relations") or []
    saturated_pages = coverage_data.get("saturated_pages") or []

    lines = [
        "- COVERAGE LEDGER:",
        f"  - Pages covered: {coverage_data.get('covered_page_count', 0)}/{coverage_data.get('total_pages', 0)}.",
        f"  - Concepts covered: {coverage_data.get('covered_concept_count', 0)}/{coverage_data.get('total_concepts', 0)} ({coverage_data.get('explicit_concept_count', 0)} explicit).",
        f"  - Relations covered: {coverage_data.get('covered_relation_count', 0)}/{coverage_data.get('total_relations', 0)} ({coverage_data.get('explicit_relation_count', 0)} explicit).",
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

    if uncovered_relations:
        preview = ", ".join(
            f"{item.get('source')}|{item.get('type')}|{item.get('target')}"
            for item in uncovered_relations[:6]
        )
        suffix = "..." if len(uncovered_relations) > 6 else ""
        lines.append(f"  - Missing relations: {preview}{suffix}")

    if saturated_pages:
        preview = ", ".join(str(page) for page in saturated_pages[:8])
        suffix = "..." if len(saturated_pages) > 8 else ""
        lines.append(f"  - Over-covered pages to deprioritize: {preview}{suffix}")

    return "\n".join(lines) + "\n"


def build_reflection_gap_text(coverage_data: Dict[str, Any]) -> str:
    missing_high_priority = coverage_data.get("missing_high_priority") or []
    uncovered_pages = coverage_data.get("uncovered_pages") or []
    uncovered_relations = coverage_data.get("uncovered_relations") or []
    saturated_pages = coverage_data.get("saturated_pages") or []

    lines = [
        "Coverage audit:",
        f"- Page coverage: {coverage_data.get('covered_page_count', 0)}/{coverage_data.get('total_pages', 0)}.",
        f"- Concept coverage: {coverage_data.get('covered_concept_count', 0)}/{coverage_data.get('total_concepts', 0)} ({coverage_data.get('explicit_concept_count', 0)} explicit).",
        f"- Relation coverage: {coverage_data.get('covered_relation_count', 0)}/{coverage_data.get('total_relations', 0)} ({coverage_data.get('explicit_relation_count', 0)} explicit).",
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
            + ", ".join(
                str(item.get("name") or item.get("id"))
                for item in missing_high_priority[:10]
            )
            + ("..." if len(missing_high_priority) > 10 else "")
        )
    if uncovered_relations:
        lines.append(
            "- Missing relations: "
            + ", ".join(
                f"{item.get('source')}|{item.get('type')}|{item.get('target')}"
                for item in uncovered_relations[:8]
            )
            + ("..." if len(uncovered_relations) > 8 else "")
        )
    if saturated_pages:
        lines.append(
            "- Saturated pages to thin out: "
            + ", ".join(str(page) for page in saturated_pages[:10])
            + ("..." if len(saturated_pages) > 10 else "")
        )
    return "\n".join(lines)
