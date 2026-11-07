from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration, read from HEALTHATHON_* environment variables."""

    model_config = SettingsConfigDict(env_prefix="HEALTHATHON_", env_file=".env")

    database_url: str = "postgresql://healthathon:healthathon@127.0.0.1:5434/healthathon"
    # Root for page images and crops. Never committed; see .gitignore.
    storage_dir: Path = Path(__file__).resolve().parents[3] / "storage"
    # The scope has one hardcoded user and no login. This is that user.
    stub_user_email: str = "demo.clinician@example.org"
    app_version: str = "0.1.0"
    # Dates the patient sees ("today", a tick's day, a paper form's week) are
    # days in the clinic's time zone, whatever the server's clock says.
    clinic_timezone: str = "Asia/Kolkata"
    # Browser origins allowed to call the API: the patient app's web build
    # in development and tests. The clinic app is served through the Vite
    # proxy and the Android app is not a browser, so neither needs this.
    # Set as JSON, e.g. HEALTHATHON_CORS_ORIGINS='["http://127.0.0.1:8091"]'.
    cors_origins: list[str] = ["http://localhost:8081", "http://127.0.0.1:8081"]
    # Phone numbers are stored only as an HMAC with this key (core.patient_phone).
    # The defaults are for development; set real values outside it, never in git.
    phone_hmac_key: str = "dev-only-phone-key"
    # The SMS gateway stand-in sends this in X-Gateway-Key.
    sms_gateway_key: str = "dev-only-gateway-key"
    # The voice provider's webhook sends this in X-Gateway-Key. Its own key,
    # not the SMS one: a leaked SMS key must not let anyone post call steps.
    # Empty means inbound voice is off, and the endpoint refuses everything,
    # which is the shipped default because no provider is chosen yet.
    voice_gateway_key: str = ""
    # Hosts a call recording may be fetched from. The provider hands over
    # a URL in a query parameter, and anything that fetches a URL a
    # caller supplied can be pointed at the inside of the network, so the
    # host is checked against this list and nothing else is fetched.
    # Empty means spoken answers by phone are off, which is the default
    # until a real call shows what Exotel's recording host actually is.
    voice_recording_hosts: list[str] = []
    # Exotel says a recording takes 5 to 20 minutes to become available,
    # depending on its length, so the fetch waits and tries again rather
    # than giving up on the first 404.
    voice_recording_tries: int = 8
    voice_recording_wait_s: int = 150
    # Patient sign-in by a code sent by SMS. With all three Twilio values set,
    # codes go through Twilio Verify. Without them sign-in is in test mode: the
    # code is shown on the sign-in screen and written to the log, which is for
    # development and the demonstration only. Set them outside git, never in it.
    twilio_account_sid: str | None = None
    twilio_auth_token: str | None = None
    twilio_verify_sid: str | None = None
    # Test mode only: a fixed code instead of a random one, for automated tests.
    otp_test_code: str | None = None
    # Signs the patient app's session tokens. Set a long random value outside development.
    session_secret: str = "dev-only-session-secret"
    session_days: int = 30
    # Codes one number may be sent in an hour. Browser tests sign in on the same numbers all day.
    otp_sends_per_hour: int = 5

    # ---- Reading pipeline -------------------------------------------
    # The document agent's model provider: "gemini" (AI Studio, a free
    # key and no card), "openai" for anything speaking the OpenAI chat
    # protocol (Groq, OpenRouter, Mistral), or "none" to store the page
    # and send every region to a person. Without a key the API behaves as
    # "none": it never invents a reading because a provider is missing.
    agent_provider: str = "gemini"
    # The text detector: "paddle" for PaddleOCR, or "stub" for the crude
    # built-in one the browser tests use. Never falls back on its own.
    # Straighten the page before reading it. A degree or two of tilt
    # makes the detector's regions run into the line below, and a
    # reading then snaps onto its neighbour. Costs about 0.15s.
    normalise_deskew: bool = True
    detector: str = "paddle"
    # Which PaddleOCR detection model. The mobile one finds the same
    # regions on these pages and detects in 0.7s against the default's
    # 4.2s, measured on a generated prescription. Empty uses whatever
    # PaddleOCR picks.
    detector_model: str = "PP-OCRv5_mobile_det"
    # oneDNN speeds detection up but is broken for this model in
    # paddlepaddle 3.3.1. Turn it on only after checking a page reads.
    detector_onednn: bool = False
    agent_api_key: str | None = None
    agent_model: str = "gemini-3.6-flash"
    # Tried in order after the model above, when it is out of quota for
    # the day or briefly overloaded. Both answer with a status code
    # rather than a wrong reading, so moving on is safe.
    agent_fallback_models: list[str] = [
        "gemini-3.5-flash-lite",
        "gemini-3.1-flash-lite",
        "gemini-3-flash-preview",
    ]
    # Only for "openai": where to send the request.
    agent_base_url: str = "https://openrouter.ai/api/v1"
    agent_timeout_s: float = 90.0
    # A provider under load answers 503 or 429. One retry, not three:
    # there are fallback models behind this one, and waiting out a busy
    # model three times over before trying a free one made a read take
    # seventy-five seconds. Moving on is faster than waiting.
    agent_retries: int = 1
    # Crops sent in one request. A provider refuses a request carrying too
    # many images, so a page with more regions than this is read in
    # several calls and the answers are put back together.
    #
    # A photographed prescription yields 30 to 40 regions. Sent as one
    # request three times over, Gemini answered 503. Eighteen keeps each
    # request near the size that was measured to work, at the cost of a
    # second request per read.
    # How the agent is shown the page. "whole_page" reads it in one
    # call and snaps each reading onto a detected region, which costs
    # one request per read instead of one per batch of crops, and does
    # not ask the model to count images. "crops" shows each region on
    # its own, which is the older way.
    agent_strategy: str = "whole_page"
    # Only for "crops".
    agent_max_crops_per_call: int = 18
    # Under "whole_page" this image IS the page the model reads, so its
    # width is the resolution the reading is made at. 1024 was chosen
    # when the page was context the prompt forbade reading from, and a
    # review pointed out it had stopped being that: a decimal point on a
    # photographed card does not survive the shrink, while the legibility
    # check still measures the full-size crop and passes it. 2048 keeps
    # the upload bounded without throwing away the stroke detail.
    agent_context_page_px: int = 2048
    # How many times the agent reads the page. The passes are compared,
    # and a reading that changes between them is not trusted: it goes to
    # a person. Three is the deterministic layer's "ask again". Set 1 to
    # read once and skip the check, which costs a third as much.
    agent_reads: int = 3
    # A region blurrier than this fails the legibility check and goes to
    # a person. Edge variance measured on the crop, ignoring its border.
    #
    # Measured on generated documents read by the real detector:
    #
    #   clean laboratory value   2349 to 3486
    #   legible handwriting      1569 to 2148
    #   blurred                    23 to 1357
    #
    # So anything legible scored 1569 or above and anything blurred 1357
    # or below. 1450 sits inside that band. The margin to legible is
    # thin, which is the right way round to be wrong: a legible crop sent
    # to a person costs a few seconds, a blurred one let into the record
    # costs a wrong value nobody looks at again. The earlier value of 55
    # was a guess and caught only near-total blur.
    #
    # Two limits worth knowing. This is measured on drawn pages, not
    # photographs, which carry compression and uneven light, so it is
    # provisional until real documents are measured. And a smudged region
    # scores 2062 to 3728, overlapping clean text completely: strokes
    # drawn over writing add edges, so this metric cannot see smudging
    # at all. That needs a different signal.
    legibility_min_sharpness: float = 1450.0
    # The deterministic layer scores each reading by the checks it
    # passed, 0 to 1. At or above this the reading joins the record;
    # below it a clinician reads that region themselves.
    #
    # Let the checks settle a prescription line without a clinician.
    # Off until there is a gold set: no check reads the drug name, the
    # reader has been seen dropping a medicine, and the scope says a
    # prescription a clinician confirmed is what reaches the patient.
    # The checks still run, and still say which lines look doubtful.
    auto_accept_lines: bool = False
    # 1.0 means every check that applied has to pass. That is the strict
    # default on purpose: the number is only as good as the gold set it
    # was tuned against, and there is no gold set yet. Lower it once
    # there is one, and measure what it lets through.
    confidence_threshold: float = 1.0


@lru_cache
def get_settings() -> Settings:
    return Settings()
