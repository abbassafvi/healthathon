"""
Model providers for the document agent.

Two clients cover the free tiers worth using: Gemini through AI Studio,
whose key is free to obtain, and anything speaking the OpenAI chat
protocol, which covers Groq, OpenRouter and Mistral. Both are asked for
strict JSON at temperature zero, because a reading is not a place for
invention.
"""

import base64
import json
import re
import threading
import time
from pathlib import Path
from typing import Any, Protocol

import httpx

GEMINI_HOST = "https://generativelanguage.googleapis.com/v1beta"

# A provider under load answers with one of these. They say "later",
# not "no", so the reader waits and asks again.
BUSY = (429, 500, 502, 503, 504)


class ModelUnavailable(RuntimeError):
    """The provider could not be reached, or would not answer. Never fatal to the page."""


def _post_with_retry(
    url: str,
    *,
    params: dict[str, str] | None,
    headers: dict[str, str] | None,
    body: dict[str, Any],
    timeout_s: float,
    retries: int,
) -> dict[str, Any]:
    """
    One request, asked again while the provider says it is busy. The wait
    doubles each time, because a model under load stays under load for
    longer than a moment.
    """
    last: Exception | None = None
    for attempt in range(max(retries, 0) + 1):
        try:
            reply = httpx.post(url, params=params, headers=headers, json=body, timeout=timeout_s)
            if reply.status_code in BUSY and attempt < retries:
                # A model under load stays under load for longer than a
                # moment, so the wait grows from seconds to most of a
                # minute rather than giving up in three.
                time.sleep(min(2 ** (attempt + 2), 32))
                continue
            reply.raise_for_status()
            parsed: dict[str, Any] = reply.json()
            return parsed
        except (httpx.TimeoutException, httpx.TransportError) as exc:
            last = exc
            if attempt < retries:
                time.sleep(min(2 ** (attempt + 2), 32))
                continue
            raise ModelUnavailable(_redacted(exc)) from exc
        except httpx.HTTPError as exc:
            raise ModelUnavailable(_redacted(exc)) from exc
    raise ModelUnavailable(_redacted(last) if last else "the provider would not answer")


def _redacted(exc: Exception) -> str:
    """
    The provider's own message, with any key taken out of it.

    Gemini carries the key in the query string, so httpx puts it in the
    text of every error it raises. That text becomes an upload's failure
    message, which is shown on screen and written to the audit log, so
    the key has to come out before it travels any further.
    """
    return re.sub(r"(?i)([?&]key=)[^&\s\"']+", r"\1REDACTED", str(exc))


class ModelClient(Protocol):
    name: str

    @property
    def model(self) -> str:
        """Named after whichever model answered, which fallback can change."""

    def complete_json(self, prompt: str, images: list[Path]) -> dict[str, Any]: ...


def _b64(path: Path) -> str:
    return base64.b64encode(path.read_bytes()).decode("ascii")


def _mime(path: Path) -> str:
    """Crops are PNG, where sharpness matters; the context page is JPEG."""
    return "image/jpeg" if path.suffix.lower() in (".jpg", ".jpeg") else "image/png"


def _parse(text: str) -> dict[str, Any]:
    """
    Take the JSON object out of a reply. Models wrap it in prose or a
    fence often enough that insisting on a bare object loses good reads.
    """
    text = text.strip()
    if text.startswith("```"):
        text = text.split("```")[1] if "```" in text[3:] else text[3:]
        text = text.removeprefix("json").strip()
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end <= start:
        raise ModelUnavailable("the model did not return a JSON object")
    try:
        parsed = json.loads(text[start : end + 1])
    except json.JSONDecodeError as exc:
        raise ModelUnavailable(f"the model returned malformed JSON: {exc}") from exc
    if not isinstance(parsed, dict):
        raise ModelUnavailable("the model returned JSON that is not an object")
    return parsed


class GeminiClient:
    """
    Google AI Studio. The free tier needs a key and no card.

    It takes a list of models and uses the first that answers. On the
    free tier one model runs out of quota for the day while another is
    briefly overloaded, and both say so with a status code rather than
    with a wrong answer, so moving to the next is safe. `model` always
    names the one that actually answered, which is what the extraction
    run records.
    """

    name = "gemini"

    def __init__(self, api_key: str, models: list[str], timeout_s: float, retries: int = 3) -> None:
        if not models:
            raise ValueError("a Gemini client needs at least one model")
        self._key = api_key
        self._models = models
        self._timeout = timeout_s
        self._retries = retries
        # Reads of one page run together, so several threads record which
        # model answered them. The set is what the run is named after:
        # with a fallback in play they are not always the same model.
        self._lock = threading.Lock()
        self._answered: set[str] = set()

    @property
    def model(self) -> str:
        """The models that answered, or the first one before any has."""
        with self._lock:
            return "+".join(sorted(self._answered)) if self._answered else self._models[0]

    def complete_json(self, prompt: str, images: list[Path]) -> dict[str, Any]:
        parts: list[dict[str, Any]] = [{"text": prompt}]
        parts += [{"inline_data": {"mime_type": _mime(p), "data": _b64(p)}} for p in images]
        body = {
            "contents": [{"parts": parts}],
            "generationConfig": {"responseMimeType": "application/json", "temperature": 0},
        }

        last: ModelUnavailable | None = None
        for model in self._models:
            try:
                payload = _post_with_retry(
                    f"{GEMINI_HOST}/models/{model}:generateContent",
                    params={"key": self._key},
                    headers=None,
                    body=body,
                    timeout_s=self._timeout,
                    retries=self._retries,
                )
            except ModelUnavailable as exc:
                last = exc
                continue
            with self._lock:
                self._answered.add(model)
            try:
                text = payload["candidates"][0]["content"]["parts"][0]["text"]
            except (KeyError, IndexError) as exc:
                raise ModelUnavailable(f"unexpected reply shape: {payload}") from exc
            return _parse(text)
        raise last or ModelUnavailable("no model answered")


class OpenAICompatibleClient:
    """Groq, OpenRouter, Mistral: the same chat protocol, a different base URL."""

    name = "openai-compatible"

    def __init__(
        self, api_key: str, model: str, base_url: str, timeout_s: float, retries: int = 3
    ) -> None:
        self._key = api_key
        self.model = model
        self._base = base_url.rstrip("/")
        self._timeout = timeout_s
        self._retries = retries

    def complete_json(self, prompt: str, images: list[Path]) -> dict[str, Any]:
        content: list[dict[str, Any]] = [{"type": "text", "text": prompt}]
        content += [
            {"type": "image_url", "image_url": {"url": f"data:{_mime(p)};base64,{_b64(p)}"}}
            for p in images
        ]
        body = {
            "model": self.model,
            "temperature": 0,
            "response_format": {"type": "json_object"},
            "messages": [{"role": "user", "content": content}],
        }
        payload = _post_with_retry(
            f"{self._base}/chat/completions",
            params=None,
            headers={"Authorization": f"Bearer {self._key}"},
            body=body,
            timeout_s=self._timeout,
            retries=self._retries,
        )
        try:
            text = payload["choices"][0]["message"]["content"]
        except (KeyError, IndexError) as exc:
            raise ModelUnavailable(f"unexpected reply shape: {payload}") from exc
        return _parse(text)
