"""Pluggable notification channels (#263), pinned criterion by criterion.

Rule 10 throughout: every HTTP boundary is mocked; no test can reach Telegram
or any webhook — empty config disables a channel exactly like SMTP, and the
empty-config tests assert ZERO requests, not just "no failure".
"""

from unittest.mock import MagicMock, patch

import pytest
from httpx import AsyncClient

from app.config import settings
from app.services.notifications import (
    OwnerNotification,
    configured_channels,
    notify_owner,
)

EVENT = OwnerNotification(
    source="contact_form",
    name="Rita Recruiter",
    email="rita@agency.example",
    company="Agency GmbH",
    message="Are you available for a Staff role?",
)


def _cfg(**overrides):
    defaults = {
        "smtp_host": "",
        "telegram_bot_token": "",
        "telegram_chat_id": "",
        "notify_webhook_url": "",
        "matrix_homeserver": "",
        "matrix_access_token": "",
        "matrix_room_id": "",
        "sms_gateway_url": "",
        "sms_gateway_user": "",
        "sms_gateway_password": "",
        "sms_gateway_to": "",
    }
    defaults.update(overrides)
    return [patch(f"app.config.settings.{k}", v) for k, v in defaults.items()]


# Full, valid config per #431 channel — reused so a "blank exactly one part"
# case cannot accidentally blank two.
MATRIX_CFG = {
    "matrix_homeserver": "https://matrix.example",
    "matrix_access_token": "syt_token",
    "matrix_room_id": "!room:matrix.example",
}
SMS_CFG = {
    "sms_gateway_url": "http://192.168.1.50:8080/message",
    "sms_gateway_user": "sms",
    "sms_gateway_password": "pw",
    "sms_gateway_to": "+491700000000",
}


def _with(patches, fn):
    for c in patches:
        c.start()
    try:
        return fn()
    finally:
        for c in patches:
            c.stop()


# ---------------------------------------------------------------- registry --


def test_empty_config_means_empty_registry_and_zero_requests():
    """Rule 10, on EVERY httpx verb the module uses. #431 added a channel that
    calls `httpx.put`, so a post-only patch would pass here vacuously: delete
    either patch and the corresponding `assert_not_called` disappears with it,
    which is why both verbs are asserted explicitly rather than via a helper."""
    with (
        patch("app.services.notifications.httpx.post") as post,
        patch("app.services.notifications.httpx.put") as put,
    ):
        result = _with(_cfg(), lambda: notify_owner(EVENT))
        assert result == {}
        post.assert_not_called()
        put.assert_not_called()


def test_every_httpx_verb_the_module_calls_is_patched_by_the_empty_config_test():
    """Guards the test above from going blind AGAIN the next time a channel
    uses a new verb (#431): the source is scanned for `httpx.<verb>` calls and
    the set must be exactly the one the empty-config case patches. A third
    verb (e.g. `httpx.request`) turns this red instead of silently making the
    zero-requests assertion partial."""
    import re
    from pathlib import Path

    import app.services.notifications as n

    source = Path(n.__file__).read_text()
    verbs = set(re.findall(r"\bhttpx\.([a-z]+)\(", source))
    assert verbs == {"post", "put"}


def test_channels_register_exactly_when_their_config_is_present():
    assert _with(
        _cfg(smtp_host="mailpit"), lambda: [c.name for c in configured_channels()]
    ) == ["email"]
    assert _with(
        _cfg(telegram_bot_token="t", telegram_chat_id="c"),
        lambda: [c.name for c in configured_channels()],
    ) == ["telegram"]
    assert _with(
        _cfg(notify_webhook_url="https://hooks.example/x"),
        lambda: [c.name for c in configured_channels()],
    ) == ["webhook"]
    assert _with(
        _cfg(**MATRIX_CFG), lambda: [c.name for c in configured_channels()]
    ) == ["matrix"]
    assert _with(_cfg(**SMS_CFG), lambda: [c.name for c in configured_channels()]) == [
        "sms"
    ]
    # Half a Telegram config is NO Telegram config.
    assert (
        _with(
            _cfg(telegram_bot_token="t"),
            lambda: [c.name for c in configured_channels()],
        )
        == []
    )
    # ...and the same per PART for the #431 channels. One "all blank" case
    # would pass against an `or`-gated registry, so every part is blanked on
    # its own, with the others still set.
    for blanked in MATRIX_CFG:
        cfg = {**MATRIX_CFG, blanked: ""}
        assert (
            _with(_cfg(**cfg), lambda: [c.name for c in configured_channels()]) == []
        ), f"matrix registered with {blanked} blank"
    for blanked in SMS_CFG:
        cfg = {**SMS_CFG, blanked: ""}
        assert (
            _with(_cfg(**cfg), lambda: [c.name for c in configured_channels()]) == []
        ), f"sms registered with {blanked} blank"


