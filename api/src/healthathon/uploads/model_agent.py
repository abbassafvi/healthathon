"""
The document agent over a model provider.

The agent is handed crops and nothing else about the patient. It returns
only what it can tie to a crop; `drop_ungrounded` then removes anything
citing a region that was never shown, so an invented index cannot become
a value.
"""

from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from datetime import date
from pathlib import Path
from typing import Any

from healthathon.uploads.agent import (
    Crop,
    DocType,
    DocumentReading,
    LabValue,
    RegimenLine,
    RequestedTest,
    drop_ungrounded,
)
from healthathon.uploads.prompts import lab_report_prompt, prescription_prompt
from healthathon.uploads.providers import ModelClient, ModelUnavailable


def _text(raw: Any) -> str | None:
    if raw is None:
        return None
    value = str(raw).strip()
    return value or None


def _index(raw: Any) -> int | None:
    try:
        return int(raw)
    except (TypeError, ValueError):
        return None


def _renumber(reading: DocumentReading, indices: list[int]) -> DocumentReading:
    """Batch-local crop numbers back to the crop indices of the page."""
    at = indices.__getitem__
    return DocumentReading(
        values=[replace(v, box_index=at(v.box_index)) for v in reading.values],
        lines=[replace(line, box_index=at(line.box_index)) for line in reading.lines],
        orders=[replace(o, box_index=at(o.box_index)) for o in reading.orders],
        document_date=reading.document_date,
        issuing_source=reading.issuing_source,
        unreadable=[at(i) for i in reading.unreadable],
    )


def _parse_date(raw: Any) -> date | None:
    text = _text(raw)
    if text is None:
        return None
    try:
        return date.fromisoformat(text)
    except ValueError:
        return None


class ModelDocumentAgent:
    """Reads a page's crops, in as many calls as the provider will take."""

    name = "document-agent"

    def __init__(
        self, client: ModelClient, analyte_codes: list[str], max_crops_per_call: int = 12
    ) -> None:
        self._client = client
        self._codes = analyte_codes
        self._batch = max(max_crops_per_call, 1)

    @property
    def version(self) -> str:
        """Named after the model that answered, which fallback can change."""
        return f"{self._client.name}:{self._client.model}"

    def read(self, doc_type: DocType, page: Path, crops: list[Crop]) -> DocumentReading:
        """
        Read every crop. A provider refuses a request carrying too many
        images, so the crops go in batches and the answers are put back
        together.
        """
        if not crops:
            return DocumentReading()
        batches = [crops[i : i + self._batch] for i in range(0, len(crops), self._batch)]
        merged = DocumentReading()
        if len(batches) == 1:
            self._merge(merged, self._read_batch(doc_type, page, batches[0]))
            return merged
        # Batches of one page do not depend on each other either.
        with ThreadPoolExecutor(max_workers=len(batches)) as pool:
            futures = [pool.submit(self._read_batch, doc_type, page, b) for b in batches]
            for f in futures:
                self._merge(merged, f.result())
        return merged

    def _read_batch(self, doc_type: DocType, page: Path, batch: list[Crop]) -> DocumentReading:
        """
        One call. The model numbers the crops it is shown from zero, so
        what it returns is renumbered to each crop's own index before it
        leaves here: provenance depends on that index being the real one.
        """
        prompt = (
            prescription_prompt(len(batch), self._codes)
            if doc_type == "prescription"
            else lab_report_prompt(len(batch), self._codes)
        )
        payload = self._client.complete_json(prompt, [c.labelled for c in batch] + [page])
        reading = self._prescription(payload) if doc_type == "prescription" else self._lab(payload)
        return _renumber(drop_ungrounded(reading, len(batch)), [c.index for c in batch])

    @staticmethod
    def _merge(into: DocumentReading, part: DocumentReading) -> None:
        into.values.extend(part.values)
        into.lines.extend(part.lines)
        into.orders.extend(part.orders)
        into.unreadable.extend(i for i in part.unreadable if i not in into.unreadable)
        into.document_date = into.document_date or part.document_date
        into.issuing_source = into.issuing_source or part.issuing_source

    def _common(self, payload: dict[str, Any]) -> tuple[date | None, str | None, list[int]]:
        unreadable = [
            i for i in (_index(v) for v in payload.get("unreadable") or []) if i is not None
        ]
        return (
            _parse_date(payload.get("document_date")),
            _text(payload.get("issuing_source")),
            unreadable,
        )

    def _values(self, payload: dict[str, Any]) -> list[LabValue]:
        """
        Results the page reports. A consultation card carries them beside
        the prescribing ("F = 180"), so both document types read them.
        """
        found: list[LabValue] = []
        for item in payload.get("values") or []:
            box, code, text = (
                _index(item.get("box")),
                _text(item.get("analyte")),
                _text(item.get("value")),
            )
            if box is None or code is None or text is None or code not in self._codes:
                continue
            found.append(
                LabValue(
                    box_index=box,
                    analyte_code=code,
                    value_text=text,
                    unit_text=_text(item.get("unit")),
                )
            )
        return found

    def _lab(self, payload: dict[str, Any]) -> DocumentReading:
        when, source, unreadable = self._common(payload)
        return DocumentReading(
            values=self._values(payload),
            orders=self._orders(payload),
            document_date=when,
            issuing_source=source,
            unreadable=unreadable,
        )

    def _orders(self, payload: dict[str, Any]) -> list[RequestedTest]:
        found: list[RequestedTest] = []
        for item in payload.get("orders") or []:
            box, code = _index(item.get("box")), _text(item.get("analyte"))
            if box is None or code is None or code not in self._codes:
                continue
            found.append(RequestedTest(box_index=box, analyte_code=code))
        return found

    def _prescription(self, payload: dict[str, Any]) -> DocumentReading:
        when, source, unreadable = self._common(payload)
        lines: list[RegimenLine] = []
        for item in payload.get("lines") or []:
            box, drug, dose = (
                _index(item.get("box")),
                _text(item.get("drug")),
                _text(item.get("dose")),
            )
            if box is None or drug is None or dose is None:
                # A line without a dose is not a line we can stand behind.
                if box is not None:
                    unreadable.append(box)
                continue
            lines.append(
                RegimenLine(
                    box_index=box,
                    drug_text=drug,
                    dose_text=dose,
                    schedule_text=_text(item.get("schedule")),
                )
            )
        return DocumentReading(
            values=self._values(payload),
            lines=lines,
            orders=self._orders(payload),
            document_date=when,
            issuing_source=source,
            unreadable=unreadable,
        )


class UnreadableAgent:
    """
    Stands in when no provider is configured. It reads nothing and sends
    every region to a person, which is the honest outcome of having no
    reader: the page is still stored, and nothing is invented.
    """

    name = "unconfigured"
    version = "0"

    def read(self, doc_type: DocType, page: Path, crops: list[Crop]) -> DocumentReading:
        raise ModelUnavailable("no document agent is configured; set HEALTHATHON_AGENT_API_KEY")
