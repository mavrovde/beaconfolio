from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# SECURITY (issue #177): signing-secret values that must never be honoured. The
# first entry is the historical placeholder that used to be the *default* of
# ``jwt_secret_key`` — it is committed in a public repository, so any deployment
# still signing admin JWTs with it can have tokens forged without a credential.
# ``app.services.auth.get_jwt_secret_key`` rejects every value in this set.
INSECURE_JWT_SECRET_KEYS = frozenset(
    {
        "your-secret-key-change-in-production",
        "",
    }
)


class Settings(BaseSettings):
    database_url: str = (
        "postgresql+asyncpg://postgres:postgres@127.0.0.1:5433/beaconfolio"
    )
    # Connection pool (#326) — the reasoning for these numbers, and the
    # one-connection-per-request invariant they assume, lives in
    # `app/database.py` next to the engine they configure.
    db_pool_size: int = 20
    db_max_overflow: int = 40
    # SQL statement logging. FALSE in production: this was a hard-coded
    # `echo=True` (#326), which logged every statement AND every bound
    # parameter set of every request.
    db_echo: bool = False
    ollama_url: str = "http://localhost:11434"
    embedding_model: str = "nomic-embed-text"
    embedding_dimensions: int = 768  # nomic-embed-text uses 768 dimensions
    generation_model: str = "llama3.2"
    fast_generation_model: str = "llama3.2:1b"

    # Authentication
    #
    # SECURITY (issue #177): there is intentionally NO usable default signing
    # secret. ``JWT_SECRET_KEY`` MUST be supplied in any real deployment —
    # startup (see app.main lifespan) refuses to boot when it is empty or still
    # the historical placeholder (see INSECURE_JWT_SECRET_KEYS), so prod can
    # never sign admin JWTs with a publicly-known key. Generate one with:
    #   openssl rand -hex 32
    # Local dev / E2E set ``JWT_ALLOW_EPHEMERAL_SECRET=true`` instead and get a
    # random per-process secret, so no key has to be committed or injected into
    # CI (tokens simply do not survive a backend restart there).
    jwt_secret_key: str = ""
    jwt_allow_ephemeral_secret: bool = False
    jwt_algorithm: str = "HS256"
    jwt_expiration_minutes: int = 1440  # 24 hours

    # Email
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""

    # Messenger notification channels (#263). Credentials follow the
    # BEACONFOLIO_* namespace (#141 — the generic names bit us once). Empty =
    # that channel simply does not exist in the registry; zero requests.
    telegram_bot_token: str = Field(
        default="", validation_alias="BEACONFOLIO_TELEGRAM_BOT_TOKEN"
    )
    telegram_chat_id: str = Field(
        default="", validation_alias="BEACONFOLIO_TELEGRAM_CHAT_ID"
    )
    notify_webhook_url: str = Field(
        default="", validation_alias="BEACONFOLIO_NOTIFY_WEBHOOK_URL"
    )
    # Matrix (#431): self-hosted/federated chat. Free, self-serve — a bot
    # account on the owner's OWN homeserver (or matrix.org) and an access token
    # from `POST /_matrix/client/v3/login`. ALL THREE parts are required: a
    # half-configured channel must not exist (see `configured_channels()`).
    matrix_homeserver: str = Field(
        default="", validation_alias="BEACONFOLIO_MATRIX_HOMESERVER"
    )
    matrix_access_token: str = Field(
        default="", validation_alias="BEACONFOLIO_MATRIX_ACCESS_TOKEN"
    )
    matrix_room_id: str = Field(
        default="", validation_alias="BEACONFOLIO_MATRIX_ROOM_ID"
    )
    # Self-hosted SMS gateway (#431): a REST endpoint on the owner's OWN
    # Android phone + SIM — specifically **sms-gate.app in LOCAL mode**, whose
    # contract this channel implements (Basic auth + textMessage/phoneNumbers).
    # Free beyond the existing SIM plan and — the rule-10 point — there is no
    # metered API credential to hold. httpSMS and textbee are NOT drop-in URLs
    # (header API keys, different bodies) and neither is a CPaaS URL; the
    # SmsGatewayChannel docstring carries the per-vendor compatibility table.
    sms_gateway_url: str = Field(
        default="", validation_alias="BEACONFOLIO_SMS_GATEWAY_URL"
    )
    sms_gateway_user: str = Field(
        default="", validation_alias="BEACONFOLIO_SMS_GATEWAY_USER"
    )
    sms_gateway_password: str = Field(
        default="", validation_alias="BEACONFOLIO_SMS_GATEWAY_PASSWORD"
    )
    sms_gateway_to: str = Field(
        default="", validation_alias="BEACONFOLIO_SMS_GATEWAY_TO"
    )
    notify_timeout_seconds: int = 10
    # STARTTLS + auth are ON by default (external providers). A local catch-all
    # like Mailpit (#262) speaks plain SMTP with no credentials — set
    # SMTP_STARTTLS=false and leave user/password empty; only smtp_host gates
    # whether sending is attempted at all.
    smtp_starttls: bool = True
    # From-address override; falls back to smtp_user, then a local placeholder
    # (a no-auth relay has no user to borrow the From from).
    smtp_from: str = ""

    # Transparent translation (#248): flag-disabled cleanly — off means no
    # background task is ever scheduled and the UI shows no remnants.
    translation_enabled: bool = True

    # Voice channel (#264) — browser voice messages transcribed by a LOCAL
    # Whisper. DEFAULT OFF, unlike the two flags above, for two reasons: the
    # recording widget is a separate, later change (so the endpoint has no
    # caller yet), and the first accepted message triggers a one-time model
    # download — an owner opts into that, they do not discover it. Off means
    # the endpoints 404 and no model is ever fetched.
    voice_messages_enabled: bool = False
    # HARD size cap on the upload, enforced server-side by a bounded read.
    # MEASURED: 15 s of speech encodes to ~172 KB of WebM/Opus (~96 kbit/s),
    # so 2 MB is roughly 3 MINUTES of audio — comfortably generous for a
    # 90-second note, and small enough to keep the bytes in the database next
    # to the row that references them. It is a memory/storage bound, NOT the
    # duration cap: that is the knob below, checked separately.
    voice_message_max_bytes: int = 2 * 1024 * 1024
    # Duration cap. Checked TWICE on purpose: against the browser's claim at
    # the endpoint (cheap, rejects honest oversize before storing anything)
    # and against the DECODED length in the transcriber, because the first
    # check trusts the client and the second does not.
    voice_message_max_duration_seconds: int = 90
    # A voice message costs a DB row, ~1 MB of storage and seconds of CPU, so
    # its budget is tighter than the contact form's 5/60s (one deliberate
    # human action each, but this one is far more expensive to serve).
    voice_rate_limit_requests: int = 3
    voice_rate_limit_window_seconds: int = 60
    # faster-whisper model size: tiny | base | small | medium | large-v3.
    # `base` is the small-VPS default — see README's measured latency table.
    whisper_model: str = "base"
    # CTranslate2 quantization. int8 is ~4x smaller and ~2-3x faster than
    # float32 on a CPU with no measurable accuracy loss at this task size.
    whisper_compute_type: str = "int8"
    # Where the weights are cached. MUST be a mounted volume (both compose
    # files mount `whisper_models` here): the same no-re-download-on-restart
    # pattern `ollama_data` gives Ollama's models.
    whisper_model_dir: str = "/data/whisper"

    # Engagement analytics (#249): first-party, owner-only counting of
    # meaningful events (CV request/download, contact submission). OFF means
    # exactly that — no event row is ever written and the admin endpoints 404,
    # so the dashboard has no route to reach.
    engagement_analytics_enabled: bool = True
    # Retention: events older than this many days are deleted by the purge
    # (POST /admin/analytics/purge). 0 purges everything up to *now* — the
    # documented "keep nothing" setting; a NEGATIVE value disables purging
    # entirely. Events carry no identity data, so purging destroys no recruiter
    # record: the CvRequest / Interaction rows they point at are untouched.
    engagement_retention_days: int = 365
    # How many analytics writes may hold a database connection AT ONCE (#326).
    # An emit runs off the request's critical path but out of the SAME pool, so
    # an unbounded emit count competes with request handlers for connections:
    # measured at 300 requests / concurrency 60, the emits produced 106 pool
    # timeouts and 106 of 300 events were lost. 4 keeps analytics to a small,
    # explicit slice of `db_pool_size + db_max_overflow` (60) — enough for
    # thousands of events per second, never enough to starve the request path.
    engagement_max_concurrent_writes: int = 4
    # Admission cap for emits WAITING on that slice. Reaching it means the
    # database cannot keep up with a burst; the event is dropped, counted and
    # logged (see `app.services.engagement.dropped_event_count`) rather than
    # queued without bound, because unbounded queueing turns a traffic spike
    # into memory growth. 1000 is far above any burst this backend serves — the
    # #326 reproduction peaked at 60 pending — so in practice nothing drops.
    engagement_max_pending_events: int = 1000
    # The language recruiter messages are translated INTO (ISO 639-1).
    owner_language: str = "en"
    admin_email: str = "admin@beaconfolio.com"
    api_prefix: str = "/api/app"
    # Read from BEACONFOLIO_GEMINI_API_KEY, deliberately NOT the generic
    # GEMINI_API_KEY (#141): that name is commonly exported globally from a
    # shell profile, and a process environment variable OVERRIDES .env in
    # docker compose — so the generic name silently bound a developer's live
    # personal key into the E2E stack. A project-scoped name cannot collide.
    gemini_api_key: str = Field(
        default="", validation_alias="BEACONFOLIO_GEMINI_API_KEY"
    )
    # Fernet key (urlsafe-base64, 32 bytes) used to encrypt the per-user Gemini
    # API key at rest (see app.services.crypto / issue #143). Empty disables
    # field encryption (values stored/read as plaintext) so local/dev/E2E setups
    # keep working; production sets it to encrypt the paid credential at rest.
    # Generate with: python -c "from cryptography.fernet import Fernet;
    # print(Fernet.generate_key().decode())"
    gemini_encryption_key: str = Field(
        default="", validation_alias="BEACONFOLIO_GEMINI_ENCRYPTION_KEY"
    )
    # Gemini model selection. Suggestion/tagging tasks (tags, title, slug,
    # summary) are cheap and use the flash-tier model by default; override via
    # BEACONFOLIO_GEMINI_MODEL / BEACONFOLIO_GEMINI_MODEL_FALLBACK. The fallback is only used when the
    # primary model is reported *unavailable* (HTTP 404), never on generic
    # errors — those fall through to the free local Ollama models instead of
    # making a second billable Gemini call.
    # Namespaced for the same reason as the key (#141): model choice is a COST
    # control, and an ambient GEMINI_MODEL pointing at a premium tier would
    # silently raise the price of every suggestion.
    gemini_model: str = Field(
        default="gemini-2.5-flash", validation_alias="BEACONFOLIO_GEMINI_MODEL"
    )
    gemini_model_fallback: str = Field(
        default="gemini-2.0-flash",
        validation_alias="BEACONFOLIO_GEMINI_MODEL_FALLBACK",
    )
    cv_version: str = "v1.0"

    # Site identity (#65) — the ONE place owner identity lives. Everything the
    # public site shows about its owner (title, footer, meta tags, JSON-LD,
    # email copy, analytics) derives from these at RUNTIME via
    # GET {api_prefix}/config/site, so a forker rebrands a prebuilt image with
    # env vars alone — no rebuild, no code edits. The defaults ARE the
    # anonymized demo persona (#66) — the canonical deployment sets its real
    # identity in the host .env, same as any forker. Rule: no component/service may hardcode identity — it must
    # consume this config.
    site_name: str = "My Portfolio"
    site_url: str = "https://example.com"
    owner_name: str = "Jane Doe"
    owner_headline: str = "Senior Software Engineer"
    owner_description: str = (
        "Professional portfolio of Jane Doe, a Senior Software Engineer — "
        "the Beaconfolio demo persona. Set the OWNER_*/SITE_* env vars to yours."
    )
    # Comma-separated public profile URLs (JSON-LD sameAs + contact links).
    social_links: str = ""
    # Google Analytics measurement id; empty disables analytics entirely — and
    # empty IS the default: analytics is opt-in for a general-portfolio
    # template, and a non-empty default was unreachable anyway in the only
    # supported topology (compose forwards ``${BEACONFOLIO_ANALYTICS_ID:-}``, so
    # an unset host var arrives as "" and — deliberately, see the validator
    # below — stays "": empty is this field's documented off switch, #255
    # review round 1). The canonical deployment sets its id in the host .env.
    # Namespaced like the Gemini knobs (#141): an ambient generic name could
    # silently bind someone else's id.
    analytics_id: str = Field(default="", validation_alias="BEACONFOLIO_ANALYTICS_ID")
    # Google Tag Manager container id (#447). Empty disables GTM; when set it
    # takes precedence over ``analytics_id`` and the gtag install stands down,
    # because GTM and gtag are two installs of the SAME measurement and running
    # both double-counts every pageview. Namespaced like the other knobs (#141)
    # so an ambient generic name cannot silently bind someone else's container.
    gtm_container_id: str = Field(
        default="", validation_alias="BEACONFOLIO_GTM_CONTAINER_ID"
    )
    # Brand assets (#67) — the favicon, the header logo, the social-share card
    # and the webfont, so a forker rebrands a PREBUILT image without editing
    # `index.html`, `seo.service.ts` or a component template. Served on
    # GET {api_prefix}/config/site beside the rest of the identity (#65).
    #
    # EVERY one of them defaults to "" and empty means "use the BUNDLED
    # asset" — the shipped `assets/favicon.png`, the shipped
    # `assets/og-image.png`, the text wordmark derived from ``owner_name``,
    # and the VT323 stylesheet the terminal preset needs. So an owner who sets
    # nothing gets exactly today's site; these are overrides, not requirements.
    # (That is why the empty-means-default validator below does NOT list them:
    # for these fields "" already IS the default, like ``analytics_id``.)
    #
    # Namespaced (#141): `FAVICON_URL` / `LOGO_URL` / `FONT_FAMILY` are exactly
    # the kind of generic names another process on a shared host may already
    # export, and silently inheriting someone else's brand is worse than none.
    brand_favicon_url: str = Field(
        default="", validation_alias="BEACONFOLIO_BRAND_FAVICON_URL"
    )
    brand_logo_url: str = Field(
        default="", validation_alias="BEACONFOLIO_BRAND_LOGO_URL"
    )
    brand_og_image_url: str = Field(
        default="", validation_alias="BEACONFOLIO_BRAND_OG_IMAGE_URL"
    )
    # A stylesheet URL for a webfont (a Google Fonts `css2?family=…` link, or a
    # self-hosted `@font-face` sheet). It only LOADS the face; the family that
    # actually paints is chosen by the theme preset — so overriding the face
    # without ``brand_font_family`` changes nothing visible, which is why the
    # two knobs are documented together and tested together.
    brand_font_css_url: str = Field(
        default="", validation_alias="BEACONFOLIO_BRAND_FONT_CSS_URL"
    )
    # A CSS font-family LIST (e.g. `'Inter', ui-sans-serif, sans-serif`). When
    # set it overrides the active preset's `--font-sans`/`--font-mono` on the
    # root element — the one place a value can beat a `[data-theme]` block
    # without editing the shared stylesheet.
    brand_font_family: str = Field(
        default="", validation_alias="BEACONFOLIO_BRAND_FONT_FAMILY"
    )
    # AI-crawler policy (#252) — "allow" (default) or "deny", served on
    # GET {api_prefix}/config/site and rendered into the SSR robots.txt.
    # Allow-by-default is the product thesis: recruiter research runs through AI
    # assistants, so being readable BY them is the point. An owner who objects
    # sets AI_CRAWLER_POLICY=deny and the AI user-agents (only those) get
    # `Disallow: /`. Anything unrecognized falls back to "allow" — see the
    # validator below — because a typo must not silently deindex a portfolio.
    ai_crawler_policy: str = "allow"

    @field_validator("ai_crawler_policy", mode="before")
    @classmethod
    def _normalize_ai_crawler_policy(cls, v: object) -> object:
        policy = v.strip().lower() if isinstance(v, str) else v
        return policy if policy in ("allow", "deny") else "allow"

    # Docker compose forwards these as ``SITE_NAME=${SITE_NAME:-}`` — an UNSET
    # host variable therefore arrives as an EMPTY string, which would silently
    # override the defaults above. For identity fields an empty value is never
    # meaningful, so empty means "use the default". (``analytics_id`` is
    # deliberately excluded: empty there is the documented off switch.)
    @field_validator(
        "site_name",
        "site_url",
        "owner_name",
        "owner_headline",
        "owner_description",
        "social_links",
        "cors_origins",
        mode="before",
    )
    @classmethod
    def _empty_site_field_means_default(cls, v: object, info) -> object:
        if isinstance(v, str) and v.strip() == "":
            return cls.model_fields[info.field_name].default
        return v

    # LinkedIn
    linkedin_email: str = ""
    linkedin_password: str = ""
    linkedin_public_id: str = ""
    linkedin_cookie_li_at: str = ""
    linkedin_cookie_jsessionid: str = ""
    linkedin_import_token: str = ""
    import_max_image_mb: int = 10
    # Directory where the saved LinkedIn login session (cookies) is stored. Must
    # live on a persistent, mounted volume (see docker-compose) so the session
    # survives container recreation/deploys instead of being wiped with /tmp.
    linkedin_cookies_dir: str = "/data/linkedin_cookies"

    # CORS
    cors_origins: str = "http://localhost:4200,https://beaconfolio.com,https://www.beaconfolio.com,http://beaconfolio.com,http://www.beaconfolio.com"

    # Default admin seeding.
    #
    # SECURITY (issue #142): there is intentionally NO weak default password.
    # ``ADMIN_PASSWORD`` MUST be provided in any real deployment; the lifespan
    # seed (see app.main) refuses to create a login-able default admin when this
    # is empty, so prod can never ship the historical ``admin``/``admin`` login.
    # Local dev / E2E seed their own throwaway credentials via
    # ``scripts/seed_e2e_user.py`` instead of relying on this path.
    default_admin_email: str = "admin@beaconfolio.com"
    admin_password: str = ""

    # Profile data (years API)
    profile_data_http_base: str = "http://frontend:80/assets"

    # Reverse proxies whose forwarding headers may be believed (#273). SAME
    # MEANING and same default as the proxy container's knob of this name: a
    # forwarded header is evidence only when the PEER that delivered it is one
    # of ours — anyone can type `X-Forwarded-For`/`X-Real-IP` into a request.
    # 172.16.0.0/12 is the Docker bridge range, i.e. the nginx container in
    # the shipped topology. Space/comma separated; invalid entries are ignored;
    # EMPTY means "trust nothing" and every client is keyed by its peer address
    # (the correct behaviour for a backend exposed directly, e.g. bare dev).
    trusted_proxy_cidrs: str = "172.16.0.0/12"

    # Rate limiting (in-memory, per-process, per-client-IP). Generous defaults so
    # normal browsing/SSR is never affected — this is defense-in-depth against
    # scraping/abuse of unauthenticated public GETs, not a hard traffic quota.
    profile_rate_limit_requests: int = 100
    profile_rate_limit_window_seconds: int = 60

    # The public contact form is a WRITE (DB row + owner email per request), so
    # its limit is far tighter than the read-side profile limit above (#69).
    contact_rate_limit_requests: int = 5
    contact_rate_limit_window_seconds: int = 60

    # The tailored-link public WRITES (`POST /for/{slug}/visit`, `GET
    # /for/{slug}/cv`) each append a row to the owner's opportunity timeline,
    # and the slug is unauthenticated BY DESIGN — a forwarded link is the whole
    # product — so an unlimited endpoint lets any recipient grow the DB without
    # bound and inflate the very visit signal the owner acts on (#250 review).
    # 20/minute sits between the contact form's 5 (one deliberate human action)
    # and the profile read's 100: a genuine open costs ONE call, but several
    # recruiters behind one corporate NAT share a client IP, so the budget has
    # to absorb a burst of real people without ever absorbing a scripted loop.
    tailored_visit_rate_limit_requests: int = 20
    tailored_visit_rate_limit_window_seconds: int = 60

    # Outbound SMTP: without a timeout a hung peer pins the worker thread that
    # the notification background task runs on (#69 review finding).
    smtp_timeout_seconds: int = 10

    # Operational timeouts (issue #207).
    #
    # These are host-dependent by nature, which is why they are settings rather
    # than literals: a cold model on a small VPS legitimately needs a long
    # ceiling, while a fast host would rather fail fast than hold a worker.
    # Every default below equals the literal it replaced, so an unchanged .env
    # keeps the previous behaviour exactly.
    #
    # Unlike the Gemini variables (#141) these are NOT credentials and their
    # names collide with nothing generic, so they are deliberately left
    # un-namespaced.
    #
    # Generation calls: a full LLM completion, the slowest thing the backend
    # waits on.
    llm_request_timeout_seconds: float = 300.0
    # Streaming generation: time budget for the streamed POST, where the first
    # chunk (not the whole answer) is what has to arrive in time.
    llm_stream_timeout_seconds: float = 30.0
    # Embedding calls, which are far cheaper than generation.
    embedding_request_timeout_seconds: float = 30.0
    # Liveness probes against Ollama. Kept short on purpose: this decides the
    # public "AI online" badge, so it must not hold a request open.
    ollama_healthcheck_timeout_seconds: float = 2.0
    # The multi-agent conversation pre-flights Ollama before starting; a failed
    # probe aborts the WHOLE conversation with an infrastructure error, so its
    # historical budget (5 s) is more forgiving than the stats healthcheck (2 s)
    # and must stay the literal it replaced (#209 review round 1).
    ollama_preflight_timeout_seconds: float = 5.0
    # The one-shot startup infra check, which may race a still-booting Ollama
    # and so tolerates more than a per-request probe.
    ollama_startup_check_timeout_seconds: float = 10.0
    # Fetching profile JSON from the frontend container.
    profile_data_timeout_seconds: float = 5.0
    # Ceiling for the pg_restore/psql subprocess behind the admin SQL restore.
    db_restore_timeout_seconds: int = 300

    # Bulk-import resource-exhaustion guards (issue #207).
    #
    # Siblings of ``import_max_image_mb`` above; they guard the same endpoint
    # family and are configurable for the same reason.
    import_max_posts_json_mb: int = 10
    import_max_posts_per_request: int = 500

    # populate_by_name is deliberately NOT enabled: it also re-admits the FIELD
    # NAME as an environment source, which would let the generic GEMINI_API_KEY
    # bind again and silently undo #141 (caught by
    # tests/test_config_gemini_env_isolation.py). Construct these fields by their
    # alias — Settings(BEACONFOLIO_GEMINI_API_KEY=...) — not by field name.
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()
