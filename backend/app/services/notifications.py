"""Pluggable owner-notification channels (#263, extended by #431).

The product's promise is "no recruiter contact is ever missed" — and email is
where notifications go to be missed. This registry fans one event out to every
CONFIGURED channel: email stays one channel among several, a Telegram ping
lands on the owner's phone in seconds, a Matrix notice reaches an owner whose
chat stack is self-hosted, a self-hosted SMS gateway reaches a phone with no
data connection and no app installed, and a generic webhook covers
Slack/Discord/Mattermost/ntfy with a single implementation.

SCOPE: outbound owner notification only — one recipient, one direction, no
inbound endpoint, no identity mapping, no threading. Two-way recruiter
conversations (public inbound webhooks, signature verification, reply windows,
threading into the #69 inbox) are a separate, multi-release feature with a
public attack surface — tracked as #432 and deliberately NOT on this seam.

Contracts, identical to the email path this generalizes:
- empty config  = the channel is absent from the registry; zero requests.
- one dead channel never blocks another, and none ever blocks intake — the
  caller already runs in a background task whose wrapper swallows everything.

DATED PROVIDER VERDICTS (#431, facts checked 2026-09-15; a deferral here is a
decision with a reason, not a missing feature, and re-opening one needs new
evidence rather than new enthusiasm). The reader-facing copy of this table,
with onboarding and cost per provider, is in README.md → "Owner notifications".

- Telegram          SHIPPED  — `TelegramChannel`; free, self-serve @BotFather.
- Slack / Discord / Mattermost / ntfy / Gotify
                    COVERED  — incoming webhooks are a JSON POST, so
                               `WebhookChannel` already serves them. No new
                               code was needed; that is a finding, not a gap.
- Matrix            SHIPPED  — `MatrixChannel`; free, self-serve, and the
                               owner can run the homeserver themselves.
- SMS, self-hosted  SHIPPED  — `SmsGatewayChannel`; the owner's own Android
                               phone + SIM, so no metered credential exists.
- SMS, CPaaS (Twilio/Vonage/MessageBird)
                    DEFERRED — adds a metered credential (~US$0.012–0.013 per
                               US message incl. carrier fees, plus 10DLC
                               campaign registration and number rental) for
                               ZERO capability gain over the free gateway
                               above. Rule-10 blast radius for nothing.
- WhatsApp          DEFERRED — the reason was REWRITTEN in #431 because the
                               old one had gone false: Meta replaced
                               conversation-based billing with PER-MESSAGE
                               pricing on 2025-07-01, so "bills per
                               conversation" is no longer true. The real
                               blocker is structural and stronger: an owner
                               notification arrives with NO open 24-hour
                               customer-service window (the owner never
                               messages the business number), so it can only
                               be a PRE-APPROVED TEMPLATE with variable
                               substitution — the free-text `summary()` below
                               cannot be sent at all. On top of that: Meta
                               business portfolio + WABA + verified number +
                               template approval before the first message.
- Viber             DEFERRED — bots have not been self-serve since 2024-02-05;
                               commercial terms only, via Rakuten Viber or a
                               verified partner, with a MONTHLY MINIMUM per
                               sender id (~EUR 115+). A monthly floor for one
                               owner's notifications is the hardest no here.
- Signal            DEFERRED — no official API. `signal-cli-rest-api` is an
                               UNOFFICIAL client (ToS risk) and a stateful
                               linked-device daemon, i.e. a second service to
                               operate, not a stateless HTTP call. Escape
                               hatch: an owner already running it can bridge
                               into `WebhookChannel` today via ntfy/Apprise.
- Facebook Messenger
                    DEFERRED — Page + Meta App Review, and unsolicited
                               outbound is not a supported use case: 24-hour
                               window, Message Tags deprecated 2026-02-09
                               (legacy tags retire 2026-04-27), Recurring
                               Notifications ended 2026-02-10.
- LINE              DEFERRED — self-serve and free-tier, but PUSH messages
                               consume a small monthly quota and it is
                               regionally specific (JP/TW/TH). Revisit when a
                               forker in those markets asks.
- WeChat            DEFERRED — overseas-entity verification (5–10 business
                               days, annual fee) and template-only sends.

Sourcing note, so the next reader can weigh each fact: the per-message model
and the template/window rules come from Meta's own WhatsApp pricing and
Messenger Platform documentation
(<https://developers.facebook.com/docs/whatsapp/pricing>), which serves an
error page to non-browser clients — it was not re-fetchable from this build,
so it is cited as of the 2026-09-15 review rather than re-measured here. The
reported 2026-10-01 billing change for in-window service messages is
BSP/industry reporting, NOT Meta's page, and is flagged as such.

`apprise` (BSD-3, ~150 services) was evaluated as a shortcut for all of the
above and rejected: it would put a large dependency between the app and every
channel, and the two channels worth shipping are ~25 lines each on a seam that
already existed.
"""

from dataclasses import dataclass
from typing import Protocol
from urllib.parse import quote
from uuid import uuid4

import httpx

