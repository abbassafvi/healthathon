"""
What each agent is asked. One prompt per document type.

Both prompts carry the same three rules: copy what is printed rather than
tidying it, cite the region every reading came from, and say when a
region cannot be read instead of guessing at it. The third rule is the
one that keeps a doubtful value out of the record and in front of a
person.
"""

COMMON = """\
You are reading one page of a medical document. It has been photographed,
so it may be skewed, shadowed or creased.

You are shown {count} crops, in reading order. Each one carries its own
number printed in a black bar along its top, as "CROP 7". That printed
number is the crop's index: read it off the image rather than counting
the images you were shown. The black bar is a label this system added
and is not part of the document. The whole page is the last image, for
context only: never read a value off the whole page that is not in a
numbered crop.

Rules, in order of importance:
1. Copy the characters exactly as printed or written. Do not correct
   spelling, expand an abbreviation, convert a unit or tidy a number.
2. Every item you return must carry the "box" index of the crop you read
   it from. An item with no crop behind it must not be returned at all.
3. If a crop is too unclear to read with confidence, put its index in
   "unreadable" and return no item for it. A wrong reading is worse than
   an unread one: unread goes to a person, wrong goes into the record.
4. Do not infer, estimate, calculate or complete anything. No clinical
   interpretation of any kind.

Reply with JSON only, in exactly this shape:
{shape}
"""

LAB_SHAPE = """\
{
  "document_date": "YYYY-MM-DD or null, the date printed on the report",
  "issuing_source": "the laboratory or hospital name as printed, or null",
  "values": [
    {"box": 0, "analyte": "one of the allowed codes",
     "value": "the number exactly as printed, as a string",
     "unit": "the unit exactly as printed, or null"}
  ],
  "orders": [
    {"box": 0, "analyte": "a code the page asks for but does not report"}
  ],
  "unreadable": [0]
}"""

RX_SHAPE = """\
{
  "document_date": "YYYY-MM-DD or null, the date written on the prescription",
  "issuing_source": "the prescriber or clinic as written, or null",
  "lines": [
    {"box": 0,
     "drug": "the drug name as written, with its form if present",
     "dose": "the dose as written, e.g. 500 mg",
     "schedule": "the schedule as written, e.g. 1-0-1, or null"}
  ],
  "orders": [
    {"box": 0, "analyte": "a test the prescription asks for"}
  ],
  "values": [
    {"box": 0, "analyte": "an allowed code this page reports a result for",
     "value": "the number exactly as written, as a string",
     "unit": "the unit as written, or null"}
  ],
  "unreadable": [0]
}"""

LAB_EXTRA = """\
Only these analyte codes may be used, and only when the page clearly
names that analyte: {codes}. A row naming anything else is not yours to
return; leave it out entirely rather than forcing it into a code.

A value belongs in "values" when the page reports a result for it, and in
"orders" when the page asks for the test without reporting a result."""

RX_EXTRA = """\
One item per prescribed medicine. Keep the drug, the dose and the
schedule in separate fields, each as written. A medicine whose dose is
not written is still prescribed: return it with "dose" null rather than
leaving it out, and a clinician will settle it.

Never map a brand name to a generic one. The generic name is not printed
on the page, so there would be no region to check it against.

A prescription often advises tests as well as medicines, under a heading
like "Adv:". Those go in "orders", one per test, each with the crop it
was read from, and only when the test is one of these codes: {codes}. A
test named in any other words is not yours to return.

A consultation card often carries a result the clinician wrote down
beside the prescribing, such as "F = 180" for fasting glucose or
"PP = 205" after a meal. Put those in "values", using the same codes.
Only a result that is one of those codes belongs there: a blood
pressure, a height, a weight and a body mass index have no code here,
so leave them out rather than forcing them into one. Never return a
diagnosis, and never return advice about diet or exercise."""


def lab_report_prompt(count: int, codes: list[str]) -> str:
    return (
        COMMON.format(count=count, shape=LAB_SHAPE)
        + "\n"
        + LAB_EXTRA.format(codes=", ".join(sorted(codes)))
    )


def prescription_prompt(count: int, codes: list[str]) -> str:
    return (
        COMMON.format(count=count, shape=RX_SHAPE)
        + "\n"
        + RX_EXTRA.format(codes=", ".join(sorted(codes)))
    )


