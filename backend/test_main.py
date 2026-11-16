from fastapi.testclient import TestClient
from types import SimpleNamespace

import main


client = TestClient(main.app)


def setup_function() -> None:
    with main._rate_limit_lock:
        main._request_times.clear()
        main._client_request_times.clear()


def test_health_is_available_without_an_api_key() -> None:
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_chat_returns_clear_configuration_error(monkeypatch) -> None:
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("ANTHROPIC_MODEL", raising=False)

    response = client.post("/chat", json={"question": "Explain Azure regions"})

    assert response.status_code == 503
    assert "not configured" in response.json()["detail"]


def test_chat_validates_question_length() -> None:
    response = client.post("/chat", json={"question": "x" * 181})

    assert response.status_code == 422


def test_chat_sends_language_and_level_to_model(monkeypatch) -> None:
    calls = []

    class FakeMessages:
        def create(self, **kwargs):
            calls.append(kwargs)
            return SimpleNamespace(content=[SimpleNamespace(text="Definition: a test answer.")])

    class FakeClient:
        messages = FakeMessages()

    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setenv("ANTHROPIC_MODEL", "test-model")
    monkeypatch.setattr(main.anthropic, "Anthropic", lambda **_kwargs: FakeClient())

    response = client.post(
        "/chat",
        json={"question": "Explain Azure regions", "language": "sw", "level": "exam"},
    )

    assert response.status_code == 200
    assert response.json() == {"answer": "Definition: a test answer."}
    assert calls[0]["model"] == "test-model"
    assert "Selected language: sw" in calls[0]["messages"][0]["content"]
    assert "Learner level: exam" in calls[0]["messages"][0]["content"]


def test_chat_rejects_requests_after_rate_limit(monkeypatch) -> None:
    monkeypatch.setattr(main, "RATE_LIMIT", 1)
    monkeypatch.setattr(main, "generate_answer", lambda _payload: "A reviewed test answer.")

    first = client.post("/chat", json={"question": "Explain Azure regions"})
    second = client.post("/chat", json={"question": "Explain cloud computing"})

    assert first.status_code == 200
    assert second.status_code == 429


def test_one_visitor_cannot_use_up_everyone_elses_quota(monkeypatch) -> None:
    monkeypatch.setattr(main, "RATE_LIMIT_PER_CLIENT", 2)
    monkeypatch.setattr(main, "generate_answer", lambda _payload: "A reviewed test answer.")
    ask = lambda ip: client.post(
        "/chat", json={"question": "Explain Azure regions"}, headers={"X-Forwarded-For": ip}
    )

    assert ask("10.0.0.1").status_code == 200
    assert ask("10.0.0.1").status_code == 200
    assert ask("10.0.0.1").status_code == 429  # this visitor is over their limit
    assert ask("10.0.0.2").status_code == 200  # a different visitor still gets answers


def test_visitor_id_uses_the_proxy_added_address() -> None:
    request = SimpleNamespace(headers={"x-forwarded-for": "1.1.1.1, 203.0.113.9"}, client=None)
    assert main.client_id(request) == "203.0.113.9"


def test_chat_cors_allows_the_github_pages_site() -> None:
    response = client.options(
        "/chat",
        headers={
            "Origin": "https://wanjikuk60.github.io",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "https://wanjikuk60.github.io"


def test_gemini_provider_sends_prompt_and_reads_answer(monkeypatch) -> None:
    calls = []

    def fake_post(url, headers, json, timeout):
        calls.append({"url": url, "headers": headers, "json": json})
        return main.httpx.Response(
            200,
            json={"candidates": [{"content": {"parts": [{"text": "A Gemini test answer."}]}}]},
            request=main.httpx.Request("POST", url),
        )

    monkeypatch.setenv("AI_PROVIDER", "gemini")
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.setenv("GEMINI_MODEL", "test-model")
    monkeypatch.setattr(main.httpx, "post", fake_post)

    response = client.post(
        "/chat", json={"question": "Explain Azure regions", "language": "sheng", "level": "beginner"}
    )

    assert response.status_code == 200
    assert response.json() == {"answer": "A Gemini test answer."}
    assert calls[0]["url"].endswith("/models/test-model:generateContent")
    assert calls[0]["headers"] == {"x-goog-api-key": "test-key"}
    assert "Selected language: sheng" in calls[0]["json"]["contents"][0]["parts"][0]["text"]
    assert "Study Buddy" in calls[0]["json"]["systemInstruction"]["parts"][0]["text"]


def test_gemini_errors_become_a_friendly_502(monkeypatch) -> None:
    def fake_post(url, **_kwargs):
        return main.httpx.Response(429, json={}, request=main.httpx.Request("POST", url))

    monkeypatch.setenv("AI_PROVIDER", "gemini")
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.setenv("GEMINI_MODEL", "test-model")
    monkeypatch.setattr(main.httpx, "post", fake_post)

    response = client.post("/chat", json={"question": "Explain Azure regions"})

    assert response.status_code == 502
    assert "reviewed AZ-900 topic" in response.json()["detail"]


def test_gemini_without_a_key_reports_not_configured(monkeypatch) -> None:
    monkeypatch.setenv("AI_PROVIDER", "gemini")
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)

    response = client.post("/chat", json={"question": "Explain Azure regions"})

    assert response.status_code == 503