# ---------------------------------------------------------------- telegram --


def test_telegram_posts_the_bot_api_with_chat_id_and_summary():
    with patch("app.services.notifications.httpx.post") as post:
        post.return_value = MagicMock(raise_for_status=lambda: None)
        result = _with(
            _cfg(telegram_bot_token="123:abc", telegram_chat_id="42"),
            lambda: notify_owner(EVENT),
        )
    assert result == {"telegram": True}
    url = post.call_args.args[0]
    assert url == "https://api.telegram.org/bot123:abc/sendMessage"
    payload = post.call_args.kwargs["json"]
    assert payload["chat_id"] == "42"
    assert "[contact_form] New interaction from Rita Recruiter" in payload["text"]
    assert "admin" in payload["text"]  # the deep link back to the inbox
    assert post.call_args.kwargs["timeout"] == settings.notify_timeout_seconds


def test_telegram_failure_is_false_and_never_leaks_the_token_into_logs():
    import httpx as real_httpx

    with patch("app.services.notifications.httpx.post") as post:
        post.side_effect = real_httpx.ConnectError(
            "boom https://api.telegram.org/botSECRET-TOKEN/sendMessage"
        )
        with patch("app.services.notifications.logger") as log:
            result = _with(
                _cfg(telegram_bot_token="SECRET-TOKEN", telegram_chat_id="42"),
                lambda: notify_owner(EVENT),
            )
    assert result == {"telegram": False}
    # The token is part of the URL; the log line must carry the exception TYPE
    # only, never its message (pinned — this is why the except logs __name__).
    logged = " ".join(str(c) for c in log.error.call_args_list)
    assert "SECRET-TOKEN" not in logged


def test_httpx_success_logging_never_carries_the_token(caplog):
    """#297 review blocker 2: httpx logs every request URL at INFO — and the
    Bot API URL CONTAINS the token, so a SUCCESSFUL send printed the
    credential into container logs. The first leak test was structurally
    blind: it mocked httpx.post (so httpx never logged) and asserted a mocked
    logger. This one routes through a REAL httpx client over MockTransport,
    so httpx's own logging pipeline runs for real."""
    import logging

    import httpx as real_httpx

    def through_real_client(url, **kwargs):
        transport = real_httpx.MockTransport(
            lambda request: real_httpx.Response(200, json={"ok": True})
        )
        with real_httpx.Client(transport=transport) as c:
            return c.post(url, json=kwargs.get("json"))

    with (
        patch("app.services.notifications.httpx.post", side_effect=through_real_client),
        caplog.at_level(logging.DEBUG),
    ):
        result = _with(
            _cfg(telegram_bot_token="SECRET-TOKEN-42", telegram_chat_id="7"),
            lambda: notify_owner(EVENT),
        )
    assert result == {"telegram": True}
    assert "SECRET-TOKEN-42" not in caplog.text


def test_telegram_http_500_is_a_failure_not_a_success():
    """AC2's own words. raise_for_status is the ONLY thing turning a 4xx/5xx
    into False here — deleting it left the suite green (#297 review major 5),
    so this pins it: a well-formed 500 response, no exception from post()."""
    import httpx as real_httpx

    response = real_httpx.Response(
        500,
        request=real_httpx.Request("POST", "https://api.telegram.org/botX/sendMessage"),
    )
    with patch("app.services.notifications.httpx.post", return_value=response):
        result = _with(
            _cfg(telegram_bot_token="t", telegram_chat_id="c"),
            lambda: notify_owner(EVENT),
        )
    assert result == {"telegram": False}


