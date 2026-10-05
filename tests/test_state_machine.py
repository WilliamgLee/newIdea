from __future__ import annotations

import pytest

from ai_office.models import ALLOWED_TRANSITIONS, InvalidTransition, JobStatus, check_transition

S = JobStatus


def test_every_status_has_transition_entry() -> None:
    assert set(ALLOWED_TRANSITIONS) == set(JobStatus)


@pytest.mark.parametrize(
    ("a", "b"),
    [
        (S.QUEUED, S.WRITING),
        (S.WRITING, S.SAFETY_REVIEW),
        (S.SAFETY_REVIEW, S.WRITING),
        (S.SAFETY_REVIEW, S.AWAITING_SCRIPT_APPROVAL),
        (S.AWAITING_SCRIPT_APPROVAL, S.VOICING),
        (S.VOICING, S.ANIMATING),
        (S.ANIMATING, S.EDITING),
        (S.EDITING, S.AWAITING_FINAL_APPROVAL),
        (S.AWAITING_FINAL_APPROVAL, S.DELIVERING),
        (S.DELIVERING, S.DONE),
        (S.AWAITING_SCRIPT_APPROVAL, S.REJECTED),
        (S.FAILED, S.VOICING),
    ],
)
def test_allowed(a: JobStatus, b: JobStatus) -> None:
    check_transition(a, b)


@pytest.mark.parametrize(
    ("a", "b"),
    [
        (S.QUEUED, S.DONE),
        (S.WRITING, S.VOICING),             # tidak boleh melewati review keamanan
        (S.SAFETY_REVIEW, S.VOICING),       # tidak boleh melewati gerbang 1
        (S.EDITING, S.DELIVERING),          # tidak boleh melewati gerbang 2
        (S.DONE, S.QUEUED),
        (S.REJECTED, S.QUEUED),
        (S.VOICING, S.REJECTED),
    ],
)
def test_forbidden(a: JobStatus, b: JobStatus) -> None:
    with pytest.raises(InvalidTransition):
        check_transition(a, b)
