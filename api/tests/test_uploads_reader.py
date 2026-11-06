"""
The reader's pure parts: ordering, grounding, the checks and the two
provider replies. None of these needs a database or a network.
"""

from datetime import date, timedelta
from pathlib import Path
from typing import Any

import pytest

from healthathon.uploads import checks
from healthathon.uploads.agent import (
    Crop,
    DocumentReading,
    LabValue,
    RegimenLine,
    RequestedTest,
    drop_ungrounded,
)
from healthathon.uploads.detector import Box, draw_boxes, merge_lines, sort_reading_order
from healthathon.uploads.model_agent import ModelDocumentAgent
from healthathon.uploads.providers import ModelUnavailable, _parse
from tests.fakes import page_image

CODES = ["hba1c", "fpg", "ldl"]


class StubClient:
    name = "stub"
    model = "stub-1"

    def __init__(self, payload: dict[str, Any]) -> None:
        self.payload = payload
        self.prompts: list[str] = []
        self.images: list[list[Path]] = []

    def complete_json(self, prompt: str, images: list[Path]) -> dict[str, Any]:
        self.prompts.append(prompt)
        self.images.append(images)
        return self.payload


def crops(tmp_path: Path, count: int) -> list[Crop]:
    made = []
    for i in range(count):
        path = tmp_path / f"{i}.png"
        path.write_bytes(page_image(80, 40))
        labelled = tmp_path / f"{i}-labelled.png"
        labelled.write_bytes(page_image(80, 60))
        made.append(
            Crop(
                index=i,
                path=path,
                storage_key=f"k/{i}.png",
                labelled=labelled,
                box=Box(0.1, 0.1 + i * 0.05, 0.3, 0.03),
            )
        )
    return made


# ---- reading order -------------------------------------------------


def test_regions_come_back_top_to_bottom_then_left_to_right() -> None:
    #  a dose and its schedule sit beside the drug they belong to
    boxes = [
        Box(0.60, 0.201, 0.1, 0.02),  # same line, further right
        Box(0.10, 0.200, 0.3, 0.02),  # same line, left
        Box(0.10, 0.100, 0.3, 0.02),  # the line above
    ]
    assert [round(b.y, 3) for b in sort_reading_order(boxes)] == [0.1, 0.2, 0.201]
    assert [b.x for b in sort_reading_order(boxes)][1:] == [0.10, 0.60]


def test_a_box_is_clamped_to_the_page() -> None:
    assert Box(0.9, 0.9, 0.5, 0.5).clamped() == Box(
        0.9, 0.9, pytest.approx(0.1), pytest.approx(0.1)
    )


def test_the_detectors_own_view_of_the_page_is_saved(tmp_path: Path) -> None:
    page = tmp_path / "page.png"
    page.write_bytes(page_image(400, 300))
    out = tmp_path / "boxes.png"
    draw_boxes(page, [Box(0.1, 0.1, 0.3, 0.1)], out)
    assert out.is_file() and out.stat().st_size > 0


# ---- grounding -----------------------------------------------------


def test_anything_citing_a_region_that_was_not_shown_is_dropped() -> None:
    reading = DocumentReading(
        values=[LabValue(0, "hba1c", "7.4"), LabValue(9, "fpg", "138")],
        lines=[RegimenLine(1, "Tab. X", "5 mg")],
        orders=[RequestedTest(7, "ldl")],
        unreadable=[2, 44],
    )
    kept = drop_ungrounded(reading, box_count=3)
    assert [v.box_index for v in kept.values] == [0]
    assert [line.box_index for line in kept.lines] == [1]
    assert kept.orders == []
    assert kept.unreadable == [2]


# ---- the five checks -----------------------------------------------


def test_a_value_that_is_not_a_number_is_not_well_formed() -> None:
    out = checks.well_formed("one four two", None, set(), None, None)
    assert out.failed and out.detail == {"why": "not_a_number"}


def test_a_unit_we_do_not_know_for_this_analyte_fails() -> None:
    assert checks.well_formed("7.4", "furlongs", {"%"}, None, None).failed
    assert not checks.well_formed("7.4", "%", {"%"}, None, None).failed


def test_a_thousands_separator_is_still_a_number() -> None:
    assert not checks.well_formed("1,240", "mg/g", {"mg/g"}, None, None).failed


def test_a_date_in_the_future_is_implausible() -> None:
    out = checks.well_formed("7.4", "%", {"%"}, date.today() + timedelta(days=1), None)
    assert out.failed and out.detail == {"why": "implausible_date"}


def test_a_number_the_assay_could_not_have_printed_goes_to_a_person() -> None:
    from decimal import Decimal

    out = checks.well_formed("980", "%", {"%"}, None, (Decimal("3"), Decimal("20")))
    assert out.failed and out.detail == {"why": "outside_assay_range"}


def test_passes_that_disagree_fail_and_a_single_pass_is_not_applicable() -> None:
    assert checks.reread_agreement("7.4", []).outcome == "not_applicable"
    assert not checks.reread_agreement("7.4", ["7.4"]).failed
    assert checks.reread_agreement("7.4", ["1.4"]).failed


def test_another_document_disagreeing_sends_this_one_to_a_person() -> None:
    assert checks.cross_document("7.4", []).outcome == "not_applicable"
    assert not checks.cross_document("7.4", ["7.4"]).failed
    assert checks.cross_document("7.4", ["9.1"]).failed


