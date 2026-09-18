"""Admin-editable runtime site settings (#271, #339).

The first key is `availability` — the owner's job-search state, rendered on
the public hero next to the hire-me CTA. The second is `theme` — which of the
five preset token sets the public site paints itself with (#339). Env-driven
identity (#65) cannot change without a redeploy; these can. Each key's allowed
values are validated HERE, so the KV table stays feature-agnostic.

Both keys have the same three-part shape, deliberately: a vocabulary tuple
with a default, a ``read_*`` for the admin path, and a ``read_*_or_default``
that DEGRADES for the public path. The public read must never 500 the site's
bootstrap over a DB outage — the client already degrades identity to a neutral
default when the backend is unreachable, and the server has to agree with it.
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.site_setting import SiteSetting
from app.services.auth import get_current_admin_user

router = APIRouter(
    prefix="/admin/site-settings",
    tags=["admin-site-settings"],
    dependencies=[Depends(get_current_admin_user)],
)

# The public vocabulary. Rendered verbatim by the frontend's i18n keys, so a
# new state means a new translation in BOTH en.json and de.json — the test
# that reads those files will fail otherwise.
AVAILABILITY_STATES = ("open", "listening", "not_looking")
AVAILABILITY_DEFAULT = "listening"
AVAILABILITY_KEY = "availability"

# The five preset themes (#339). `terminal` stays FIRST and is the default:
# it is today's green-phosphor look, and a deployment that never picks a theme
# has to keep rendering exactly as it does now. These names are stamped
# verbatim into `data-theme` on the public site's root element and matched by a
# `[data-theme="..."]` block in its stylesheet, so a name added here WITHOUT a
# matching block yields an untokenized page rather than a fallback — which is
# why `test_every_theme_preset_has_a_stylesheet_block` reads that file.
THEME_PRESETS = ("terminal", "dark", "light", "modern", "classic")
THEME_DEFAULT = "terminal"
THEME_KEY = "theme"


class AvailabilityOut(BaseModel):
    value: str


class AvailabilityIn(BaseModel):
    value: str


class ThemeOut(BaseModel):
    value: str


class ThemeIn(BaseModel):
    value: str


async def read_availability(db: AsyncSession) -> str:
    """Shared with the public /config/site endpoint: one definition of
    'current availability', default included."""
    row = await db.get(SiteSetting, AVAILABILITY_KEY)
    return row.value if row else AVAILABILITY_DEFAULT


async def read_availability_or_default(db: AsyncSession) -> str:
    """``read_availability`` for PUBLIC read paths: a DB failure degrades.

    Both public consumers — the site config bootstrap (#65) and the machine-
    readable resume (#252) — must survive a DB outage the way the client does:
    identity degrades to the default, the endpoint never 500s. One definition,
    because two copies of "and don't blow up" drift.
    """
    try:
        return await read_availability(db)
    except Exception:  # any DB failure degrades, never breaks
        return AVAILABILITY_DEFAULT


@router.get("/availability", response_model=AvailabilityOut)
async def get_availability(db: AsyncSession = Depends(get_db)) -> AvailabilityOut:
    return AvailabilityOut(value=await read_availability(db))


@router.put("/availability", response_model=AvailabilityOut)
async def set_availability(
    body: AvailabilityIn, db: AsyncSession = Depends(get_db)
) -> AvailabilityOut:
    if body.value not in AVAILABILITY_STATES:
        raise HTTPException(
            status_code=422,
            detail=f"availability must be one of {', '.join(AVAILABILITY_STATES)}",
        )
    row = await db.get(SiteSetting, AVAILABILITY_KEY)
    if row is None:
        db.add(SiteSetting(key=AVAILABILITY_KEY, value=body.value))
    else:
        row.value = body.value
    await db.commit()
    return AvailabilityOut(value=body.value)


async def read_theme(db: AsyncSession) -> str:
    """The chosen preset, default included — shared with /config/site."""
    row = await db.get(SiteSetting, THEME_KEY)
    # A value outside the vocabulary — a hand-edited row, or a preset that a
    # downgrade removed — normalizes to the default. The write path validates;
    # the read path degrades. Without this the public site would stamp a
    # `data-theme` that no stylesheet block matches and render untokenized,
    # which is a worse failure than ignoring the row (same reasoning as
    # `availability`'s normalization, #295 review nit 8).
    return row.value if row and row.value in THEME_PRESETS else THEME_DEFAULT


async def read_theme_or_default(db: AsyncSession) -> str:
    """``read_theme`` for the PUBLIC read path: a DB failure degrades.

    Same contract as ``read_availability_or_default`` — /config/site is the
    public site's bootstrap and must survive a DB outage.
    """
    try:
        return await read_theme(db)
    except Exception:  # any DB failure degrades, never breaks
        return THEME_DEFAULT


@router.get("/theme", response_model=ThemeOut)
async def get_theme(db: AsyncSession = Depends(get_db)) -> ThemeOut:
    return ThemeOut(value=await read_theme(db))


@router.put("/theme", response_model=ThemeOut)
async def set_theme(body: ThemeIn, db: AsyncSession = Depends(get_db)) -> ThemeOut:
    if body.value not in THEME_PRESETS:
        raise HTTPException(
            status_code=422,
            detail=f"theme must be one of {', '.join(THEME_PRESETS)}",
        )
    row = await db.get(SiteSetting, THEME_KEY)
    if row is None:
        db.add(SiteSetting(key=THEME_KEY, value=body.value))
    else:
        row.value = body.value
    await db.commit()
    return ThemeOut(value=body.value)
