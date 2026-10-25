import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest


class RoutineNativeTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory(prefix="teammates-native-routines-")
        cls.home = Path(cls.temporary.name).resolve()
        (cls.home / "workspace").mkdir()
        os.environ["HERMES_HOME"] = str(cls.home)
        os.environ["HERMES_DISABLE_LAZY_INSTALLS"] = "1"
        spec = importlib.util.spec_from_file_location("teammates_bridge", Path(__file__).parents[1] / "server/hermes_bridge.py")
        cls.bridge = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.bridge)
        from cron import jobs
        from cron.scheduler_delivery import _resolve_delivery_targets
        cls.jobs = jobs
        cls.resolve = staticmethod(_resolve_delivery_targets)

    @classmethod
    def tearDownClass(cls):
        cls.temporary.cleanup()

    def create(self, **kwargs):
        return self.jobs.create_job(prompt="Fixture only. Never run.", schedule="every 1h", name="Fixture",
                                    deliver=kwargs.get("deliver", "bot-chat"), workdir=str(self.home / "workspace"),
                                    failure_deliver=kwargs.get("failure_deliver"))

    def choose(self, job, preference):
        return self.bridge.set_update_preference(dict(id=job["id"], preference=preference, workdir=str(self.home / "workspace")))

    def test_real_delivery_routes_and_schedule_preserved(self):
        job = self.create()
        preserved = {key: job.get(key) for key in ("prompt", "schedule", "next_run_at", "enabled", "state", "repeat")}
        for preference, result_targets, failure_targets in [("errors", 0, 1), ("never", 0, 0), ("all", 1, 1)]:
            updated = self.choose(job, preference)
            self.assertEqual(len(self.resolve(updated)), result_targets)
            self.assertEqual(len(self.resolve(updated, for_failure=True)), failure_targets)
            self.assertEqual({key: updated.get(key) for key in preserved}, preserved)
            reread = self.jobs.get_job(job["id"])
            self.assertEqual(reread["teammates_update_preference"]["preference"], preference)
            self.assertEqual(reread["teammates_update_preference"]["original_deliver"], "bot-chat")
        self.assertEqual(self.choose(job, "all")["teammates_update_preference"]["preference"], "all")

    def test_independent_delivery_and_active_claims_are_preserved(self):
        for kwargs in [dict(deliver="local"), dict(failure_deliver="telegram:123"), dict(deliver="bot-chat,telegram:123")]:
            job = self.create(**kwargs)
            with self.assertRaisesRegex(ValueError, "independently configured"):
                self.choose(job, "never")
            self.assertEqual(self.jobs.get_job(job["id"])["deliver"], job["deliver"])
        job = self.create()
        self.jobs.update_job(job["id"], {"fire_claim": {"by": "fixture", "at": "2099-01-01T00:00:00+00:00"}})
        with self.assertRaisesRegex(ValueError, "active run"):
            self.choose(job, "never")
        self.assertEqual(self.jobs.get_job(job["id"])["deliver"], "bot-chat")
        self.jobs.update_job(job["id"], {"fire_claim": None})
        self.choose(job, "never")
        self.jobs.update_job(job["id"], {"deliver": "telegram:123"})
        with self.assertRaisesRegex(ValueError, "changed outside"):
            self.choose(job, "all")
        self.assertEqual(self.jobs.get_job(job["id"])["deliver"], "telegram:123")

    def test_pending_deliveries_block_a_false_silence_claim(self):
        job = self.create()
        pending = self.home / "cron" / "bot_chat_pending" / "fixture.json"
        pending.parent.mkdir(parents=True, exist_ok=True)
        pending.write_text(json.dumps({"job": {"id": job["id"]}, "status": "queued"}))
        try:
            with self.assertRaisesRegex(ValueError, "pending delivery"):
                self.choose(job, "never")
        finally:
            pending.unlink()
        live = self.home / "runtime" / "bot_live_delivery" / "fixture.json"
        live.parent.mkdir(parents=True, exist_ok=True)
        live.write_text(json.dumps({"status": "claimed"}))
        try:
            with self.assertRaisesRegex(ValueError, "pending delivery"):
                self.choose(job, "never")
        finally:
            live.unlink()
        self.assertEqual(self.choose(job, "never")["deliver"], "local")


if __name__ == "__main__":
    unittest.main()