def test_the_reason_names_the_most_concrete_failure() -> None:
    """A region nobody can see beats two readers disagreeing about it."""
    out = [
        checks.CheckOutcome("grounding", "pass"),
        checks.CheckOutcome("legibility", "fail"),
        checks.CheckOutcome("reread_agreement", "fail"),
    ]
    assert checks.first_failure(out) == "region_illegible"
    assert checks.first_failure([checks.CheckOutcome("grounding", "pass")]) is None


# ---- the agent over a model ----------------------------------------


def test_the_agent_keeps_the_value_as_printed(tmp_path: Path) -> None:
    client = StubClient(
        {
            "document_date": "2026-09-30",
            "issuing_source": "Lucknow Diagnostics",
            "values": [{"box": 0, "analyte": "hba1c", "value": "7.4", "unit": "%"}],
            "unreadable": [1],
        }
    )
    agent = ModelDocumentAgent(client, CODES)
    reading = agent.read("lab_report", tmp_path / "p.png", crops(tmp_path, 2))

    assert reading.values == [LabValue(0, "hba1c", "7.4", "%")]
    assert reading.document_date == date(2026, 9, 30)
    assert reading.unreadable == [1]


def test_an_analyte_outside_the_closed_set_is_left_out(tmp_path: Path) -> None:
    client = StubClient({"values": [{"box": 0, "analyte": "potassium", "value": "4.1"}]})
    agent = ModelDocumentAgent(client, CODES)
    assert agent.read("lab_report", tmp_path / "p.png", crops(tmp_path, 1)).values == []


def test_a_prescription_line_with_no_dose_is_sent_to_a_person(tmp_path: Path) -> None:
    client = StubClient(
        {
            "lines": [
                {"box": 0, "drug": "Tab. Metformin", "dose": "500 mg", "schedule": "1-0-1"},
                {"box": 1, "drug": "Tab. Something", "dose": None},
            ]
        }
    )
    agent = ModelDocumentAgent(client, CODES)
    reading = agent.read("prescription", tmp_path / "p.png", crops(tmp_path, 2))

    assert [line.drug_text for line in reading.lines] == ["Tab. Metformin"]
    assert reading.unreadable == [1]


def test_the_agent_is_shown_every_crop_and_the_whole_page_last(tmp_path: Path) -> None:
    client = StubClient({"values": []})
    page = tmp_path / "p.png"
    agent = ModelDocumentAgent(client, CODES)
    agent.read("lab_report", page, crops(tmp_path, 3))
    assert len(client.images[0]) == 4
    assert client.images[0][-1] == page


def test_the_prompt_names_the_closed_set_and_the_crop_count(tmp_path: Path) -> None:
    client = StubClient({"values": []})
    ModelDocumentAgent(client, CODES).read("lab_report", tmp_path / "p.png", crops(tmp_path, 2))
    prompt = client.prompts[0]
    assert "2 crops" in prompt
    assert "fpg, hba1c, ldl" in prompt


def test_no_crops_means_no_call_at_all(tmp_path: Path) -> None:
    client = StubClient({"values": [{"box": 0, "analyte": "fpg", "value": "1"}]})
    agent = ModelDocumentAgent(client, CODES)
    assert agent.read("lab_report", tmp_path / "p.png", []) == DocumentReading()
    assert client.prompts == []


# ---- provider replies ----------------------------------------------


def test_json_is_taken_out_of_a_fenced_reply() -> None:
    assert _parse('```json\n{"a": 1}\n```') == {"a": 1}
    assert _parse('Here you go:\n{"a": 2}\nhope that helps') == {"a": 2}


def test_a_reply_with_no_json_object_is_an_error() -> None:
    with pytest.raises(ModelUnavailable):
        _parse("I could not read the page.")
    with pytest.raises(ModelUnavailable):
        _parse('{"a": ')


# ---- the stand-in reader -------------------------------------------


def _stub_page(tmp_path: Path, bands: int, blur_last: bool = False) -> Path:
    from dev_seed.stub_page import build

    path = tmp_path / f"page-{bands}-{blur_last}.png"
    path.write_bytes(build(bands, blur_last))
    return path


def test_the_stand_in_detector_finds_one_region_per_band(tmp_path: Path) -> None:
    from healthathon.uploads.stub import StubDetector

    for bands in (1, 2, 4):
        found = StubDetector().detect(_stub_page(tmp_path, bands))
        assert len(found) == bands, f"{bands} bands"


def test_the_stand_in_detector_returns_regions_down_the_page(tmp_path: Path) -> None:
    from healthathon.uploads.stub import StubDetector

    found = StubDetector().detect(_stub_page(tmp_path, 4))
    assert [b.y for b in found] == sorted(b.y for b in found)
    assert all(0 <= b.y <= 1 and 0 < b.h <= 1 for b in found)


def test_a_smeared_region_is_found_but_scores_far_below_the_threshold(tmp_path: Path) -> None:
    """The legibility check, not the detector, is what refuses a blurred region."""
    from healthathon.uploads.pipeline import cut_crops
    from healthathon.uploads.stub import StubDetector

    page = _stub_page(tmp_path, 4, blur_last=True)
    found = StubDetector().detect(page)
    assert len(found) == 4
    crops_by_index = cut_crops(page, found, "stubpage")
    scores = [checks.sharpness(crops_by_index[i].path) for i in sorted(crops_by_index)]
    assert scores[-1] < 1450 <= min(scores[:-1])


