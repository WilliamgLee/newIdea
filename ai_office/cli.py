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
from pathlib import Path

from .bootstrap import build_orchestrator, setup_logging
from .config import load_config
from .models import InvalidTransition, JobStatus
from .orchestrator import Orchestrator


def _print_json(data: object) -> None:
    print(json.dumps(data, ensure_ascii=False, indent=2))


def cmd_review(orch: Orchestrator, job_id: int) -> None:
    """Tampilkan naskah + hasil review keamanan dengan format yang mudah dibaca."""
    job = orch.db.require_job(job_id)
    script = (job.artifacts.get("writer") or {}).get("script")
    print(f"Job #{job.id} [{job.status.value}] topik: {job.topic}")
    if not script:
        print("(naskah belum ada)")
    else:
        print(f"\nJUDUL : {script['title']}\nHOOK  : {script['hook']}\n"
              f"DURASI: {script['total_duration_sec']} detik\n")
        for s in script["scenes"]:
            p = s["params"]
            extra = " ".join(f"{k}={v}" for k, v in p.items()
                             if k in ("items", "count", "color") and v)
            print(f"  [{s['id']}] {s['duration_sec']:>4}s {s['template']:<14} "
                  f"{p['character']}/{p['pose']}/{p['emotion']} @{p['background']} {extra}")
            print(f"       \"{s['narration']}\"  | layar: {s['on_screen_text']}")
        print(f"\nTUJUAN BELAJAR: {script['learning_goal']}")
        print(f"HASHTAG: {' '.join(script['hashtags'])}")
    voice = job.artifacts.get("voice")
    if voice and "sentences" in str(voice):
        print_voice(voice)
    for r in orch.db.get_safety_reviews(job.id):
        rev = r["review"]
        print(f"\n--- Review keamanan putaran {r['round']}: {r['verdict'].upper()} ---")
        for item in rev.get("items", []):
            mark = "OK " if item["ok"] else "XX "
            print(f"  {mark}{item['criterion']}: {item['reason']}")
        for sug in rev.get("suggestions", []):
            print(f"  saran: {sug}")
    if job.error:
        print(f"\nERROR: {job.error}")


def print_voice(voice: dict) -> None:
    print(f"\n--- Suara ({voice['engine']} {voice['voice']}, rate {voice['rate']}): "
          f"total {voice['total_duration_sec']:.1f} detik ---")
    for s in voice["scenes"]:
        print(f"  [{s['scene_id']}] suara {s['audio_duration_sec']:.2f}s -> scene "
              f"{s['duration_sec']:.2f}s  timing={s['timing_source']} "
              f"({s['word_coverage']:.0%})  {s['audio_file']}")
        for sent in s["sentences"]:
            words = " ".join(f"{w['text']}@{w['start']:.2f}" for w in sent["words"])
            print(f"       {sent['start']:5.2f}-{sent['end']:5.2f}  {words}")


def cmd_voice_file(orch: Orchestrator, path: Path) -> int:
    from .agents.voice import VoiceAgent
    from .bootstrap import make_script_validator
    from .schemas import Script
    from .tts import build_engine

    data = make_script_validator(orch.config)(json.loads(path.read_text(encoding="utf-8")))
    agent = VoiceAgent(orch.config, build_engine(orch.config.voice, orch.config.base_dir))
    if not agent.is_available():
        print("Error: edge-tts atau ffmpeg/ffprobe belum terpasang.", file=sys.stderr)
        return 1
    workdir = orch.config.output_dir / f"manual_{path.stem}"
    workdir.mkdir(parents=True, exist_ok=True)
    result = agent.voice_script(Script.model_validate(data), workdir, log=print)
    (workdir / "voice.json").write_text(
        json.dumps(result.model_dump(mode="json"), ensure_ascii=False, indent=2),
        encoding="utf-8")
    print_voice(result.model_dump(mode="json"))
    print(f"\nFile audio ada di: {workdir / 'audio'}")
    return 0