# ------------------------------------------------------------------ matrix --


def test_matrix_puts_an_m_notice_with_bearer_auth_and_encoded_room():
    with patch("app.services.notifications.httpx.put") as put:
        put.return_value = MagicMock(raise_for_status=lambda: None)
        result = _with(_cfg(**MATRIX_CFG), lambda: notify_owner(EVENT))
    assert result == {"matrix": True}
    url = put.call_args.args[0]
    # The room id contains `!` and `:` — reserved in a path segment, so it must
    # arrive percent-encoded or the homeserver 404s (spec: one path segment).
    assert url.startswith(
        "https://matrix.example/_matrix/client/v3/rooms/"
        "%21room%3Amatrix.example/send/m.room.message/"
    )
    assert "!room:matrix.example" not in url
    headers = put.call_args.kwargs["headers"]
    assert headers["Authorization"] == "Bearer syt_token"
    payload = put.call_args.kwargs["json"]
    assert payload["msgtype"] == "m.notice"
    assert "[contact_form] New interaction from Rita Recruiter" in payload["body"]
    assert "admin" in payload["body"]  # the deep link back to the inbox
    # The timeout is load-bearing (#207): a hung homeserver must not pin the
    # background task forever. Deleting it leaves httpx on its own default.
    assert put.call_args.kwargs["timeout"] == settings.notify_timeout_seconds


def test_matrix_trailing_slash_on_the_homeserver_does_not_double_up():
    with patch("app.services.notifications.httpx.put") as put:
        put.return_value = MagicMock(raise_for_status=lambda: None)
        _with(
            _cfg(**{**MATRIX_CFG, "matrix_homeserver": "https://matrix.example/"}),
            lambda: notify_owner(EVENT),
        )
    assert put.call_args.args[0].startswith("https://matrix.example/_matrix/")


def test_matrix_uses_a_fresh_transaction_id_per_send():
    """The txn id is Matrix's idempotency key: reuse it and the homeserver
    DEDUPLICATES, so the second recruiter contact of the session is silently
    dropped. Two sends, two ids."""
    with patch("app.services.notifications.httpx.put") as put:
        put.return_value = MagicMock(raise_for_status=lambda: None)
        _with(_cfg(**MATRIX_CFG), lambda: notify_owner(EVENT))
        _with(_cfg(**MATRIX_CFG), lambda: notify_owner(EVENT))
    first, second = (c.args[0].rsplit("/", 1)[1] for c in put.call_args_list)
    assert first and second and first != second


def test_matrix_body_stays_raw_for_the_owner():
    """An `m.notice` plain body parses no markup, so escaping here would show
    the owner `&amp;`-noise for nothing — same reasoning as Telegram (#297
    round 3), now pinned for Matrix too."""
    event = OwnerNotification.build(
        source="contact_form",
        name="N",
        email="n@example.com",
        company=None,
        message="We pay > 100k & need C++ <urgent>",
    )
    with patch("app.services.notifications.httpx.put") as put:
        put.return_value = MagicMock(raise_for_status=lambda: None)
        _with(_cfg(**MATRIX_CFG), lambda: notify_owner(event))
    body = put.call_args.kwargs["json"]["body"]
    assert "We pay > 100k & need C++ <urgent>" in body
    assert "&amp;" not in body


def test_matrix_failure_is_false_and_logs_the_type_only():
    """Mutation contract: change the handler to log `{e}` and this goes red —
    the exception's own message carries the access token here."""
    import httpx as real_httpx

    with patch("app.services.notifications.httpx.put") as put:
        put.side_effect = real_httpx.ConnectError(
            "boom while authenticating with Bearer SECRET-MATRIX-TOKEN"
        )
        with patch("app.services.notifications.logger") as log:
            result = _with(
                _cfg(**{**MATRIX_CFG, "matrix_access_token": "SECRET-MATRIX-TOKEN"}),
                lambda: notify_owner(EVENT),
            )
    assert result == {"matrix": False}
    logged = " ".join(str(c) for c in log.error.call_args_list)
    assert "SECRET-MATRIX-TOKEN" not in logged
    assert "ConnectError" in logged