def test_the_stand_in_agent_will_not_stand_behind_a_single_region(tmp_path: Path) -> None:
    from healthathon.uploads.stub import StubAgent

    one = crops(tmp_path, 1)
    assert StubAgent().read("prescription", tmp_path / "p.png", one).lines == []
    two = crops(tmp_path, 2)
    assert len(StubAgent().read("prescription", tmp_path / "p.png", two).lines) == 2


# ---- ask again -----------------------------------------------------


def test_three_passes_that_agree_pass_and_one_that_changes_fails() -> None:
    assert checks.reread_agreement("7.4", []).outcome == "not_applicable"
    assert not checks.reread_agreement("7.4", ["7.4", "7.4"]).failed
    out = checks.reread_agreement("7.4", ["7.4", "1.4"])
    assert out.failed and out.signal == pytest.approx(2 / 3, abs=1e-3)


def test_a_region_one_pass_did_not_read_at_all_counts_as_disagreement() -> None:
    from healthathon.uploads.checks import NOTHING

    assert checks.reread_agreement("7.4", ["7.4", NOTHING]).failed


def test_combining_passes_records_what_each_later_pass_said() -> None:
    from healthathon.uploads.checks import NOTHING
    from healthathon.uploads.consensus import combine

    first = DocumentReading(values=[LabValue(0, "hba1c", "7.4"), LabValue(1, "fpg", "138")])
    second = DocumentReading(values=[LabValue(0, "hba1c", "7.4"), LabValue(1, "fpg", "139")])
    third = DocumentReading(values=[LabValue(0, "hba1c", "7.4")])

    agreed = combine([first, second, third])
    assert agreed.other_reads == {0: ["7.4", "7.4"], 1: ["139", NOTHING]}
    # The first pass is still what would be written; the check decides.
    assert [v.value_text for v in agreed.reading.values] == ["7.4", "138"]


def test_a_line_most_passes_read_the_same_way_is_kept() -> None:
    """
    Two of three agreeing is evidence; one differing is what handwriting
    does. Insisting on all three meant a photographed prescription wrote
    nothing at all, which is safe and useless.
    """
    from healthathon.uploads.consensus import combine

    steady = RegimenLine(0, "Tab. Metformin", "500 mg", "1-0-1")
    majority = RegimenLine(1, "Tab. Glicazide", "80 mg", "1-0-0")
    odd_one = RegimenLine(1, "Tab. Glicazide", "40 mg", "1-0-0")

    agreed = combine(
        [
            DocumentReading(lines=[steady, majority]),
            DocumentReading(lines=[steady, odd_one]),
            DocumentReading(lines=[steady, majority]),
        ]
    )
    kept = {line.box_index: line.dose_text for line in agreed.reading.lines}
    assert kept == {0: "500 mg", 1: "80 mg"}
    assert agreed.reading.unreadable == []


def test_a_line_no_majority_agrees_on_is_named_not_dropped() -> None:
    """
    Dropping it left a medicine that is on the page in front of nobody.
    It is written with the most-agreed reading and its box is named, so
    its reread check fails and a clinician confirms it against the crop.
    """
    from healthathon.uploads.consensus import combine

    agreed = combine(
        [
            DocumentReading(lines=[RegimenLine(1, "Tab. Glicazide", "80 mg", "1-0-0")]),
            DocumentReading(lines=[RegimenLine(1, "Tab. Glicazide", "40 mg", "1-0-0")]),
            DocumentReading(lines=[RegimenLine(1, "Tab. Glicazide", "20 mg", "1-0-0")]),
        ]
    )
    assert [line.box_index for line in agreed.reading.lines] == [1]
    assert agreed.disagreed == {1}


def test_one_pass_leaves_nothing_to_compare() -> None:
    from healthathon.uploads.consensus import combine

    only = DocumentReading(values=[LabValue(0, "hba1c", "7.4")])
    agreed = combine([only])
    assert agreed.other_reads == {}
    assert agreed.reading is only


# ---- the confidence number -----------------------------------------


def _outcomes(**by_code: str) -> list[checks.CheckOutcome]:
    return [checks.CheckOutcome(code, outcome) for code, outcome in by_code.items()]


def test_a_reading_that_passes_everything_scores_one() -> None:
    out = _outcomes(
        grounding="pass",
        legibility="pass",
        well_formed="pass",
        reread_agreement="pass",
        cross_document="pass",
    )
    assert checks.confidence(out) == 1.0


def test_the_score_is_the_share_of_checks_passed() -> None:
    out = _outcomes(
        grounding="pass",
        legibility="fail",
        well_formed="pass",
        reread_agreement="pass",
        cross_document="pass",
    )
    assert checks.confidence(out) == 0.75


def test_a_check_that_did_not_apply_counts_against_nothing() -> None:
    """One document and one pass leave two checks with nothing to say."""
    out = _outcomes(
        grounding="pass",
        legibility="pass",
        well_formed="pass",
        reread_agreement="not_applicable",
        cross_document="not_applicable",
    )
    assert checks.confidence(out) == 1.0


def test_no_region_on_the_page_scores_zero_whatever_else_passed() -> None:
    out = _outcomes(
        grounding="fail",
        legibility="pass",
        well_formed="pass",
        reread_agreement="pass",
        cross_document="pass",
    )
    assert checks.confidence(out) == 0.0


def test_the_score_never_comes_from_the_model() -> None:
    """Nothing the agent returns reaches the score: only the checks do."""
    import inspect

    source = inspect.getsource(checks.confidence)
    assert "value_text" not in source and "agent" not in source