def cmd_render_file(orch: Orchestrator, path: Path, no_voice: bool) -> int:
    from .agents.animator import AnimatorAgent
    from .agents.voice import VoiceAgent, align_words
    from .animation.plan import build_plan
    from .animation.renderer.render import render_plan_to_mp4
    from .bootstrap import make_script_validator
    from .schemas import SceneAudio, Script, VoiceResult
    from .tts import build_engine

    cfg = orch.config
    data = make_script_validator(cfg)(json.loads(path.read_text(encoding="utf-8")))
    script = Script.model_validate(data)
    workdir = cfg.output_dir / f"manual_{path.stem}"
    workdir.mkdir(parents=True, exist_ok=True)

    animator = AnimatorAgent(cfg)
    if not animator.is_available():
        print("Error: Playwright/Chromium atau ffmpeg belum siap. Lihat 'doctor'.", file=sys.stderr)
        return 1

    if no_voice:
        scenes = []
        for s in script.scenes:
            sent, _ = align_words(s.narration, [], s.duration_sec)
            scenes.append(SceneAudio(scene_id=s.id, audio_file=f"audio/scene_{s.id}.wav",
                                     audio_duration_sec=s.duration_sec, duration_sec=s.duration_sec,
                                     sentences=sent, timing_source="estimated", word_coverage=0.0))
        voice = VoiceResult(engine="none", voice="", rate="+0%", scenes=scenes,
                            total_duration_sec=sum(s.duration_sec for s in scenes))
    else:
        va = VoiceAgent(cfg, build_engine(cfg.voice, cfg.base_dir))
        if not va.is_available():
            print("Error: edge-tts/ffmpeg belum siap (pakai --no-voice untuk melewati suara).",
                  file=sys.stderr)
            return 1
        voice = va.voice_script(script, workdir, log=print)

    plan = build_plan(script, voice, cfg.video.fps)
    (workdir / "plan.json").write_text(json.dumps(plan, ensure_ascii=False, indent=2),
                                       encoding="utf-8")
    mp4 = render_plan_to_mp4(plan, workdir, cfg.video.fps, cfg.video.encoder, log_fn=print)
    print(f"\nKlip animasi: {mp4}  ({plan['total_duration']:.1f} detik, tanpa audio)")
    return 0


def cmd_build_file(orch: Orchestrator, path: Path) -> int:
    """Jalankan Suara -> Animasi -> Editor dari naskah buatan tangan (tanpa LLM)."""
    from .agents.animator import AnimatorAgent
    from .agents.voice import VoiceAgent
    from .bootstrap import make_script_validator
    from .editor.editor import EditorAgent
    from .schemas import Script, VoiceResult
    from .tts import build_engine

    cfg = orch.config
    data = make_script_validator(cfg)(json.loads(path.read_text(encoding="utf-8")))
    script = Script.model_validate(data)
    workdir = cfg.output_dir / f"manual_{path.stem}"
    workdir.mkdir(parents=True, exist_ok=True)

    va = VoiceAgent(cfg, build_engine(cfg.voice, cfg.base_dir))
    animator = AnimatorAgent(cfg)
    editor = EditorAgent(cfg)
    for name, agent in (("suara", va), ("animasi", animator), ("editor", editor)):
        if not agent.is_available():
            print(f"Error: dependensi untuk {name} belum siap. Lihat 'doctor'.", file=sys.stderr)
            return 1

    print("[1/3] membuat suara...")
    voice = va.voice_script(script, workdir, log=print)
    (workdir / "voice.json").write_text(
        json.dumps(voice.model_dump(mode="json"), ensure_ascii=False, indent=2), encoding="utf-8")

    print("[2/3] merender animasi...")
    from .animation.plan import build_plan
    from .animation.renderer.render import render_plan_to_mp4
    plan = build_plan(script, voice, cfg.video.fps)
    clip = render_plan_to_mp4(plan, workdir, cfg.video.fps, cfg.video.encoder, log_fn=print)

    print("[3/3] menggabungkan video final...")
    result = editor.assemble(script, VoiceResult.model_validate(voice.model_dump(mode="json")),
                             clip, workdir, job_id=0, log=print)
    print(f"\nVideo final: {workdir / result['video_file']}")
    print(f"Thumbnail  : {workdir / result['thumbnail_file']}")
    print(f"Metadata   : {workdir / result['metadata_file']}")
    print(f"Durasi {result['duration_sec']} detik | encoder {result['encoder']} | "
          f"audio={result['has_audio']} subtitle={result['has_subtitle']} musik={result['has_music']}")
    return 0


