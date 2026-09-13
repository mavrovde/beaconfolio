from datetime import UTC

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.logger import logger
from app.models.cv_document import CvDocument
from app.models.cv_request import CvRequest
from app.services.email import email_service
from app.services.engagement import record_event

router = APIRouter(prefix="/cv", tags=["cv"])


class CvRequestPayload(BaseModel):
    name: str = Field(..., min_length=2)
    email: EmailStr
    company: str | None = None
    message: str = Field(..., min_length=5)
    position_description: str | None = Field(None, max_length=1000)
    subscribe_to_updates: bool = False


@router.post("/request")
async def request_cv(
    payload: CvRequestPayload,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    try:
        # Pre-check: Verify there is an active CV document
        # This prevents users from being "informed" they can download it when it's missing.
        result = await db.execute(select(CvDocument).where(CvDocument.is_active))
        active_cv = result.scalar_one_or_none()

        if not active_cv:
            logger.error("CV missing: No active DB entry found.")
            raise HTTPException(status_code=404, detail="CV_ERROR_UNAVAILABLE")

        # 1. Save request to DB
        cv_request = CvRequest(
            name=payload.name,
            email=payload.email,
            company=payload.company,
            message=payload.message,
            position_description=payload.position_description,
            subscribe_to_updates=payload.subscribe_to_updates,
            consent_given=True,  # Default to true as per new policy
            cv_version=active_cv.version,
        )
        db.add(cv_request)
        await db.commit()
        await db.refresh(cv_request)
        # Captured BEFORE the guarded block below: a rollback there expires the
        # ORM object, and touching cv_request.id afterwards would lazily reload
        # it — sync IO inside the async context (greenlet error). Pinned by
        # test_cv_request_survives_inbox_indexing_failure.
        cv_request_id = cv_request.id
        # Same reason, same trap: the analytics payload below reads the CV
        # version, and `active_cv` is expired by that same rollback.
        cv_version = active_cv.version

        # 1b. Index it in the unified inbox (#69): the CvRequest stays the
        # domain record; the Interaction is the hub entry linking back via
        # source_ref. Never blocks the CV flow on failure.
        inbox_interaction_id = None
        try:
            from app.models.interaction import Interaction

            interaction = Interaction(
                source="cv_request",
                source_ref=cv_request_id,
                status="new",
                name=payload.name,
                email=payload.email,
                company=payload.company,
                message=payload.message,
                payload={
                    "position_description": payload.position_description,
                    "cv_version": active_cv.version,
                },
            )
            db.add(interaction)
            # Flush assigns the PK; captured here simply because this is the
            # earliest point it exists. (Post-commit access would also work —
            # expire_on_commit=False — and the except path below discards the
            # id anyway; this is convention with cv_request_id above, not a
            # correctness requirement.)
            await db.flush()
            inbox_interaction_id = interaction.id
            await db.commit()
        except Exception as e:
            logger.error(f"Failed to index CV request in the inbox: {e}")
            await db.rollback()
            inbox_interaction_id = None

        # Engagement analytics (#249): count the request. Best-effort by
        # contract — record_event writes through its own session and swallows
        # its own failures, so analytics can never cost the owner a CV request
        # — and scheduled rather than awaited, so it costs the requester no
        # response time either.
        background_tasks.add_task(
            record_event,
            "cv_request",
            subject_id=cv_request_id,
            payload={"cv_version": cv_version},
        )

        # Transparent translation (#248): a CV request is a recruiter message
        # in the same inbox — it gets the same background translation as the
        # contact form, and the same guarantee: never blocks the CV flow.
        if inbox_interaction_id is not None and settings.translation_enabled:
            from app.services.translation import translate_interaction

            background_tasks.add_task(translate_interaction, inbox_interaction_id)

        # 2. Send emails in background
        background_tasks.add_task(process_email_notifications, cv_request_id, payload)

        return {
            "success": True,
            "message": "Request received. You can now download the CV.",
            "download_url": f"{settings.api_prefix}/cv/download?req_id={cv_request_id}",
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error processing CV request: {e}")
        raise HTTPException(status_code=500, detail="Failed to process request")


@router.get("/download")
async def download_cv(
    background_tasks: BackgroundTasks,
    req_id: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    try:
        # 1. Update tracking if req_id provided
        if req_id:
            try:
                from datetime import datetime

                # ONE atomic statement, not read-modify-write (#326). The ORM
                # form (`cv_request.download_count += 1`) computes the new
                # value in Python from a value read earlier, so concurrent
                # downloads of the SAME link all read N and all write N+1 —
                # every increment but one is lost. MEASURED before this change,
                # 300 downloads at concurrency 60 with analytics OFF (so no
                # pool pressure at all, 1.5 s, zero errors): download_count
                # ended at 3. `download_count + 1` is evaluated by Postgres
                # under the row lock, so the count is exact.
                # The UUID format is still validated implicitly by the
                # statement, and RETURNING tells us whether the row existed.
                stmt = (
                    update(CvRequest)
                    .where(CvRequest.id == req_id)
                    .values(
                        downloaded_at=datetime.now(UTC),
                        download_count=CvRequest.download_count + 1,
                    )
                    .returning(CvRequest.id)
                    # Keep any copy of this row already loaded in THIS session
                    # consistent with what the database now holds — a Core
                    # UPDATE bypasses the identity map, so without this a later
                    # read in the same session would serve the pre-increment
                    # value.
                    .execution_options(synchronize_session="fetch")
                )
                downloaded_id = (await db.execute(stmt)).scalar_one_or_none()

                if downloaded_id:
                    await db.commit()
                    # Engagement analytics (#249): ONE ROW PER DOWNLOAD. The
                    # counter above cannot answer "when" for anything but the
                    # last open, so the per-week trend needs its own event.
                    # Scheduled, not awaited: the visitor waits for their PDF,
                    # not for our bookkeeping (see record_event's docstring).
                    background_tasks.add_task(
                        record_event, "cv_download", subject_id=downloaded_id
                    )
            except Exception as e:
                logger.warning(f"Failed to track download for req_id {req_id}: {e}")

        # 2. Get active CV from DB
        cv_result = await db.execute(select(CvDocument).where(CvDocument.is_active))
        cv_doc = cv_result.scalar_one_or_none()

        if not cv_doc:
            logger.warning("No active CV found in DB.")
            raise HTTPException(status_code=404, detail="CV_ERROR_UNAVAILABLE")

        # 3. Return DB content
        return Response(
            content=cv_doc.data,
            media_type="application/pdf",
            headers={
                "Content-Disposition": f'attachment; filename="{cv_doc.filename}"'
            },
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error downloading CV: {e}")
        raise HTTPException(status_code=500, detail="Failed to download CV")


async def process_email_notifications(request_id, payload):
    # 1. Notify Admin
    email_service.send_cv_request_notification(
        name=payload.name,
        email=payload.email,
        company=payload.company or "N/A",
        message=payload.message,
        position_description=payload.position_description,
        subscribe_to_updates=payload.subscribe_to_updates,
    )

    # 2. Notify Requester
    email_service.send_requester_confirmation(name=payload.name, email=payload.email)

    logger.info(f"Emails sent for CV request {request_id}")