def test_matrix_http_500_is_a_failure_not_a_success():
    """`raise_for_status` is the ONLY thing turning a 5xx into False (#297
    review major 5 on the Telegram twin): a well-formed 500, no exception."""
    import httpx as real_httpx

    response = real_httpx.Response(
        500,
        request=real_httpx.Request("PUT", "https://matrix.example/_matrix/x"),
    )
    with patch("app.services.notifications.httpx.put", return_value=response):
        result = _with(_cfg(**MATRIX_CFG), lambda: notify_owner(EVENT))
    assert result == {"matrix": False}


def test_matrix_real_httpx_logging_never_carries_the_access_token(caplog):
    """The #297-established pattern (test_httpx_success_logging_never_carries
    _the_token): a test that MOCKS httpx cannot see httpx's OWN request
    logging, which is how the original Telegram leak survived its first test.
    A real client over MockTransport runs that pipeline for real — on the
    success path AND on the failure path, since a transport error logs too."""
    import logging

    import httpx as real_httpx

    def through_real_client(url, **kwargs):
        transport = real_httpx.MockTransport(
            lambda request: real_httpx.Response(200, json={"event_id": "$1"})
        )
        with real_httpx.Client(transport=transport) as c:
            return c.put(url, json=kwargs.get("json"), headers=kwargs.get("headers"))

    def through_real_client_that_dies(url, **kwargs):
        def die(request):
            raise real_httpx.ConnectError("homeserver down", request=request)

        with real_httpx.Client(transport=real_httpx.MockTransport(die)) as c:
            return c.put(url, json=kwargs.get("json"), headers=kwargs.get("headers"))

    cfg = {**MATRIX_CFG, "matrix_access_token": "SECRET-MATRIX-TOKEN-42"}
    for router, expected in (
        (through_real_client, True),
        (through_real_client_that_dies, False),
    ):
        caplog.clear()
        with (
            patch("app.services.notifications.httpx.put", side_effect=router),
            caplog.at_level(logging.DEBUG),
        ):
            result = _with(_cfg(**cfg), lambda: notify_owner(EVENT))
        assert result == {"matrix": expected}
        assert caplog.text  # the pipeline really did log something
        assert "SECRET-MATRIX-TOKEN-42" not in caplog.text


# --------------------------------------------------------------------- sms --


def test_sms_posts_message_and_recipient_with_basic_auth():
    with patch("app.services.notifications.httpx.post") as post:
        post.return_value = MagicMock(raise_for_status=lambda: None)
        result = _with(_cfg(**SMS_CFG), lambda: notify_owner(EVENT))
    assert result == {"sms": True}
    assert post.call_args.args[0] == "http://192.168.1.50:8080/message"
    assert post.call_args.kwargs["auth"] == ("sms", "pw")
    payload = post.call_args.kwargs["json"]
    assert "[contact_form] New interaction from Rita Recruiter" in payload["message"]
    assert payload["phoneNumbers"] == ["+491700000000"]
    assert post.call_args.kwargs["timeout"] == settings.notify_timeout_seconds


def test_sms_failure_is_false_and_logs_the_type_only():
    """The documented real failure mode: the owner's gateway phone is off.
    Mutation contract — log `{e}` instead of `type(e).__name__` and this goes
    red, because the Basic-auth password is in the exception's message."""
    import httpx as real_httpx

    with patch("app.services.notifications.httpx.post") as post:
        post.side_effect = real_httpx.ConnectError(
            "All connection attempts failed for sms:SECRET-SMS-PASSWORD@phone"
        )
        with patch("app.services.notifications.logger") as log:
            result = _with(
                _cfg(**{**SMS_CFG, "sms_gateway_password": "SECRET-SMS-PASSWORD"}),
                lambda: notify_owner(EVENT),
            )
    assert result == {"sms": False}
    logged = " ".join(str(c) for c in log.error.call_args_list)
    assert "SECRET-SMS-PASSWORD" not in logged
    assert "ConnectError" in logged


