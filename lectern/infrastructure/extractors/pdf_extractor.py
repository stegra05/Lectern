from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Callable

from lectern.application.ports import PdfExtractorPort
from lectern.cost_estimator import extract_pdf_metadata
from lectern.orchestration.pipeline_context import PDFMetadata


class PdfExtractorAdapter(PdfExtractorPort):
    """Adapter bridging extract_pdf_metadata into typed PDFMetadata."""

    def __init__(
        self,
        *,
        extractor: Callable[[str], dict[str, int]] = extract_pdf_metadata,
    ) -> None:
        self._extractor = extractor

    async def extract_metadata(self, pdf_path: str) -> PDFMetadata:
        raw = await asyncio.to_thread(self._extractor, pdf_path)
        path = Path(pdf_path)
        page_count = int(raw.get("page_count", 0) or 0)
        text_chars = int(raw.get("text_chars", 0) or 0)

        return PDFMetadata(
            path=pdf_path,
            filename=path.stem,
            title=path.stem,
            file_size=path.stat().st_size if path.exists() else 0,
            page_count=page_count,
            text_chars=text_chars,
            image_count=int(raw.get("image_count", 0) or 0),
            metadata_pages=page_count,
            metadata_chars=text_chars,
        )