from app.config import settings
from app.logger import logger
from app.services.email import EmailService


@dataclass(frozen=True)
class OwnerNotification:
    """One owner-facing event, channel-agnostic. Frozen: an event that has
    fanned out must read identically on every channel."""

    source: str
    name: str
    email: str
    company: str
    message: str

    @classmethod
    def build(
        cls,
        *,
        source: str,
        name: str,
        email: str,
        company: str | None,
        message: str,
    ) -> "OwnerNotification":
        return cls(
            source=source,
            name=name,
            email=email,
            company=company or "",
            message=message,
        )

    def summary(self) -> str:
        """Compact single-message rendering for chat-shaped channels — RAW.
        Escaping is a PER-CHANNEL concern: Slack parses mrkdwn, Telegram's
        plain sendMessage parses nothing, so escaping here showed the owner
        `&amp;`-noise on Telegram while STILL leaking via name/company on
        Slack (#297 round 3 — the escape lived at the wrong layer AND only
        covered one of three attacker-reachable fields)."""
        safe = self.message[:500]
        company = f" ({self.company})" if self.company else ""
        return (
            f"[{self.source}] New interaction from {self.name}{company}\n"
            f"{self.email}\n\n"
            f"{safe}\n\n"
            f"Review: {settings.site_url.rstrip('/')}/admin → Inbox"
        )


class NotificationChannel(Protocol):
    name: str

    def send(
        self, event: OwnerNotification
    ) -> bool: ...  # pragma: no cover — typing Protocol, never executed


class EmailChannel:
    """The pre-existing email path, unchanged, behind the registry seam."""

    name = "email"

    def send(self, event: OwnerNotification) -> bool:
        return EmailService().send_interaction_notification(
            source=event.source,
            name=event.name,
            email=event.email,
            company=event.company,
            message=event.message,
        )


class TelegramChannel:
    """Telegram Bot API — free, self-serve (@BotFather), two env vars.

    Rule 10: the API is free but still external; tests mock the httpx
    boundary and CI never holds a real token (empty config = channel off,
    exactly like SMTP).
    """

    name = "telegram"

    def send(self, event: OwnerNotification) -> bool:
        url = f"https://api.telegram.org/bot{settings.telegram_bot_token}/sendMessage"
        try:
            response = httpx.post(
                url,
                json={
                    "chat_id": settings.telegram_chat_id,
                    "text": event.summary(),
                },
                timeout=settings.notify_timeout_seconds,
            )
            response.raise_for_status()
            logger.info("Telegram notification sent")
            return True
        except Exception as e:
            # The token is PART OF THE URL — never echo the exception's request
            # context wholesale into logs on this channel.
            logger.error(f"Telegram notification failed: {type(e).__name__}")
            return False


class MatrixChannel:
    """Matrix Client-Server API — free, self-serve, and federated: the owner
    can point this at their OWN homeserver, which is the same self-hosted-first
    argument as the local-Whisper decision in #264.

    Sends `m.notice` (the convention for bot traffic, so clients can style it
    apart from a human's message) with the RAW `summary()`: a plain
    `m.notice` body carries no markup, so escaping here would show the owner
    `&amp;`-noise for nothing — the #297 round-3 finding, same as Telegram.

    The access token rides in the `Authorization` header rather than the URL,
    but the failure path still logs `type(e).__name__` ONLY: an httpx
    exception's request context is not a place to gamble a credential.
    """

    name = "matrix"

    def send(self, event: OwnerNotification) -> bool:
        # The room id contains reserved characters (`!room:server.example`), so
        # it is a single percent-encoded path segment per the spec.
        room = quote(settings.matrix_room_id, safe="")
        url = (
            f"{settings.matrix_homeserver.rstrip('/')}"
            f"/_matrix/client/v3/rooms/{room}/send/m.room.message/{uuid4().hex}"
        )
        try:
            response = httpx.put(
                url,
                headers={"Authorization": f"Bearer {settings.matrix_access_token}"},
                json={"msgtype": "m.notice", "body": event.summary()},
                timeout=settings.notify_timeout_seconds,
            )
            response.raise_for_status()
            logger.info("Matrix notification sent")
            return True
        except Exception as e:
            logger.error(f"Matrix notification failed: {type(e).__name__}")
            return False


