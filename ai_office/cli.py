"""CLI admin lokal (sementara, sampai panel admin web jadi di M6).

Contoh:
    python -m ai_office.cli create "mengenal warna"
    python -m ai_office.cli list
    python -m ai_office.cli show 1
    python -m ai_office.cli approve-script 1
    python -m ai_office.cli approve-final 1
    python -m ai_office.cli reject 1 --reason "kurang jelas"
    python -m ai_office.cli retry 1
    python -m ai_office.cli mode full_auto
    python -m ai_office.cli demo "hewan dan suaranya"   # jalankan 1 job sampai done tanpa server
"""

from __future__ import annotations

import argparse
import json
import sys

from .bootstrap import build_orchestrator, setup_logging
from .config import load_config
from .models import InvalidTransition, JobStatus
from .orchestrator import Orchestrator


def _print_json(data: object) -> None:
    print(json.dumps(data, ensure_ascii=False, indent=2))


def cmd_demo(orch: Orchestrator, topic: str) -> int:
    """Jalankan satu job sampai selesai, menyetujui kedua gerbang otomatis (untuk uji M0)."""
    job = orch.create_job(topic)
    print(f"Job {job.id} dibuat. Memproses…")
    for _ in range(10):
        job = orch.process_job(job.id)
        print(f"  status sekarang: {job.status.value}")
        if job.status == JobStatus.AWAITING_SCRIPT_APPROVAL:
            job = orch.approve_script(job.id)
        elif job.status == JobStatus.AWAITING_FINAL_APPROVAL:
            job = orch.approve_final(job.id)
        else:
            break
    print(f"Selesai dengan status: {job.status.value}")
    return 0 if job.status == JobStatus.DONE else 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="ai_office.cli", description="CLI admin AI Office")
    parser.add_argument("--config", default=None, help="path config.yaml")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("create", help="buat job baru")
    p.add_argument("topic")
    p.add_argument("--age", default=None)
    p.add_argument("--style", default=None)
    sub.add_parser("list", help="daftar job")
    for name in ("show", "approve-script", "approve-final", "retry"):
        sub.add_parser(name).add_argument("job_id", type=int)
    p = sub.add_parser("reject")
    p.add_argument("job_id", type=int)
    p.add_argument("--reason", default="")
    p = sub.add_parser("mode", help="lihat / ubah mode (semi_auto | full_auto)")
    p.add_argument("value", nargs="?", choices=["semi_auto", "full_auto"])
    p = sub.add_parser("demo", help="jalankan 1 job palsu sampai done (tanpa server)")
    p.add_argument("topic", nargs="?", default="mengenal warna")

    args = parser.parse_args(argv)
    setup_logging("WARNING")
    orch = build_orchestrator(load_config(args.config))

    try:
        match args.cmd:
            case "create":
                job = orch.create_job(args.topic, age_group=args.age, style=args.style)
                print(f"Job {job.id} masuk antrean. Server (python run.py) akan memprosesnya.")
            case "list":
                for j in orch.db.list_jobs():
                    print(f"#{j.id:<4} {j.status.value:<26} {j.title or j.topic}")
            case "show":
                job = orch.db.require_job(args.job_id)
                _print_json({**job.admin_dict(), "logs": orch.db.get_logs(job.id),
                             "safety_reviews": orch.db.get_safety_reviews(job.id)})
            case "approve-script":
                print(f"Status: {orch.approve_script(args.job_id).status.value}")
            case "approve-final":
                print(f"Status: {orch.approve_final(args.job_id).status.value}")
            case "reject":
                print(f"Status: {orch.reject(args.job_id, args.reason).status.value}")
            case "retry":
                print(f"Status: {orch.retry(args.job_id).status.value}")
            case "mode":
                if args.value:
                    orch.set_mode(args.value)
                print(f"Mode: {orch.mode}")
            case "demo":
                return cmd_demo(orch, args.topic)
    except (InvalidTransition, KeyError, ValueError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