def test_a_provider_error_never_carries_the_key_with_it() -> None:
    """
    The key rides in Gemini's query string, so httpx puts it in the text
    of every error. That text becomes an upload's failure message, which
    is shown on screen and written to the audit log.
    """
    import httpx

    from healthathon.uploads.providers import _redacted

    exc = httpx.HTTPError(
        "Client error '404 Not Found' for url "
        "'https://generativelanguage.googleapis.com/v1beta/models/x:generateContent"
        "?key=AQ.SuperSecretValue123'"
    )
    message = _redacted(exc)
    assert "SuperSecret" not in message
    assert "key=REDACTED" in message
    # The part a person needs to act on survives.
    assert "404" in message


# ---- reading a page in several calls --------------------------------


class CountingClient:
    """Answers each batch, and remembers how many images it was shown."""

    name = "counting"
    model = "counting-1"

    def __init__(self, replies: list[dict[str, Any]]) -> None:
        self.replies = replies
        self.image_counts: list[int] = []

    def complete_json(self, prompt: str, images: list[Path]) -> dict[str, Any]:
        self.image_counts.append(len(images))
        return self.replies[len(self.image_counts) - 1]


def test_a_page_with_many_regions_is_read_in_several_calls(tmp_path: Path) -> None:
    """A provider refuses too many images at once, so the crops go in batches."""
    client = CountingClient(
        [
            {"values": [{"box": 0, "analyte": "hba1c", "value": "7.4", "unit": "%"}]},
            {"values": [{"box": 1, "analyte": "fpg", "value": "162", "unit": "mg/dL"}]},
        ]
    )
    agent = ModelDocumentAgent(client, CODES, max_crops_per_call=3)
    reading = agent.read("lab_report", tmp_path / "p.png", crops(tmp_path, 5))

    # Two calls: three crops then two, each with the whole page alongside.
    assert client.image_counts == [4, 3]
    assert [v.value_text for v in reading.values] == ["7.4", "162"]


def test_a_crop_number_from_a_later_batch_maps_to_the_real_region(tmp_path: Path) -> None:
    """
    The model numbers what it is shown from zero every call. Provenance
    depends on that becoming the crop's own index again.
    """
    client = CountingClient(
        [
            {"values": []},
            # Second batch: its "box 1" is the page's crop 4.
            {
                "values": [{"box": 1, "analyte": "fpg", "value": "162", "unit": "mg/dL"}],
                "unreadable": [0],
            },
        ]
    )
    agent = ModelDocumentAgent(client, CODES, max_crops_per_call=3)
    reading = agent.read("lab_report", tmp_path / "p.png", crops(tmp_path, 5))

    assert [v.box_index for v in reading.values] == [4]
    assert reading.unreadable == [3]


def test_a_row_of_columns_comes_back_left_to_right() -> None:
    """
    A laboratory row is three regions: the test, its value, its unit.
    They reached the agent as value, test, unit once, because ordering
    compared each box against one neighbour instead of its whole line.
    """
    row = [
        Box(0.560, 0.295, 0.05, 0.02),  # the value, found first
        Box(0.085, 0.296, 0.09, 0.02),  # the test name
        Box(0.719, 0.294, 0.04, 0.02),  # the unit
    ]
    assert [round(b.x, 3) for b in sort_reading_order(row)] == [0.085, 0.560, 0.719]


def test_rows_stay_in_order_and_each_is_sorted_within_itself() -> None:
    boxes = [
        Box(0.56, 0.341, 0.05, 0.02),
        Box(0.08, 0.342, 0.09, 0.02),
        Box(0.56, 0.295, 0.05, 0.02),
        Box(0.08, 0.296, 0.09, 0.02),
    ]
    got = sort_reading_order(boxes)
    # The upper line first, each line left to right.
    assert [round(b.x, 2) for b in got] == [0.08, 0.56, 0.08, 0.56]
    assert got[0].y < got[2].y and got[1].y < got[3].y


def test_the_agent_sees_the_labelled_crop_and_the_checks_see_the_clean_one(
    tmp_path: Path,
) -> None:
    """
    A label is edges, and edges are what legibility counts. If the agent
    and the legibility check read the same file, every region looks sharp.
    """
    client = StubClient({"values": []})
    made = crops(tmp_path, 2)
    ModelDocumentAgent(client, CODES).read("lab_report", tmp_path / "p.png", made)

    shown = client.images[0][:-1]  # the page is last
    assert shown == [c.labelled for c in made]
    assert all(c.labelled != c.path for c in made)


def test_the_legibility_floor_sits_between_blurred_and_legible() -> None:
    """
    The floor was measured, not guessed: on generated documents read by
    the real detector, legible crops scored 1569 and above and blurred
    crops 1357 and below. A floor outside that band either queues
    readable handwriting or lets blur into the record.
    """
    from healthathon.config import Settings

    floor = Settings().legibility_min_sharpness
    assert 1357 < floor < 1569


# ---- when a model will not answer -----------------------------------


class FlakyTransport:
    """Refuses the first N models, then answers."""

    def __init__(self, refuse: int) -> None:
        self.refuse = refuse
        self.tried: list[str] = []

    def __call__(self, url: str, **kw: Any) -> Any:
        import httpx

        model = url.split("/models/")[1].split(":")[0]
        self.tried.append(model)
        if len(self.tried) <= self.refuse:
            raise httpx.HTTPError(f"Server error '503 Service Unavailable' for url '{url}'")
        return httpx.Response(
            200,
            json={"candidates": [{"content": {"parts": [{"text": '{"values": []}'}]}}]},
            request=httpx.Request("POST", url),
        )