class SmsGatewayChannel:
    """SMS via a SELF-HOSTED gateway on the owner's own Android phone and SIM.

    ONE gateway product, named: **sms-gate.app** (capcom6/android-sms-gateway),
    local-network mode. Its contract, read from the vendor's own README and its
    official Go client on 2026-09-15:

        POST http://<phone-ip>:8080/message
        Authorization: Basic <user:password>
        {"textMessage": {"text": ...}, "phoneNumbers": [...]}

    `textMessage.text` — NOT the flat top-level `message` string. That field
    still exists but the vendor's client annotates it *"deprecated, use
    TextMessage instead"* (`android-sms-gateway/client-go`,
    `smsgateway/domain_messages.go:131`), so sending it works today and rots
    later. Round 1 of #431 shipped the deprecated shape; this is the fix.

    NOT interchangeable with the other self-hosted gateways, which is why this
    docstring names one product instead of a category (#433 review round 1:
    claiming three was a false third-party claim of exactly the kind this issue
    exists to delete). Measured 2026-09-15 from each vendor's own docs:
    - **httpSMS** — `POST /v1/messages/send`, auth via an `x-api-Key` HEADER
      (its swagger `securityDefinitions.ApiKeyAuth`, `in: header`), body
      requires `content` + `from` + `to`.
    - **textbee** — `POST /api/v1/gateway/send-sms`, `x-api-key` header, body
      `{"recipients": [...], "message": ...}`.
    Neither the auth scheme nor the body matches, so each needs its own
    `NotificationChannel` class (~25 lines on this seam) or a shim. Pointing
    `BEACONFOLIO_SMS_GATEWAY_URL` at one of them gets a REGISTERED channel that
    returns False on every send, and — by the logging rule below — nothing to
    debug from. Do not do it.

    Why a self-hosted gateway and not a CPaaS: there is no metered API
    credential to hold. Traffic leaves the owner's own number as ordinary P2P
    SMS, so there is no carrier/A2P campaign registration and no per-message
    bill. Do NOT point the URL at Twilio/Vonage/MessageBird either — different
    payload, and it silently accepts per-message billing that the rule-10
    contract of this registry exists to prevent.

    Real failure mode, deliberately tested: the phone goes offline. The send
    then fails CLOSED (returns False, logs the exception TYPE only — the Basic
    auth password must never reach a log line) and every other channel still
    fires.
    """

    name = "sms"

    def send(self, event: OwnerNotification) -> bool:
        try:
            response = httpx.post(
                settings.sms_gateway_url,
                auth=(settings.sms_gateway_user, settings.sms_gateway_password),
                json={
                    "textMessage": {"text": event.summary()},
                    "phoneNumbers": [settings.sms_gateway_to],
                },
                timeout=settings.notify_timeout_seconds,
            )
            response.raise_for_status()
            logger.info("SMS gateway notification sent")
            return True
        except Exception as e:
            logger.error(f"SMS gateway notification failed: {type(e).__name__}")
            return False


class WebhookChannel:
    """Provider-agnostic JSON POST — one implementation covers Slack-style
    incoming webhooks, Discord, Mattermost, ntfy and anything similar."""

    name = "webhook"

    @staticmethod
    def _escape_mrkdwn(text: str) -> str:
        """Slack's documented escaping (&, <, > — & first): submitter text
        from the PUBLIC contact form lands in the mrkdwn-parsed `text`, and
        every field the visitor controls — name, company, message — rides in
        the rendered summary, so the WHOLE string is escaped at this one
        point (#297 round 3: escaping message alone left `<!channel>` in
        `name` delivered verbatim)."""
        return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

    def send(self, event: OwnerNotification) -> bool:
        try:
            response = httpx.post(
                settings.notify_webhook_url,
                json={
                    # `text` is the lingua franca (Slack/Mattermost render it
                    # directly); the structured fields ride alongside for
                    # anything smarter.
                    "text": self._escape_mrkdwn(event.summary()),
                    "source": event.source,
                    "name": event.name,
                    "email": event.email,
                    "company": event.company,
                    "message": event.message,
                },
                timeout=settings.notify_timeout_seconds,
            )
            response.raise_for_status()
            logger.info("Webhook notification sent")
            return True
        except Exception as e:
            logger.error(f"Webhook notification failed: {type(e).__name__}")
            return False


def configured_channels() -> list[NotificationChannel]:
    """Registry built FRESH per call, from live settings: a channel exists
    exactly when its config does. (Fresh, not cached at import — tests and a
    future admin settings UI both change config at runtime.)"""
    channels: list[NotificationChannel] = []
    if settings.smtp_host:
        channels.append(EmailChannel())
    if settings.telegram_bot_token and settings.telegram_chat_id:
        channels.append(TelegramChannel())
    # ALL parts, not any — an `or` here would build a channel that cannot send
    # and would still make a request with a blank token or room (#431).
    if (
        settings.matrix_homeserver
        and settings.matrix_access_token
        and settings.matrix_room_id
    ):
        channels.append(MatrixChannel())
    if (
        settings.sms_gateway_url
        and settings.sms_gateway_user
        and settings.sms_gateway_password
        and settings.sms_gateway_to
    ):
        channels.append(SmsGatewayChannel())
    if settings.notify_webhook_url:
        channels.append(WebhookChannel())
    return channels


def notify_owner(event: OwnerNotification) -> dict[str, bool]:
    """Fan out to every configured channel; each failure isolated. Returns
    per-channel outcomes (for logs/tests — callers must not gate on it)."""
    results: dict[str, bool] = {}
    for channel in configured_channels():
        try:
            results[channel.name] = channel.send(event)
        except Exception as e:  # a channel that RAISES is still just False
            logger.error(f"{channel.name} channel raised: {type(e).__name__}")
            results[channel.name] = False
    return results
