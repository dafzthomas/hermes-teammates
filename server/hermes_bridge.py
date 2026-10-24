"""JSON-only adapter for Hermes' native cron store. No separate scheduling model."""
import contextlib
import json
import sys
import os

source = os.environ.get("HERMES_SOURCE")
if source:
    sys.path.insert(0, source)
    import hermes_bootstrap  # Select installed dependencies without installing anything.


def main():
    payload = json.load(sys.stdin)
    if payload["action"] == "runtime":
        from pathlib import Path
        from pm.environments import committed_venv, venv_python
        environment = committed_venv(Path(source))
        print(json.dumps({"ok": True, "result": str(venv_python(environment)) if environment else sys.executable}))
        return
    # Hermes imports may print diagnostics. Keep the protocol on stdout parseable.
    with contextlib.redirect_stdout(sys.stderr):
        from cron.jobs import create_job, list_jobs, pause_job, resume_job, remove_job
        action = payload["action"]
        if action == "list":
            result = list_jobs(include_disabled=True)
        elif action == "create":
            result = create_job(prompt=payload["prompt"], schedule=payload["schedule"], name=payload["name"], deliver="local", workdir=payload["workdir"])
        elif action == "pause":
            result = pause_job(payload["id"])
        elif action == "resume":
            result = resume_job(payload["id"])
        elif action == "remove":
            result = remove_job(payload["id"])
        else:
            raise ValueError("Unknown cron action")
    print(json.dumps({"ok": True, "result": result}, default=str))


if __name__ == "__main__":
    if "--gateway" in sys.argv:
        # Hermes owns session state, tool execution, requests and turn lifecycle.
        from tui_gateway.entry import main as gateway_main
        gateway_main()
        sys.exit(0)
    try:
        main()
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}))
        sys.exit(1)
