import pytest

from healthathon.sms.parser import Answer, Problem, Reading, Tick, parse


def test_reads_each_instruction_on_its_own_line_or_after_a_semicolon() -> None:
    got, problems = parse("G 142 F\nt 2 y; T 1 N\nQ थोड़ा चक्कर आया")
    assert got == [
        Reading("142", "fasting"),
        Tick(2, True),
        Tick(1, False),
        Answer("थोड़ा चक्कर आया"),
    ]
    assert problems == []


@pytest.mark.parametrize(
    ("code", "context"),
    [("F", "fasting"), ("b", "before_meal"), ("A", "after_meal"), ("N", "bedtime"),
     ("O", "overnight"), ("R", "random")],
)  # fmt: skip
def test_every_context_code(code: str, context: str) -> None:
    assert parse(f"G 120 {code}") == ([Reading("120", context)], [])


def test_a_bare_number_is_refused_not_guessed() -> None:
    assert parse("G 142") == ([], [Problem("G 142", "no_context")])
    assert parse("G 142 X") == ([], [Problem("G 142 X", "no_context")])


def test_a_reading_must_be_a_number_as_written() -> None:
    assert parse("G high F") == ([], [Problem("G high F", "not_a_number")])
    assert parse("G 1,42 F") == ([], [Problem("G 1,42 F", "not_a_number")])
    # No range is applied: any number as written is kept.
    assert parse("G 1410 F") == ([Reading("1410", "fasting")], [])


def test_lines_that_do_not_match_are_named_and_the_rest_kept() -> None:
    got, problems = parse("G 150 A\nhello doctor\nT 2\nQ")
    assert got == [Reading("150", "after_meal")]
    assert problems == [
        Problem("hello doctor", "unknown"),
        Problem("T 2", "bad_tick"),
        Problem("Q", "empty_answer"),
    ]


def test_an_empty_message_has_nothing_in_it() -> None:
    assert parse("  \n ; ") == ([], [])
