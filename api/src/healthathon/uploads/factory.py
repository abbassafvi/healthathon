"""
Which detector and which agent this process reads with.

Both are chosen from configuration so a test can pass its own. Without a
provider key the agent refuses to read rather than guessing, and the
upload fails with the page still stored: an unread page is recoverable,
an invented value is not.
"""

from psycopg import Connection
from psycopg.rows import DictRow

from healthathon.config import Settings, get_settings
from healthathon.uploads.agent import DocumentAgent
from healthathon.uploads.detector import PaddleDetector, TextDetector
from healthathon.uploads.model_agent import ModelDocumentAgent, UnreadableAgent
from healthathon.uploads.providers import (
    GeminiClient,
    ModelClient,
    OpenAICompatibleClient,
)
from healthathon.uploads.stub import StubAgent, StubDetector
from healthathon.uploads.whole_page import WholePageAgent

_detector: TextDetector | None = None
_agent_override: DocumentAgent | None = None


def build_detector() -> TextDetector:
    """
    One detector per process: loading the model costs seconds.

    The configured model and backend are passed through. They were read
    from settings and then dropped here, so changing either had no
    effect on what ran.
    """
    global _detector
    if _detector is None:
        settings = get_settings()
        _detector = (
            StubDetector()
            if settings.detector == "stub"
            else PaddleDetector(settings.detector_onednn, settings.detector_model)
        )
    return _detector


def set_detector(detector: TextDetector | None) -> None:
    """Tests install a fake here, so no test needs paddlepaddle."""
    global _detector
    _detector = detector


def set_agent(agent: DocumentAgent | None) -> None:
    """Tests install a fake here, so no test reaches a model provider."""
    global _agent_override
    _agent_override = agent


def build_client(settings: Settings) -> ModelClient | None:
    if not settings.agent_api_key:
        return None
    if settings.agent_provider == "gemini":
        # The configured model first, then the rest, in order.
        tried = [settings.agent_model] + [
            m for m in settings.agent_fallback_models if m != settings.agent_model
        ]
        return GeminiClient(
            settings.agent_api_key, tried, settings.agent_timeout_s, settings.agent_retries
        )
    if settings.agent_provider == "openai":
        return OpenAICompatibleClient(
            settings.agent_api_key,
            settings.agent_model,
            settings.agent_base_url,
            settings.agent_timeout_s,
            settings.agent_retries,
        )
    return None


def build_agent(conn: Connection[DictRow], settings: Settings) -> DocumentAgent:
    if _agent_override is not None:
        return _agent_override
    if settings.agent_provider == "stub":
        return StubAgent()
    client = build_client(settings)
    if client is None:
        return UnreadableAgent()
    codes = [str(r["code"]) for r in conn.execute("SELECT code FROM core.analyte").fetchall()]
    if settings.agent_strategy == "whole_page":
        return WholePageAgent(client, codes)
    return ModelDocumentAgent(client, codes, settings.agent_max_crops_per_call)
