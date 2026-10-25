"""JSON-only adapter for Hermes' native cron store. No separate scheduling model."""
import contextlib
import json
import sys
import os
from pathlib import Path


def set_update_preference(payload):
    from cron.jobs import _fire_job_lock, _jobs_lock, get_job, update_job
    from tools.bot_live_delivery import DELIVERY_DIR_NAME

    preference = payload["preference"]
    lanes = {"all": ("bot-chat", "bot-chat"), "errors": ("local", "bot-chat"), "never": ("local", "local")}
    if preference not in lanes:
        raise ValueError("Unknown routine update preference")
    job_id = payload["id"]
    with _fire_job_lock(job_id) as acquired:
        if not acquired:
            raise ValueError("Cannot lock this routine. Try again when its run finishes.")
        with _jobs_lock():
            job = get_job(job_id)
            if job is None:
                raise ValueError("Routine not found")
            marker = job.get("teammates_update_preference")
            if marker:
                prior = lanes.get(marker.get("preference"))
                if (marker.get("version") != 1 or prior is None
                        or (job.get("deliver"), job.get("failure_deliver")) != prior):
                    raise ValueError("Routine delivery changed outside the app. Its destinations were preserved.")
            elif (job.get("deliver") != "bot-chat"
                    or job.get("failure_deliver") not in (None, "", "bot-chat")
                    or job.get("workdir") != str(Path(payload["workdir"]).resolve())):
                raise ValueError("This routine has independently configured delivery. Its destinations were preserved.")
            if job.get("fire_claim") or job.get("run_claim"):
                raise ValueError("Wait for this routine's active run to finish before changing updates.")
            home = Path(os.environ["HERMES_HOME"])
            for record_path in (home / "cron" / "bot_chat_pending").glob("*.json"):
                record = json.loads(record_path.read_text())
                if record.get("job", {}).get("id") == job_id and record.get("status") in ("queued", "claimed"):
                    raise ValueError("This routine still has a pending delivery. Wait for it before changing updates.")
            # Live tickets do not retain the job id. Do not guess which queued turn is safe to ignore.
            for record_path in (home / "runtime" / DELIVERY_DIR_NAME).glob("*.json"):
                record = json.loads(record_path.read_text())
                if record.get("status") in ("queued", "claimed"):
                    raise ValueError("Bot Chat still has a pending delivery. Wait for it before changing updates.")
            deliver, failure_deliver = lanes[preference]
            marker = dict(marker or {"version": 1, "original_deliver": job.get("deliver"),
                                     "original_failure_deliver": job.get("failure_deliver")}, preference=preference)
            result = update_job(job_id, {"deliver": deliver, "failure_deliver": failure_deliver,
                                         "teammates_update_preference": marker})
            if result is None:
                raise ValueError("Routine disappeared before its delivery could be updated")
            return result

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
            result = create_job(prompt=payload["prompt"], schedule=payload["schedule"], name=payload["name"], deliver="bot-chat", workdir=payload["workdir"])
        elif action == "preference":
            result = set_update_preference(payload)
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
        # The native TUI entrypoint does not register config-owned shell hooks.
        # Use the same public registration path as the Hermes CLI and channel gateway.
        from hermes_cli.config import load_config
        from agent.shell_hooks import register_from_config
        config = load_config()
        registered = register_from_config(config, accept_hooks=False)
        expected = {hook["command"] for hook in config.get("hooks", {}).get("pre_tool_call", [])
                    if hook.get("teammates_review") is True}
        if not expected.issubset({spec.command for spec in registered}):
            raise RuntimeError("Teammates action-review hook could not be activated")
        gateway_main()
        sys.exit(0)
    try:
        main()
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}))
        sys.exit(1)
