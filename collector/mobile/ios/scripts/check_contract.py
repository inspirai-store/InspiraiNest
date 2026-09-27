"""Portable checks, not a Swift compiler or iOS runtime substitute.

Reads the real Swift SQL statements and exercises them in independent OS processes.
Reads backend source only; never starts a service or changes backend state.
All temporary data is created under this iOS project and cleaned up afterwards.
"""
from pathlib import Path
import json
import multiprocessing as mp
import plistlib
import re
import sqlite3
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SWIFT = (ROOT / "Shared/Outbox.swift").read_text(encoding="utf-8")
SQL = re.findall(r'(?:execute|statement)\(db, "([^"\n]+)"', SWIFT)


def sql(prefix):
    matches = [s for s in SQL if s.startswith(prefix)]
    assert len(matches) == 1, (prefix, matches)
    return matches[0]


def connect(path):
    db = sqlite3.connect(path, timeout=3, isolation_level=None)
    db.execute("PRAGMA synchronous=FULL")
    return db


def claim_process(path, start, result, lease):
    with connect(path) as db:
        start.wait(10)
        db.execute("BEGIN IMMEDIATE")
        changed = db.execute(sql("UPDATE outbox SET lease_id="), (lease, 1090, "item", "https://example.com", 1000)).rowcount
        db.execute("COMMIT")
        result.put(changed)


def interrupted_transaction(path):
    import os
    db = connect(path)
    db.execute("BEGIN IMMEDIATE")
    db.execute(sql("INSERT INTO outbox"), ("never-committed", b"{}", None))
    os._exit(0)  # Intentional process death before COMMIT, not a graceful close.


class OutboxSQLTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix=".contract-", dir=ROOT)
        self.path = str(Path(self.temp.name) / "outbox.sqlite")
        self.db = connect(self.path)
        self.db.execute(sql("PRAGMA journal_mode"))
        self.db.execute(sql("CREATE TABLE IF NOT EXISTS outbox"))
        self.body = json.dumps({"originalParts": ["  标题\n", "text\nhttps://example.com?a=1&a=2", "same", "same"], "additionalRequirements": "  append\n"}, ensure_ascii=False).encode()
        self.db.execute(sql("INSERT INTO outbox"), ("item", self.body, "https://example.com"))

    def tearDown(self):
        self.db.close()
        self.temp.cleanup()

    def test_two_processes_cannot_claim_same_item(self):
        ctx = mp.get_context("spawn")
        event, queue = ctx.Event(), ctx.Queue()
        processes = [ctx.Process(target=claim_process, args=(self.path, event, queue, str(i))) for i in range(2)]
        for process in processes:
            process.start()
        event.set()
        changes = [queue.get(timeout=15) for _ in processes]
        for process in processes:
            process.join(15)
            self.assertEqual(process.exitcode, 0)
        queue.close()
        self.assertEqual(sorted(changes), [0, 1])
        self.assertEqual(self.db.execute("SELECT body,attempts FROM outbox").fetchone(), (self.body, 1))

    def test_expired_lease_and_stale_writer_cannot_undo_ack(self):
        claim = sql("UPDATE outbox SET lease_id=")
        finish = sql("UPDATE outbox SET state=")
        self.assertEqual(self.db.execute(claim, ("old", 1090, "item", "https://example.com", 1000)).rowcount, 1)
        self.assertEqual(self.db.execute(claim, ("new", 1181, "item", "https://example.com", 1091)).rowcount, 1)
        self.assertEqual(self.db.execute(finish, ("queued", None, "stale", "item", "old")).rowcount, 0)
        self.assertEqual(self.db.execute(finish, ("submitted", "task", None, "item", "new")).rowcount, 1)
        self.assertEqual(self.db.execute(claim, ("again", 2000, "item", "https://example.com", 1900)).rowcount, 0)
        self.assertEqual(self.db.execute("SELECT body,state,task_id FROM outbox").fetchone(), (self.body, "submitted", "task"))

    def test_crashed_transaction_rolls_back_without_losing_other_rows(self):
        process = mp.get_context("spawn").Process(target=interrupted_transaction, args=(self.path,))
        process.start(); process.join(15)
        self.assertEqual(process.exitcode, 0)
        self.assertEqual(self.db.execute("SELECT id,body FROM outbox").fetchall(), [("item", self.body)])
        self.assertEqual(self.db.execute("PRAGMA integrity_check").fetchone(), ("ok",))

    def test_bind_only_once_and_no_cross_server_claim(self):
        self.db.execute(sql("INSERT INTO outbox"), ("unbound", self.body, None))
        bind = sql("UPDATE outbox SET origin=")
        self.assertEqual(self.db.execute(bind, ("https://first.example", "unbound")).rowcount, 1)
        self.assertEqual(self.db.execute(bind, ("https://second.example", "unbound")).rowcount, 0)
        self.assertEqual(self.db.execute(sql("UPDATE outbox SET lease_id="), ("wrong", 1090, "item", "https://wrong.example", 1000)).rowcount, 0)


