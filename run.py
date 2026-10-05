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
    args = parser.parse_args()

    setup_logging(args.log_level)
    config = load_config(args.config)

    import uvicorn

    from ai_office.web.api import create_app

    app = create_app(build_orchestrator(config))
    if config.server.host not in ("127.0.0.1", "localhost", "::1"):
        logging.getLogger("ai_office").warning(
            "Server bind ke %s (bukan localhost). Pastikan kamu paham risikonya.",
            config.server.host,
        )
    print(f"AI Office berjalan di http://{config.server.host}:{config.server.port}")
    uvicorn.run(app, host=config.server.host, port=config.server.port,
                log_level=args.log_level.lower())


if __name__ == "__main__":
    main()