def test_sms_http_500_is_a_failure_not_a_success():
    import httpx as real_httpx

    response = real_httpx.Response(
        500,
        request=real_httpx.Request("POST", "http://192.168.1.50:8080/message"),
    )
    with patch("app.services.notifications.httpx.post", return_value=response):
        result = _with(_cfg(**SMS_CFG), lambda: notify_owner(EVENT))
    assert result == {"sms": False}


def test_sms_real_httpx_logging_never_carries_the_gateway_password(caplog):
    """Same #297 pattern as Matrix above: a REAL httpx client over
    MockTransport, so httpx's own request logging runs — and the Basic-auth
    credential must not surface on either path."""
    import logging

    import httpx as real_httpx

    def through_real_client(url, **kwargs):
        transport = real_httpx.MockTransport(
            lambda request: real_httpx.Response(200, json={"state": "Pending"})
        )
        with real_httpx.Client(transport=transport) as c:
            return c.post(url, json=kwargs.get("json"), auth=kwargs.get("auth"))

    def through_real_client_that_dies(url, **kwargs):
        def die(request):
            raise real_httpx.ConnectError("phone offline", request=request)

        with real_httpx.Client(transport=real_httpx.MockTransport(die)) as c:
            return c.post(url, json=kwargs.get("json"), auth=kwargs.get("auth"))

    cfg = {**SMS_CFG, "sms_gateway_password": "SECRET-SMS-PASSWORD-42"}
    for router, expected in (
        (through_real_client, True),
        (through_real_client_that_dies, False),
    ):
        caplog.clear()
        with (
            patch("app.services.notifications.httpx.post", side_effect=router),
            caplog.at_level(logging.DEBUG),
        ):
            result = _with(_cfg(**cfg), lambda: notify_owner(EVENT))
        assert result == {"sms": expected}
        assert caplog.text
        assert "SECRET-SMS-PASSWORD-42" not in caplog.text


# ----------------------------------------------------------------- webhook --


def test_webhook_posts_slack_style_text_plus_structured_fields():
    with patch("app.services.notifications.httpx.post") as post:
        post.return_value = MagicMock(raise_for_status=lambda: None)
        result = _with(
            _cfg(notify_webhook_url="https://hooks.slack.example/T/B/x"),
            lambda: notify_owner(EVENT),
        )
    assert result == {"webhook": True}
    assert post.call_args.args[0] == "https://hooks.slack.example/T/B/x"
    # The timeout is load-bearing (#207): deleting it left the suite green
    # (#297 review major 6).
    assert post.call_args.kwargs["timeout"] == settings.notify_timeout_seconds
    payload = post.call_args.kwargs["json"]
    assert "New interaction from Rita Recruiter" in payload["text"]
    assert payload["source"] == "contact_form"
    assert payload["email"] == "rita@agency.example"


def test_webhook_http_500_is_a_failure_not_a_success():
    import httpx as real_httpx

    response = real_httpx.Response(
        500, request=real_httpx.Request("POST", "https://hooks.example/x")
    )
    with patch("app.services.notifications.httpx.post", return_value=response):
        result = _with(
            _cfg(notify_webhook_url="https://hooks.example/x"),
            lambda: notify_owner(EVENT),
        )
    assert result == {"webhook": False}


def test_webhook_failure_is_false_and_logs_the_type_only():
    import httpx as real_httpx

    with patch("app.services.notifications.httpx.post") as post:
        post.side_effect = real_httpx.ConnectError("refused")
        result = _with(
            _cfg(notify_webhook_url="https://hooks.example/x"),
            lambda: notify_owner(EVENT),
        )
    assert result == {"webhook": False}


# ---------------------------------------------------------------- fan-out ---


def test_one_dead_channel_never_blocks_another():
    """Telegram 500s; the webhook must still fire and succeed."""
    import httpx as real_httpx

    calls = []

    def post(url, **kwargs):
        calls.append(url)
        if "telegram" in url:
            raise real_httpx.HTTPStatusError(
                "500", request=MagicMock(), response=MagicMock()
            )
        return MagicMock(raise_for_status=lambda: None)

    with patch("app.services.notifications.httpx.post", side_effect=post):
        result = _with(
            _cfg(
                telegram_bot_token="t",
                telegram_chat_id="c",
                notify_webhook_url="https://hooks.example/x",
            ),
            lambda: notify_owner(EVENT),
        )
    assert result == {"telegram": False, "webhook": True}
    assert len(calls) == 2