def test_a_model_that_will_not_answer_is_passed_over(monkeypatch: Any, tmp_path: Path) -> None:
    """
    On the free tier one model is out of quota for the day while another
    is briefly overloaded. Both say so with a status code, never with a
    wrong reading, so the next one is safe to try.
    """
    from healthathon.uploads.providers import GeminiClient

    transport = FlakyTransport(refuse=2)
    monkeypatch.setattr("healthathon.uploads.providers.httpx.post", transport)
    monkeypatch.setattr("healthathon.uploads.providers.time.sleep", lambda _: None)

    client = GeminiClient("k", ["first", "second", "third"], 10.0, retries=0)
    assert client.complete_json("prompt", []) == {"values": []}
    assert transport.tried == ["first", "second", "third"]
    # The run must record the model that actually read the page.
    assert client.model == "third"


def test_when_no_model_answers_the_reader_says_so(monkeypatch: Any) -> None:
    from healthathon.uploads.providers import GeminiClient, ModelUnavailable

    monkeypatch.setattr("healthathon.uploads.providers.httpx.post", FlakyTransport(refuse=99))
    monkeypatch.setattr("healthathon.uploads.providers.time.sleep", lambda _: None)

    client = GeminiClient("k", ["a", "b"], 10.0, retries=0)
    with pytest.raises(ModelUnavailable):
        client.complete_json("prompt", [])


def test_the_agent_names_the_model_that_answered(monkeypatch: Any, tmp_path: Path) -> None:
    from healthathon.uploads.providers import GeminiClient

    monkeypatch.setattr("healthathon.uploads.providers.httpx.post", FlakyTransport(refuse=1))
    monkeypatch.setattr("healthathon.uploads.providers.time.sleep", lambda _: None)

    page = tmp_path / "p.png"
    page.write_bytes(page_image(80, 40))
    agent = ModelDocumentAgent(GeminiClient("k", ["busy", "free"], 10.0, retries=0), CODES)
    agent.read("lab_report", page, crops(tmp_path, 1))
    assert agent.version == "gemini:free"


# ---- reading a page more than once, together ------------------------


class SlowClient:
    """Takes its time, and records when each call started and ended."""

    name = "slow"
    model = "slow-1"

    def __init__(self, seconds: float) -> None:
        self.seconds = seconds
        self.spans: list[tuple[float, float]] = []
        self._lock = __import__("threading").Lock()

    def complete_json(self, prompt: str, images: list[Path]) -> dict[str, Any]:
        import time

        start = time.monotonic()
        time.sleep(self.seconds)
        with self._lock:
            self.spans.append((start, time.monotonic()))
        return {"values": []}


def _overlapping(spans: list[tuple[float, float]]) -> bool:
    ordered = sorted(spans)
    return any(b[0] < a[1] for a, b in zip(ordered, ordered[1:], strict=False))


def test_the_batches_of_one_read_run_together(tmp_path: Path) -> None:
    """
    Each call is almost entirely waiting for a reply, so batches that do
    not depend on each other should not queue behind each other.
    """
    client = SlowClient(0.3)
    agent = ModelDocumentAgent(client, CODES, max_crops_per_call=2)
    agent.read("lab_report", tmp_path / "p.png", crops(tmp_path, 6))

    assert len(client.spans) == 3
    assert _overlapping(client.spans), f"batches ran one after another: {client.spans}"


def test_the_context_page_is_small_and_the_crops_are_not(tmp_path: Path, monkeypatch: Any) -> None:
    """
    The whole page travels with every call and the prompt forbids
    reading a value off it, so it goes as a smaller JPEG. The crops are
    what gets read, and stay PNG at full size.

    monkeypatch, not os.environ: setting the storage directory and
    leaving it set sent every later test's files to a temporary folder.
    """
    from PIL import Image

    from healthathon.config import get_settings
    from healthathon.uploads.pipeline import context_page

    monkeypatch.setenv("HEALTHATHON_STORAGE_DIR", str(tmp_path))
    get_settings.cache_clear()
    try:
        page = tmp_path / "page.png"
        page.write_bytes(page_image(2400, 3200))

        small = context_page(page, "a" * 64, widest=1024)
        assert small.suffix == ".jpg"
        assert small.stat().st_size < page.stat().st_size
        with Image.open(small) as img:
            assert max(img.size) <= 1024
    finally:
        get_settings.cache_clear()


def test_a_jpeg_is_sent_as_a_jpeg(tmp_path: Path) -> None:
    from healthathon.uploads.providers import _mime

    assert _mime(tmp_path / "context.jpg") == "image/jpeg"
    assert _mime(tmp_path / "007.png") == "image/png"


def test_a_column_break_is_not_merged_into_one_line() -> None:
    """
    A consultation card keeps measurements down one side and the
    prescribing on the other. Merging on height alone swept a whole row
    into one crop, and the glucose and the medicine arrived as a single
    smear that read as neither.
    """
    row = [
        Box(0.05, 0.300, 0.12, 0.02),  # left column: a measurement
        Box(0.55, 0.301, 0.20, 0.02),  # right column: the drug
        Box(0.78, 0.300, 0.10, 0.02),  # its dose, next to the drug
    ]
    merged = merge_lines(row, max_gap=0.08)
    assert len(merged) == 2, merged
    left, right = merged
    assert round(left.x, 2) == 0.05 and round(left.w, 2) == 0.12
    # The drug and its dose, which sit together, became one region.
    assert round(right.x, 2) == 0.55 and round(right.x + right.w, 2) == 0.88


