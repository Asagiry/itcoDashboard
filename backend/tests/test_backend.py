import os
import sys
import asyncio
import unittest

libs_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "libs"))
if libs_dir not in sys.path:
    sys.path.insert(0, libs_dir)

# Use test database
os.environ["DATABASE_PATH"] = os.path.join(os.path.dirname(__file__), "test_dashboard.db")

from backend.app.database import (
    init_db,
    get_all_settings,
    save_settings,
    get_shift_by_date,
    create_or_update_shift,
    delete_shift_by_date
)
from backend.app.curl_parser import parse_curl_command
from backend.app.teams_client import format_message_for_teams
from backend.app.main import app
from starlette.testclient import TestClient
from unittest.mock import patch, AsyncMock

class BackendTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.patch_send = patch("backend.app.main.send_teams_message", new_callable=AsyncMock)
        cls.mock_send = cls.patch_send.start()
        cls.mock_send.return_value = (True, 201, '{"status": "ok"}')

        cls.patch_token = patch("backend.app.main.ensure_active_token", new_callable=AsyncMock)
        cls.mock_token = cls.patch_token.start()
        cls.mock_token.return_value = ("Authentication", "mock_token_123")

        asyncio.run(init_db())
        cls.client = TestClient(app)

    @classmethod
    def tearDownClass(cls):
        cls.patch_send.stop()
        cls.patch_token.stop()
        db_path = os.environ["DATABASE_PATH"]
        if os.path.exists(db_path):
            os.remove(db_path)

    def test_01_curl_parser(self):
        sample_curl = (
            "curl 'https://teams.live.com/api/chatsvc/consumer/v1/users/ME/conversations/19%3Auni01_test%40thread.v2/messages' "
            "-H 'User-Agent: Mozilla/5.0' "
            "-H 'Authorization: Bearer my_secret_token_123' "
            "-H 'Content-Type: application/json' "
            "--data-raw '{\"content\":\"hi\"}'"
        )
        success, url, auth_header, auth_token, headers, err = parse_curl_command(sample_curl)
        self.assertTrue(success)
        self.assertIn("19%3Auni01_test", url)
        self.assertEqual(auth_header, "Authorization")
        self.assertEqual(auth_token, "Bearer my_secret_token_123")
        self.assertEqual(headers.get("User-Agent"), "Mozilla/5.0")

    def test_02_get_settings(self):
        response = self.client.get("/api/settings")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("teams.live.com", data["director_chat_url"])
        self.assertEqual(data["director_message_template"], "Здравствуйте, я на рабочем месте")

    def test_03_shift_lifecycle(self):
        # 1. Reset today
        r = self.client.post("/api/shifts/reset-today")
        self.assertEqual(r.status_code, 200)

        # 2. Check today is not_started
        r = self.client.get("/api/shifts/today")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["status"], "not_started")

        # 3. Start shift
        r = self.client.post("/api/shifts/start")
        self.assertEqual(r.status_code, 200)
        data = r.json()
        self.assertTrue(data["success"])
        self.assertEqual(data["shift"]["status"], "in_progress")
        self.assertIsNotNone(data["shift"]["start_time"])

        # 4. Starting again should be rejected (400)
        r = self.client.post("/api/shifts/start")
        self.assertEqual(r.status_code, 400)

        # 5. Save draft
        r = self.client.post("/api/shifts/draft", json={"daily_report": "Тестовые задачи за день"})
        self.assertEqual(r.status_code, 200)

        # 6. End shift without report fails
        r = self.client.post("/api/shifts/end", json={"daily_report": "   "})
        self.assertEqual(r.status_code, 400)

        # 7. End shift successfully
        r = self.client.post("/api/shifts/end", json={"daily_report": "1. Сделал проект\n2. Проверил тесты"})
        self.assertEqual(r.status_code, 200)
        data = r.json()
        self.assertTrue(data["success"])
        self.assertEqual(data["shift"]["status"], "completed")
        self.assertIsNotNone(data["shift"]["end_time"])
        self.assertEqual(data["shift"]["daily_report"], "1. Сделал проект\n2. Проверил тесты")

        # 8. Ending again should be rejected (400)
        r = self.client.post("/api/shifts/end", json={"daily_report": "Еще раз"})
        self.assertEqual(r.status_code, 400)

        # 9. History should contain the shift
        r = self.client.get("/api/shifts/history")
        self.assertEqual(r.status_code, 200)
        history = r.json()
        self.assertGreaterEqual(len(history), 1)

    def test_04_format_message_for_teams(self):
        text = "Header\n\nTask 1\nTask 2\n   - subtask"
        html_out = format_message_for_teams(text)
        self.assertIn("<p>Header</p>", html_out)
        self.assertIn("<p>Task 1<br/>Task 2<br/>&nbsp;&nbsp;&nbsp;- subtask</p>", html_out)

    def test_05_salary_stats(self):
        r = self.client.get("/api/shifts/salary-stats")
        self.assertEqual(r.status_code, 200)
        data = r.json()
        self.assertEqual(data["monthly_rate"], 35000.0)
        self.assertEqual(data["shift_rate"], 1667.0)
        self.assertIn("completed_earned_total", data)
        self.assertIn("total_month_earned_live", data)

if __name__ == "__main__":
    unittest.main()