class ConfigurationTests(unittest.TestCase):
    def test_real_share_extension_and_matching_entitlements(self):
        with (ROOT / "Config/Share-Info.plist").open("rb") as file:
            share = plistlib.load(file)
        with (ROOT / "Config/App-Info.plist").open("rb") as file:
            app = plistlib.load(file)
        with (ROOT / "Config/Shared.entitlements").open("rb") as file:
            entitlements = plistlib.load(file)
        self.assertEqual(share["NSExtension"]["NSExtensionPointIdentifier"], "com.apple.share-services")
        self.assertIn("ShareViewController", share["NSExtension"]["NSExtensionPrincipalClass"])
        for key in ["CollectorAppGroup", "CollectorKeychainGroup"]:
            self.assertEqual(app[key], share[key])
        self.assertEqual(entitlements["keychain-access-groups"], [app["CollectorKeychainGroup"]])
        for info in [share, app]:
            self.assertFalse(info["NSAppTransportSecurity"]["NSAllowsArbitraryLoads"])

    def test_backend_contract_still_matches_client_assumptions(self):
        server = (ROOT.parents[1] / "src/server.mjs").read_text(encoding="utf-8")
        for contract in ["text(input.key, 'pairing key', 200)", "text(input.name, 'device name', 100)", "text(input.content, 'collection content', 10000)", "input.autoArchive ?? true", "t.submissionId === submissionId", "Path=/library/; HttpOnly; Secure; SameSite=Strict", "awaiting_review"]:
            self.assertIn(contract, server)
        client = (ROOT / "Shared/CollectorAPI.swift").read_text(encoding="utf-8")
        self.assertIn('["key": key, "name": name]', client)
        self.assertIn("completionHandler(nil)", client)
        self.assertIn('task.submissionId == submission.submissionId', client)

    def test_credential_and_extension_guardrails(self):
        sources = "\n".join(file.read_text(encoding="utf-8") for folder in ["App", "Shared", "ShareExtension"] for file in (ROOT / folder).glob("*.swift"))
        self.assertNotIn("UserDefaults(", sources)
        self.assertNotIn("UIApplication.shared", sources)
        self.assertNotIn("print(", sources)
        reader = (ROOT / "App/LibraryReaderView.swift").read_text(encoding="utf-8")
        self.assertIn(".nonPersistent()", reader)
        self.assertIn("httpCookieStore.setCookie(cookie)", reader)
        self.assertNotIn('forHTTPHeaderField: "Authorization"', reader)
        bootstrap = (ROOT.parents[1] / "public/library-bootstrap.js").read_text(encoding="utf-8")
        self.assertIn("window.LIBRARY_DELETE", bootstrap)
        self.assertIn("open-trash", bootstrap)
        self.assertIn("Object.defineProperty(window, 'LIBRARY_DELETE'", reader)
        self.assertIn("getElementById('open-trash')", reader)


if __name__ == "__main__":
    unittest.main(verbosity=2)