def test_neighbouring_runs_on_one_line_still_join() -> None:
    drug_then_dose = [Box(0.19, 0.20, 0.25, 0.02), Box(0.47, 0.20, 0.10, 0.02)]
    assert len(merge_lines(drug_then_dose, max_gap=0.08)) == 1


# ---- reading the whole page and snapping onto a region --------------


def whole_crops(tmp_path: Path, boxes: list[Box]) -> list[Crop]:
    made = []
    for i, box in enumerate(boxes):
        path = tmp_path / f"w{i}.png"
        path.write_bytes(page_image(80, 40))
        made.append(Crop(index=i, path=path, storage_key=f"k/{i}.png", labelled=path, box=box))
    return made


def test_a_reading_lands_on_the_region_its_box_sits_on(tmp_path: Path) -> None:
    """
    The detector still owns the regions. The model says roughly where a
    reading is and geometry decides which region that is, instead of the
    model naming an index it has to count to.
    """
    from healthathon.uploads.whole_page import WholePageAgent

    boxes = [
        Box(0.10, 0.10, 0.30, 0.03),
        Box(0.10, 0.40, 0.30, 0.03),  # the one the model points at
        Box(0.10, 0.70, 0.30, 0.03),
    ]
    client = StubClient(
        {
            "medicines": [
                {
                    "box": [400, 100, 430, 400],
                    "drug": "Tab. Oxra",
                    "dose": "10 mg",
                    "schedule": "OD",
                }
            ]
        }
    )
    agent = WholePageAgent(client, CODES)
    reading = agent.read("prescription", tmp_path / "p.png", whole_crops(tmp_path, boxes))

    assert [(line.box_index, line.drug_text) for line in reading.lines] == [(1, "Tab. Oxra")]
    # One call, and the page is the only image sent.
    assert len(client.images) == 1 and len(client.images[0]) == 1


def test_a_reading_that_sits_on_no_region_is_not_stored(tmp_path: Path) -> None:
    """
    Without a region there is nothing to point at on the page, and
    core.extracted_value cannot be written without provenance.
    """
    from healthathon.uploads.whole_page import WholePageAgent

    boxes = [Box(0.10, 0.10, 0.30, 0.03)]
    client = StubClient(
        {
            "medicines": [{"box": [900, 900, 950, 990], "drug": "Tab. Nowhere", "dose": "5 mg"}],
            "results": [{"box": [900, 900, 950, 990], "analyte": "fpg", "value": "180"}],
        }
    )
    agent = WholePageAgent(client, CODES)
    reading = agent.read("prescription", tmp_path / "p.png", whole_crops(tmp_path, boxes))

    assert reading.lines == []
    assert reading.values == []


def test_a_medicine_with_no_written_dose_goes_to_a_clinician(tmp_path: Path) -> None:
    """
    Dropping these lost two of the five medicines on a real card:
    "Nebicand" and "Nebimed - T" are written without a dose, and the
    reader threw both away in silence.
    """
    from healthathon.uploads.whole_page import WholePageAgent

    boxes = [Box(0.10, 0.40, 0.30, 0.03)]
    client = StubClient(
        {"medicines": [{"box": [400, 100, 430, 400], "drug": "Tab. Nebimed", "dose": None}]}
    )
    reading = WholePageAgent(client, CODES).read(
        "prescription", tmp_path / "p.png", whole_crops(tmp_path, boxes)
    )
    assert [line.drug_text for line in reading.lines] == ["Tab. Nebimed"]
    # An empty dose fails the dose check, which is what sends it to a person.
    assert reading.lines[0].dose_text == ""


def test_a_result_on_a_card_snaps_to_its_own_region(tmp_path: Path) -> None:
    from healthathon.uploads.whole_page import WholePageAgent

    boxes = [Box(0.05, 0.30, 0.15, 0.03), Box(0.55, 0.30, 0.30, 0.03)]
    client = StubClient(
        {
            "results": [
                {"box": [300, 50, 330, 200], "analyte": "fpg", "value": "180", "unit": "mg/dL"}
            ]
        }
    )
    agent = WholePageAgent(client, CODES)
    reading = agent.read("prescription", tmp_path / "p.png", whole_crops(tmp_path, boxes))
    assert [(v.box_index, v.analyte_code, v.value_text) for v in reading.values] == [
        (0, "fpg", "180")
    ]


def test_a_box_the_model_malformed_is_ignored(tmp_path: Path) -> None:
    from healthathon.uploads.whole_page import snap

    regions = [Box(0.1, 0.1, 0.3, 0.03)]
    for bad in (None, [], [1, 2, 3], ["a", "b", "c", "d"], [500, 500, 400, 400]):
        assert snap(bad, regions) is None


# ---- regions that swallowed their neighbours ------------------------


def test_a_tall_region_is_trimmed_where_the_next_one_starts() -> None:
    """
    PaddleOCR returns tall polygons for slanted handwriting. One crop on
    a real card held three medicines, so a reading could be said to sit
    on any of three regions and the wrong one won.
    """
    stacked = [
        Box(0.37, 0.221, 0.53, 0.063),  # reaches past the line below
        Box(0.37, 0.261, 0.55, 0.073),
        Box(0.37, 0.312, 0.50, 0.070),
    ]
    out = merge_lines(stacked)
    for a, b in zip(out, out[1:], strict=False):
        assert a.y + a.h <= b.y + 1e-9, f"{a} still runs into {b}"