def test_a_dead_matrix_channel_never_suppresses_sms_or_the_webhook():
    """#431's half of `test_one_dead_channel_never_blocks_another`: the new
    channels use DIFFERENT httpx verbs, so isolation has to be pinned across
    that boundary too — a homeserver that is down must not cost the owner the
    SMS that would have reached them with no data connection."""
    import httpx as real_httpx

    calls: list[str] = []

    def put(url, **kwargs):
        calls.append(url)
        raise real_httpx.ConnectError("homeserver down")

    def post(url, **kwargs):
        calls.append(url)
        return MagicMock(raise_for_status=lambda: None)

    with (
        patch("app.services.notifications.httpx.put", side_effect=put),
        patch("app.services.notifications.httpx.post", side_effect=post),
    ):
        result = _with(
            _cfg(
                **MATRIX_CFG,
                **SMS_CFG,
                notify_webhook_url="https://hooks.example/x",
            ),
            lambda: notify_owner(EVENT),
        )
    assert result == {"matrix": False, "sms": True, "webhook": True}
    assert len(calls) == 3


def test_a_channel_that_raises_outside_its_own_handling_is_isolated():
    """Even a channel whose send() itself raises (not just fails) must not
    stop the fan-out — the registry's own belt to the channels' braces."""
    from app.services import notifications as n

    class Bomb:
        name = "bomb"

        def send(self, event):
            raise RuntimeError("kaboom")

    ok = MagicMock()
    ok.name = "ok"
    ok.send.return_value = True
    with patch.object(n, "configured_channels", return_value=[Bomb(), ok]):
        result = n.notify_owner(EVENT)
    assert result == {"bomb": False, "ok": True}
    ok.send.assert_called_once()


# ------------------------------------------------------------- end to end ---


@pytest.mark.asyncio
async def test_contact_form_fans_out_through_the_registry(client: AsyncClient):
    """The #69 call site goes through the registry: with Telegram AND email
    configured, one submission produces both — through mocked boundaries."""
    sent = {"email": 0, "telegram": 0}

    def fake_email(self, **kwargs):
        sent["email"] += 1
        return True

    def fake_post(url, **kwargs):
        assert url.startswith("https://api.telegram.org/bot")
        sent["telegram"] += 1
        return MagicMock(raise_for_status=lambda: None)

    from app.services.email import EmailService

    with (
        patch.object(EmailService, "send_interaction_notification", fake_email),
        patch("app.services.notifications.httpx.post", side_effect=fake_post),
        patch("app.config.settings.smtp_host", "mailpit"),
        patch("app.config.settings.telegram_bot_token", "t"),
        patch("app.config.settings.telegram_chat_id", "c"),
    ):
        r = await client.post(
            f"{settings.api_prefix}/interactions/contact",
            json={
                "name": "Fanout Probe",
                "email": "probe@example.com",
                "message": "Testing the notification registry fan-out.",
            },
        )
        assert r.status_code == 201
    assert sent == {"email": 1, "telegram": 1}


# ---------------------------------------------------------------- summary ----


def test_summary_truncates_and_renders_company_raw():
    """summary() is RAW by design (escaping is per-channel); it still pins the
    truncation and empty-company branches."""
    long_event = OwnerNotification.build(
        source="contact_form",
        name="N",
        email="n@example.com",
        company=None,
        message="x" * 600,
    )
    text = long_event.summary()
    assert "x" * 500 in text and "x" * 501 not in text
    assert "(" not in text.split("\n")[0]
    with_company = OwnerNotification.build(
        source="contact_form",
        name="N",
        email="n@example.com",
        company="ACME",
        message="hi",
    )
    assert "(ACME)" in with_company.summary()


