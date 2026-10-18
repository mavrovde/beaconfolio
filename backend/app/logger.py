import logging
import re
import sys

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)


# SECURITY (#297 review): httpx logs every request URL at INFO through the
# root handler above — and the Telegram Bot API embeds the BOT TOKEN in the
# URL, so a successful notification printed the credential into the container
# logs (reproduced in the running container). Same for httpcore's debug lines.
# WARNING+ still surfaces real transport problems.
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)


def get_logger(name: str):
    """Return a logger with the specified name."""
    return logging.getLogger(name)


# C0 controls other than CR/LF (handled first, by name) plus DEL: a terminal
# escape (`\x1b[...`) in a request field could rewrite what an operator sees.
_CONTROL_CHARS = re.compile(r"[\x00-\x09\x0b\x0c\x0e-\x1f\x7f]")


def log_safe(value: object) -> str:
    """Render a request-supplied value for a log line without forging lines.

    The log format is one record per line, so a raw ``\\n`` in a form field
    (a LinkedIn URN, a language code) would let a caller append a fake record
    (CWE-117, Sonar pythonsecurity:S5145). Line breaks and other control
    characters are escaped, visibly, rather than dropped: the operator sees
    that the input carried them.
    """
    text = str(value).replace("\r", "\\r").replace("\n", "\\n")
    return _CONTROL_CHARS.sub(lambda m: f"\\x{ord(m.group()):02x}", text)


logger = get_logger("app")
