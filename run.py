"""Jalankan AI Office (server web + worker) dengan satu perintah:

    python run.py
    python run.py --config config.yaml
"""

from __future__ import annotations

import argparse
import logging

from ai_office.bootstrap import build_orchestrator, setup_logging
from ai_office.config import load_config


def main() -> None:
    parser = argparse.ArgumentParser(description="AI Office")
    parser.add_argument("--config", default=None, help="path config.yaml")
    parser.add_argument("--log-level", default="INFO")
    parser.add_argument("--open", action="store_true", help="buka dashboard di browser otomatis")
    args = parser.parse_args()

    setup_logging(args.log_level)
    config = load_config(args.config)

    import uvicorn

    from ai_office.web.api import build_auth, create_app

    orchestrator = build_orchestrator(config)
    auth = build_auth(orchestrator)
    app = create_app(orchestrator, auth=auth)

    log = logging.getLogger("ai_office")
    if config.server.host not in ("127.0.0.1", "localhost", "::1"):
        log.warning("Server bind ke %s (bukan localhost). Pastikan kamu paham risikonya.",
                    config.server.host)
    if not auth.admin.exists():
        log.warning("Admin belum dibuat. Jalankan: python scripts/set_admin.py "
                    "(panel admin butuh login).")

    url = f"http://{config.server.host}:{config.server.port}"
    print(f"AI Office berjalan di {url}")
    print(f"  Dashboard publik : {url}")
    print(f"  Panel admin      : {url}/admin")
    if args.open:
        import threading
        import webbrowser

        threading.Timer(1.5, lambda: webbrowser.open(url)).start()
    uvicorn.run(app, host=config.server.host, port=config.server.port,
                log_level=args.log_level.lower())


if __name__ == "__main__":
    main()