def test_webhook_escapes_every_attacker_reachable_field():
    """#297 round 3: name, company AND message all come off the PUBLIC
    contact form and all ride the mrkdwn-parsed `text` — escaping message
    alone delivered `<!channel>` via `name` verbatim. The whole rendered
    string is escaped at the ONE channel that parses entities."""
    event = OwnerNotification.build(
        source="contact_form",
        name="<!channel> Eve",
        email="eve@example.com",
        company="<!here> Corp",
        message="We pay > 100k & need C++ <urgent> <http://evil.example|click>",
    )
    with patch("app.services.notifications.httpx.post") as post:
        post.return_value = MagicMock(raise_for_status=lambda: None)
        result = _with(
            _cfg(notify_webhook_url="https://hooks.example/x"),
            lambda: notify_owner(event),
        )
    assert result == {"webhook": True}
    text = post.call_args.kwargs["json"]["text"]
    assert "<!channel>" not in text and "<!here>" not in text
    assert "&lt;!channel&gt; Eve" in text and "(&lt;!here&gt; Corp)" in text
    assert "&amp; need C++ &lt;urgent&gt;" in text


def test_telegram_text_stays_raw_for_the_owner():
    """Telegram's plain sendMessage parses NO entities: the owner must read
    `We pay > 100k`, not `&gt;`-noise (#297 round 3, measured)."""
    event = OwnerNotification.build(
        source="contact_form",
        name="N",
        email="n@example.com",
        company=None,
        message="We pay > 100k & need C++ <urgent>",
    )
    with patch("app.services.notifications.httpx.post") as post:
        post.return_value = MagicMock(raise_for_status=lambda: None)
        _with(
            _cfg(telegram_bot_token="t", telegram_chat_id="c"),
            lambda: notify_owner(event),
        )
    text = post.call_args.kwargs["json"]["text"]
    assert "We pay > 100k & need C++ <urgent>" in text
    assert "&amp;" not in text


def test_build_normalizes_missing_company_to_empty_string():
    e = OwnerNotification.build(
        source="s", name="n", email="e@x", company=None, message="m"
    )
    assert e.company == ""


# -------------------------------------------------------------- namespacing --


def test_beaconfolio_namespaced_env_binds_and_generic_does_not(monkeypatch):
    """#141's contract, tested per the gemini-env precedent: the credential
    binds ONLY through its BEACONFOLIO_* name; the generic name is ignored."""
    from app.config import Settings

    monkeypatch.setenv("BEACONFOLIO_TELEGRAM_BOT_TOKEN", "ns-token")
    monkeypatch.setenv("BEACONFOLIO_TELEGRAM_CHAT_ID", "ns-chat")
    monkeypatch.setenv("BEACONFOLIO_NOTIFY_WEBHOOK_URL", "https://ns.example/w")
    monkeypatch.setenv("BEACONFOLIO_MATRIX_ACCESS_TOKEN", "ns-matrix-token")
    monkeypatch.setenv("BEACONFOLIO_SMS_GATEWAY_PASSWORD", "ns-sms-pw")
    fresh = Settings(_env_file=None)
    assert fresh.telegram_bot_token == "ns-token"
    assert fresh.telegram_chat_id == "ns-chat"
    assert fresh.notify_webhook_url == "https://ns.example/w"
    assert fresh.matrix_access_token == "ns-matrix-token"
    assert fresh.sms_gateway_password == "ns-sms-pw"

    monkeypatch.delenv("BEACONFOLIO_TELEGRAM_BOT_TOKEN")
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "generic-must-not-bind")
    assert Settings(_env_file=None).telegram_bot_token == ""
    # #431's credentials obey the same namespace: the generic names are inert.
    monkeypatch.delenv("BEACONFOLIO_MATRIX_ACCESS_TOKEN")
    monkeypatch.delenv("BEACONFOLIO_SMS_GATEWAY_PASSWORD")
    monkeypatch.setenv("MATRIX_ACCESS_TOKEN", "generic-must-not-bind")
    monkeypatch.setenv("SMS_GATEWAY_PASSWORD", "generic-must-not-bind")
    inert = Settings(_env_file=None)
    assert inert.matrix_access_token == ""
    assert inert.sms_gateway_password == ""