def test_a_region_in_another_column_does_not_trim_this_one() -> None:
    side_by_side = [
        Box(0.05, 0.20, 0.10, 0.08),  # left column, tall
        Box(0.60, 0.25, 0.20, 0.03),  # right column, lower down
    ]
    out = merge_lines(side_by_side)
    tall = next(b for b in out if round(b.x, 2) == 0.05)
    assert round(tall.h, 3) == 0.08


# ---- an unclear match goes to a person ------------------------------


def test_a_reading_between_two_regions_is_marked_unsure(tmp_path: Path) -> None:
    """Guessing between two near-equal regions put an HbA1c on a glucose line."""
    from healthathon.uploads.whole_page import snap

    regions = [Box(0.10, 0.20, 0.40, 0.04), Box(0.10, 0.23, 0.40, 0.04)]
    said = [210, 100, 260, 500]  # sits across both
    got = snap(said, regions)
    assert got is not None and got.sure is False


def test_a_reading_squarely_on_one_region_is_sure(tmp_path: Path) -> None:
    from healthathon.uploads.whole_page import snap

    regions = [Box(0.10, 0.20, 0.40, 0.03), Box(0.10, 0.60, 0.40, 0.03)]
    got = snap([200, 100, 230, 500], regions)
    assert got is not None and got.sure is True


def test_the_same_medicine_read_twice_is_written_once(tmp_path: Path) -> None:
    """A page listing three drugs wrote the first of them down twice."""
    from healthathon.uploads.whole_page import WholePageAgent

    boxes = [Box(0.37, 0.22, 0.53, 0.03), Box(0.37, 0.50, 0.55, 0.03)]
    client = StubClient(
        {
            "medicines": [
                {
                    "box": [220, 370, 250, 900],
                    "drug": "Tab Dafalex-P",
                    "dose": "1 tab",
                    "schedule": "OD",
                },
                {
                    "box": [500, 370, 530, 920],
                    "drug": "Tab Dafalex-P",
                    "dose": "1 tab",
                    "schedule": "OD",
                },
            ]
        }
    )
    reading = WholePageAgent(client, CODES).read(
        "prescription", tmp_path / "p.png", whole_crops(tmp_path, boxes)
    )
    assert [line.drug_text for line in reading.lines] == ["Tab Dafalex-P"]


# ---- one medicine read several ways ---------------------------------


def test_one_drug_spelt_three_ways_becomes_one_line(tmp_path: Path) -> None:
    """
    A real card returned "Tab. Cilacar", "Cilashort (10)" and
    "Tab. Cilacarst" on three adjacent lines. One drug, read three
    ways, filling the review screen with the same medicine.
    """
    from healthathon.uploads.whole_page import WholePageAgent

    boxes = [
        Box(0.50, 0.685, 0.30, 0.02),
        Box(0.50, 0.708, 0.30, 0.02),
        Box(0.50, 0.732, 0.30, 0.02),
    ]
    client = StubClient(
        {
            "medicines": [
                {
                    "box": [686, 500, 700, 800],
                    "drug": "Tab. Cilacar",
                    "dose": "10",
                    "schedule": "OD",
                },
                {
                    "box": [709, 500, 723, 800],
                    "drug": "Cilashort (10)",
                    "dose": "10",
                    "schedule": None,
                },
                {
                    "box": [733, 500, 747, 800],
                    "drug": "Tab. Cilacarst",
                    "dose": "(10)",
                    "schedule": "OD",
                },
            ]
        }
    )
    reading = WholePageAgent(client, CODES).read(
        "prescription", tmp_path / "p.png", whole_crops(tmp_path, boxes)
    )
    assert len(reading.lines) == 1, [line.drug_text for line in reading.lines]
    # The readings disagreed about the name, so a person settles it.
    assert reading.lines[0].box_index in reading.ungrounded


def test_two_different_drugs_on_adjacent_lines_stay_apart(tmp_path: Path) -> None:
    """Adjacency alone must not merge: these are two medicines."""
    from healthathon.uploads.whole_page import WholePageAgent

    boxes = [Box(0.50, 0.685, 0.30, 0.02), Box(0.50, 0.708, 0.30, 0.02)]
    client = StubClient(
        {
            "medicines": [
                {
                    "box": [686, 500, 700, 800],
                    "drug": "Tab. Rybelsus",
                    "dose": "14 mg",
                    "schedule": "OD",
                },
                {
                    "box": [709, 500, 723, 800],
                    "drug": "Tab. Nebimed",
                    "dose": "14 mg",
                    "schedule": "BD",
                },
            ]
        }
    )
    reading = WholePageAgent(client, CODES).read(
        "prescription", tmp_path / "p.png", whole_crops(tmp_path, boxes)
    )
    assert len(reading.lines) == 2


def test_the_same_drug_at_a_different_dose_is_two_medicines(tmp_path: Path) -> None:
    from healthathon.uploads.whole_page import WholePageAgent

    boxes = [Box(0.50, 0.685, 0.30, 0.02), Box(0.50, 0.708, 0.30, 0.02)]
    client = StubClient(
        {
            "medicines": [
                {"box": [686, 500, 700, 800], "drug": "Tab. Cyra", "dose": "20", "schedule": "OD"},
                {"box": [709, 500, 723, 800], "drug": "Tab. Cyra", "dose": "40", "schedule": "HS"},
            ]
        }
    )
    reading = WholePageAgent(client, CODES).read(
        "prescription", tmp_path / "p.png", whole_crops(tmp_path, boxes)
    )
    assert len(reading.lines) == 2