def cmd_doctor(orch: Orchestrator) -> int:
    cfg = orch.config.llm
    model = cfg.model if cfg.provider == "ollama" else cfg.gemini_model
    print(f"Provider LLM: {cfg.provider} (model: {model})")
    ok_all = True
    for name, agent in orch.agents.items():
        fake = name.value in orch.config.agents.fake
        ok = agent.is_available()
        ok_all &= ok
        print(f"  {name.value:<9} {'palsu' if fake else 'asli ':<5}  "
              f"{'siap' if ok else 'TIDAK TERSEDIA'}")
    unavailable = {n.value for n, a in orch.agents.items() if not a.is_available()}
    if unavailable & {"writer", "safety"} and cfg.provider == "ollama":
        print(f"\nPastikan Ollama berjalan dan model sudah di-pull:  ollama pull {cfg.model}")
    if "voice" in unavailable:
        print("\nPengisi Suara butuh: pip install -r requirements.txt (edge-tts) dan ffmpeg "
              "(winget install Gyan.FFmpeg, lalu buka terminal baru).")
    if "animator" in unavailable:
        print("\nPembuat Animasi butuh: pip install -r requirements.txt lalu "
              "python -m playwright install chromium, plus ffmpeg.")
    if "editor" in unavailable:
        print("\nEditor butuh ffmpeg (winget install Gyan.FFmpeg, lalu buka terminal baru).")
    v = orch.config.voice
    if v.engine == "xtts":
        from .tts.xtts import XTTS_LANGUAGES

        if v.xtts.language not in XTTS_LANGUAGES:
            print(f"\nPERINGATAN: voice.engine=xtts tapi voice.xtts.language='{v.xtts.language}' "
                  "tidak didukung XTTS. Untuk Bahasa Indonesia pakai engine: edge-tts.")
    return 0 if ok_all else 1


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
    print()
    cmd_review(orch, job.id)
    print(f"\nSelesai dengan status: {job.status.value}")
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
    for name in ("show", "review", "approve-final", "retry"):
        sub.add_parser(name).add_argument("job_id", type=int)
    p = sub.add_parser("approve-script", help="setujui naskah (opsional: --file naskah editan)")
    p.add_argument("job_id", type=int)
    p.add_argument("--file", default=None, help="path script.json hasil edit")
    sub.add_parser("doctor", help="cek koneksi LLM & status agent")
    p = sub.add_parser("voice-file", help="buat suara dari script.json buatan tangan (tanpa LLM)")
    p.add_argument("script_file")
    p = sub.add_parser("render-file",
                       help="buat klip animasi dari script.json buatan tangan (tanpa LLM)")
    p.add_argument("script_file")
    p.add_argument("--no-voice", action="store_true",
                   help="tanpa edge-tts: pakai durasi scene dari naskah (lip-sync perkiraan)")
    p = sub.add_parser("build-file",
                       help="video final (suara+animasi+subtitle+musik) dari naskah, tanpa LLM")
    p.add_argument("script_file")
    p = sub.add_parser("reject")
    p.add_argument("job_id", type=int)
    p.add_argument("--reason", default="")
    p = sub.add_parser("mode", help="lihat / ubah mode (semi_auto | full_auto)")
    p.add_argument("value", nargs="?", choices=["semi_auto", "full_auto"])
    p = sub.add_parser("demo", help="jalankan 1 job sampai done, gerbang disetujui otomatis")
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
            case "review":
                cmd_review(orch, args.job_id)
            case "approve-script":
                edited = None
                if args.file:
                    edited = json.loads(Path(args.file).read_text(encoding="utf-8"))
                print(f"Status: {orch.approve_script(args.job_id, edited).status.value}")
            case "doctor":
                return cmd_doctor(orch)
            case "voice-file":
                return cmd_voice_file(orch, Path(args.script_file))
            case "render-file":
                return cmd_render_file(orch, Path(args.script_file), args.no_voice)
            case "build-file":
                return cmd_build_file(orch, Path(args.script_file))
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
    except (InvalidTransition, KeyError, ValueError, OSError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
