"""Event bus in-process + pelacak status agent untuk dashboard real-time (SSE).

Worker berjalan di thread terpisah, sedangkan SSE berjalan di event loop asyncio.
`EventBus.publish` aman dipanggil dari thread mana pun.
"""

from __future__ import annotations

import asyncio
import itertools
import logging
import threading
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Any

from .models import AGENT_LABELS, AgentName, AgentState

log = logging.getLogger(__name__)


@dataclass
class Event:
    type: str                      # mis. "job_status", "agent_state", "job_created"
    data: dict[str, Any]
    id: int = 0
    ts: float = field(default_factory=time.time)

    def to_dict(self) -> dict[str, Any]:
        return {"id": self.id, "type": self.type, "ts": self.ts, "data": self.data}


class EventBus:
    def __init__(self, history_size: int = 200) -> None:
        self._lock = threading.Lock()
        self._subs: list[tuple[asyncio.AbstractEventLoop, asyncio.Queue[Event]]] = []
        self._history: deque[Event] = deque(maxlen=history_size)
        self._counter = itertools.count(1)

    def publish(self, type_: str, data: dict[str, Any]) -> Event:
        with self._lock:
            event = Event(type=type_, data=data, id=next(self._counter))
            self._history.append(event)
            subs = list(self._subs)
        for loop, queue in subs:
            try:
                loop.call_soon_threadsafe(_put_drop_oldest, queue, event)
            except RuntimeError:  # loop sudah ditutup
                self.unsubscribe(queue)
        return event

    def subscribe(self, maxsize: int = 100) -> asyncio.Queue[Event]:
        """Dipanggil dari dalam event loop (handler SSE)."""
        queue: asyncio.Queue[Event] = asyncio.Queue(maxsize=maxsize)
        with self._lock:
            self._subs.append((asyncio.get_running_loop(), queue))
        return queue

    def unsubscribe(self, queue: asyncio.Queue[Event]) -> None:
        with self._lock:
            self._subs = [(lp, q) for lp, q in self._subs if q is not queue]

    def history(self, since_id: int = 0) -> list[Event]:
        with self._lock:
            return [e for e in self._history if e.id > since_id]

    @property
    def subscriber_count(self) -> int:
        with self._lock:
            return len(self._subs)


def _put_drop_oldest(queue: asyncio.Queue[Event], event: Event) -> None:
    """Klien lambat tidak boleh menahan sistem: buang event tertua bila antrean penuh."""
    if queue.full():
        try:
            queue.get_nowait()
        except asyncio.QueueEmpty:
            pass
    queue.put_nowait(event)


@dataclass
class _AgentStatus:
    state: AgentState = AgentState.IDLE
    since: float = field(default_factory=time.time)
    job_id: int | None = None


class AgentTracker:
    """Menyimpan status tiap agent: working / just_done / idle / offline."""

    def __init__(self, bus: EventBus, just_done_sec: float = 15.0) -> None:
        self._bus = bus
        self._just_done_sec = just_done_sec
        self._lock = threading.Lock()
        self._status: dict[AgentName, _AgentStatus] = {a: _AgentStatus() for a in AgentName}
        self._offline: set[AgentName] = set()

    def set_working(self, agent: AgentName, job_id: int) -> None:
        self._set(agent, AgentState.WORKING, job_id)

    def set_done(self, agent: AgentName, job_id: int) -> None:
        self._set(agent, AgentState.JUST_DONE, job_id)

    def set_idle(self, agent: AgentName) -> None:
        self._set(agent, AgentState.IDLE, None)

    def set_available(self, agent: AgentName, available: bool) -> None:
        with self._lock:
            changed = (agent in self._offline) == available
            if available:
                self._offline.discard(agent)
            else:
                self._offline.add(agent)
        if changed:
            self._bus.publish("agent_state", self.agent_dict(agent))

    def _set(self, agent: AgentName, state: AgentState, job_id: int | None) -> None:
        with self._lock:
            self._status[agent] = _AgentStatus(state=state, job_id=job_id)
        self._bus.publish("agent_state", self.agent_dict(agent))

    def effective_state(self, agent: AgentName, now: float | None = None) -> AgentState:
        now = now or time.time()
        with self._lock:
            st = self._status[agent]
            offline = agent in self._offline
        if st.state == AgentState.WORKING:
            return AgentState.WORKING
        if offline:
            return AgentState.OFFLINE
        if st.state == AgentState.JUST_DONE and now - st.since > self._just_done_sec:
            return AgentState.IDLE
        return st.state

    def agent_dict(self, agent: AgentName) -> dict[str, Any]:
        with self._lock:
            st = self._status[agent]
        return {
            "agent": agent.value,
            "label": AGENT_LABELS[agent],
            "state": self.effective_state(agent).value,
            "since": st.since,
            "job_id": st.job_id,
        }

    def snapshot(self) -> list[dict[str, Any]]:
        return [self.agent_dict(a) for a in AgentName]