def test_folding_keeps_the_schedule_a_reading_supplied(tmp_path: Path) -> None:
    from healthathon.uploads.whole_page import WholePageAgent

    boxes = [Box(0.50, 0.68, 0.30, 0.02), Box(0.50, 0.70, 0.30, 0.02)]
    client = StubClient(
        {
            "medicines": [
                {
                    "box": [681, 500, 695, 800],
                    "drug": "Tab. Cyra - 20",
                    "dose": "20",
                    "schedule": None,
                },
                {
                    "box": [701, 500, 715, 800],
                    "drug": "Cycra - 20",
                    "dose": "20",
                    "schedule": "1 x BD",
                },
            ]
        }
    )
    reading = WholePageAgent(client, CODES).read(
        "prescription", tmp_path / "p.png", whole_crops(tmp_path, boxes)
    )
    assert len(reading.lines) == 1
    assert reading.lines[0].schedule_text == "1 x BD"


def test_the_same_drug_and_dose_folds_however_far_apart(tmp_path: Path) -> None:
    """
    Rybelsus came back twice, on lines a hair too far apart for the
    distance rule to join them. The name and the dose already say it is
    one medicine.
    """
    from healthathon.uploads.whole_page import WholePageAgent

    boxes = [Box(0.50, 0.553, 0.30, 0.02), Box(0.50, 0.595, 0.30, 0.02)]
    client = StubClient(
        {
            "medicines": [
                {
                    "box": [554, 500, 568, 800],
                    "drug": "Rybelsus",
                    "dose": "14 mg",
                    "schedule": "OD",
                },
                {
                    "box": [596, 500, 610, 800],
                    "drug": "Tab. Rybelsus",
                    "dose": "14 mg",
                    "schedule": "OD",
                },
            ]
        }
    )
    reading = WholePageAgent(client, CODES).read(
        "prescription", tmp_path / "p.png", whole_crops(tmp_path, boxes)
    )
    assert [line.drug_text for line in reading.lines] == ["Rybelsus"]


def test_two_unlike_drugs_far_apart_never_fold(tmp_path: Path) -> None:
    """Distance still guards the loose matches, which is what it is for."""
    from healthathon.uploads.whole_page import WholePageAgent

    boxes = [Box(0.50, 0.20, 0.30, 0.02), Box(0.50, 0.80, 0.30, 0.02)]
    client = StubClient(
        {
            "medicines": [
                {
                    "box": [201, 500, 215, 800],
                    "drug": "Tab. Cilacar",
                    "dose": "10",
                    "schedule": "OD",
                },
                {"box": [801, 500, 815, 800], "drug": "Cilashort", "dose": "10", "schedule": "OD"},
            ]
        }
    )
    reading = WholePageAgent(client, CODES).read(
        "prescription", tmp_path / "p.png", whole_crops(tmp_path, boxes)
    )
    assert len(reading.lines) == 2


# ---- straightening the page -----------------------------------------


def test_a_tilted_page_is_straightened(tmp_path: Path) -> None:
    """
    A degree or two of tilt makes the detector's regions run into the
    line below, and a reading then snaps onto its neighbour.
    """
    from PIL import Image, ImageDraw

    from healthathon.uploads.normalise import estimate_skew, straighten

    flat = Image.new("RGB", (900, 1200), "white")
    draw = ImageDraw.Draw(flat)
    for row in range(14):
        y = 90 + row * 70
        draw.rectangle((90, y, 810, y + 16), fill=(20, 20, 20))
    page = tmp_path / "tilted.png"
    flat.rotate(
        -2.5, resample=Image.Resampling.BICUBIC, expand=True, fillcolor=(255, 255, 255)
    ).save(page)

    # Pillow turns anticlockwise for a positive angle, so a page tilted
    # by -2.5 reads as writing sloping the other way, and straighten
    # turns it back by what it measured.
    measured = estimate_skew(page)
    assert abs(measured - 2.5) < 1.0, measured
    out, turned = straighten(page, tmp_path / "straight.png")
    assert out.name == "straight.png"
    assert abs(turned - 2.5) < 1.0
    # What came out is squarer than what went in.
    assert abs(estimate_skew(out)) < abs(estimate_skew(page))


def test_a_square_page_is_left_alone(tmp_path: Path) -> None:
    """Rotating a page that is already straight costs resampling and buys nothing."""
    from PIL import Image, ImageDraw

    from healthathon.uploads.normalise import straighten

    img = Image.new("RGB", (900, 1200), "white")
    draw = ImageDraw.Draw(img)
    for row in range(14):
        y = 90 + row * 70
        draw.rectangle((90, y, 810, y + 16), fill=(20, 20, 20))
    page = tmp_path / "square.png"
    img.save(page)

    out, turned = straighten(page, tmp_path / "straight.png")
    assert out == page and turned == 0.0


def test_a_page_with_nothing_to_measure_is_left_alone(tmp_path: Path) -> None:
    from healthathon.uploads.normalise import estimate_skew, straighten

    blank = tmp_path / "blank.png"
    blank.write_bytes(page_image(400, 500, blurry=True))
    assert estimate_skew(blank) == 0.0
    out, turned = straighten(blank, tmp_path / "s.png")
    assert out == blank and turned == 0.0
