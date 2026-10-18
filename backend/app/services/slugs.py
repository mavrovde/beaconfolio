"""Slug helpers shared by the post-creating endpoints."""

import secrets


def slug_suffix() -> str:
    """A four-digit suffix (1000-9999) that disambiguates a colliding slug.

    Drawn from ``secrets`` rather than ``random``: a slug is a public URL, and
    the CSPRNG costs nothing here, whereas the module-level ``random`` state is
    seedable/predictable (Sonar python:S2245). Uniqueness is still enforced by
    the database constraint — callers retry on collision.
    """
    return str(1000 + secrets.randbelow(9000))