# ---------------------------------------------------------------------
# Reading the whole page at once.
#
# The crop reader shows each region on its own and asks the agent to say
# which one it read from. It miscounts: readings came back citing the
# same region, or a tidy arithmetic sequence pointing at the wrong rows.
# Shown the whole page, the same model reads it correctly every time.
#
# So it reads the page and says roughly where each reading sits, and the
# detector's regions decide exactly where. A reading that overlaps no
# region cannot be pointed at, and is never stored.
# ---------------------------------------------------------------------

WHOLE_PAGE = """\
You are reading one page of a medical document. It has been
photographed, so it may be skewed, shadowed or creased.

Rules, in order of importance:
1. Copy the characters exactly as printed or written. Do not correct
   spelling, expand an abbreviation, convert a unit or tidy a number.
2. Give every item a "box", as [ymin, xmin, ymax, xmax] normalised to
   0-1000, around the writing you read it from. The box is how a
   clinician finds it on the page again, so it must sit on that writing
   and not on the whole line or the whole page.
3. Leave out anything you cannot read with confidence. A wrong reading
   is worse than a missing one: missing goes to a person, wrong goes
   into the record.
4. Do not infer, estimate, calculate or complete anything. No clinical
   interpretation of any kind.

Reply with JSON only, in exactly this shape:
{shape}
"""

WHOLE_RX_SHAPE = """\
{
  "document_date": "YYYY-MM-DD or null, the date written on the page",
  "issuing_source": "the prescriber or clinic as written, or null",
  "medicines": [
    {"box": [0, 0, 0, 0],
     "drug": "the drug name as written, with its form if present",
     "dose": "the dose as written, e.g. 500 mg or 12.5/1000",
     "schedule": "the schedule as written, e.g. 1-0-1 or OD, or null"}
  ],
  "results": [
    {"box": [0, 0, 0, 0], "analyte": "one of the allowed codes",
     "value": "the number exactly as written", "unit": "as written, or null"}
  ],
  "orders": [
    {"box": [0, 0, 0, 0], "analyte": "a test the page asks for"}
  ],
  "advice": [
    {"box": [0, 0, 0, 0], "text": "an instruction that is not a medicine, as written"}
  ]
}"""

WHOLE_LAB_SHAPE = """\
{
  "document_date": "YYYY-MM-DD or null, the date printed on the report",
  "issuing_source": "the laboratory or hospital as printed, or null",
  "results": [
    {"box": [0, 0, 0, 0], "analyte": "one of the allowed codes",
     "value": "the number exactly as printed", "unit": "as printed, or null"}
  ],
  "orders": [
    {"box": [0, 0, 0, 0], "analyte": "a test the page asks for but does not report"}
  ]
}"""

ALLOWED = """\
Only these analyte codes may be used, and only when the page clearly
names that analyte: {codes}. A blood pressure, a height, a weight and a
body mass index have no code here, so leave them out rather than forcing
them into one. Never return a diagnosis, and never return advice about
diet or exercise."""

WHOLE_RX_EXTRA = """\
One item in "medicines" per prescribed medicine, with its box on the
line it is written on. Never map a brand name to a generic one: the
generic is not on the page, so there would be nothing to check it
against. A medicine whose dose is not written is still prescribed:
return it with "dose" null rather than leaving it out, and a clinician
will settle it.

A consultation card often writes a result beside the prescribing, such
as "F = 180" for fasting glucose, a weight, or a blood pressure. Those
go in "results". A blood pressure is one reading of two numbers, so
give it exactly as written, "108/74", and never as two.

A prescription also asks things of the patient that are not medicines:
a diet, a daily walk, a measurement to bring next time. Put each in
"advice".

Read these with the context in mind, because they are a small set of
familiar instructions in a clinician's hand. A diet is written in
kilocalories a day, so "Diet = 1000 kcal/day" is what a line reading
"dict = 1000 ueg / day" actually says: read the word and the unit for
what they are rather than transcribing the shapes. The same goes for
"Daily walk", "Low salt diet" and a test named for the next visit.

This is reading the writing correctly, not rewriting it. Never change
a number, never total a diet, and never add an instruction that is not
on the page.

Never return a diagnosis. "T2DM", "HTN" and "morbid obesity" name the
patient's condition and are not yours to return, in any field."""


def whole_page_prompt(doc_type: str, codes: list[str]) -> str:
    shape = WHOLE_RX_SHAPE if doc_type == "prescription" else WHOLE_LAB_SHAPE
    text = WHOLE_PAGE.format(shape=shape) + "\n" + ALLOWED.format(codes=", ".join(sorted(codes)))
    if doc_type == "prescription":
        text += "\n\n" + WHOLE_RX_EXTRA
    return text
