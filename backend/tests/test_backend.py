import os
import sys
import asyncio
import unittest
from datetime import datetime

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
from backend.app.teams_client import format_message_for_teams
from backend.app.routers.shifts import get_today_str
from backend.app.main import app, MOSCOW_TZ
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

        cls.patch_tracker_status = patch("backend.app.tracker_client._apply_status_change_in_tracker", new_callable=AsyncMock)
        cls.mock_tracker_status = cls.patch_tracker_status.start()

        asyncio.run(init_db())
        cls.client = TestClient(app)
        login_resp = cls.client.post(
            "/api/auth/login",
            json={"username": "vepishin", "password": "itcodevelopment"}
        )
        assert login_resp.status_code == 200, login_resp.text
        cls.auth_token = login_resp.json()["token"]
        cls.client.headers.update({"Authorization": f"Bearer {cls.auth_token}"})

    @classmethod
    def tearDownClass(cls):
        cls.patch_send.stop()
        cls.patch_token.stop()
        cls.patch_tracker_status.stop()
        db_path = os.environ["DATABASE_PATH"]
        if os.path.exists(db_path):
            os.remove(db_path)

    def test_02_get_settings(self):
        response = self.client.get("/api/settings")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("director_chat_url", data)
        self.assertEqual(data["director_message_template"], "Здравствуйте, я на рабочем месте")

    def test_03_shift_lifecycle(self):
        # 1. Clean today's record
        today = get_today_str()
        self.client.delete(f"/api/shifts/{today}")

        # 2. Check today is not_started
        r = self.client.get("/api/shifts/today")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["status"], "not_started")
        self.assertEqual(r.json()["report_status"], "not_scheduled")

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
        self.assertIn(data["shift"]["report_status"], ["scheduled", "sent"])

        # 8. Test send-report-now
        r = self.client.post("/api/shifts/send-report-now")
        self.assertEqual(r.status_code, 200)
        data = r.json()
        self.assertTrue(data["success"])
        self.assertEqual(data["shift"]["report_status"], "sent")

        # 9. Ending again should be rejected (400)
        r = self.client.post("/api/shifts/end", json={"daily_report": "Еще раз"})
        self.assertEqual(r.status_code, 400)

        # 10. History should contain the shift
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

        # Test updating custom monthly rate
        r_sett = self.client.post("/api/settings", json={
            "director_chat_url": "",
            "director_message_template": "Тест",
            "daily_chat_url": "",
            "monthly_rate": 42000.0
        })
        self.assertEqual(r_sett.status_code, 200)

        r_custom = self.client.get("/api/shifts/salary-stats")
        self.assertEqual(r_custom.status_code, 200)
        data_custom = r_custom.json()
        self.assertEqual(data_custom["monthly_rate"], 42000.0)
        self.assertEqual(data_custom["shift_rate"], 2000.0)
        self.assertEqual(data_custom["hourly_rate"], 250.0)

        # Revert back to 35000.0
        self.client.post("/api/settings", json={
            "director_chat_url": "",
            "director_message_template": "Тест",
            "daily_chat_url": "",
            "monthly_rate": 35000.0
        })

    def test_06_start_time_rounding(self):
        from backend.app.routers.shifts import get_rounded_start_time
        now = datetime.now(MOSCOW_TZ)
        
        # 1. Early arrival before 10:00:00 -> rounds to 10:00:00
        fake_0930 = datetime(now.year, now.month, now.day, 9, 30, 15, tzinfo=MOSCOW_TZ)
        with patch("backend.app.routers.shifts.get_now_dt", return_value=fake_0930):
            self.assertEqual(get_rounded_start_time(), "10:00:00")

        # 2. Arrival exactly at 10:00:00 -> 10:00:00
        fake_1000 = datetime(now.year, now.month, now.day, 10, 0, 0, tzinfo=MOSCOW_TZ)
        with patch("backend.app.routers.shifts.get_now_dt", return_value=fake_1000):
            self.assertEqual(get_rounded_start_time(), "10:00:00")

        # 3. Arrival at 10:05:00 -> 10:05:00 (NOT 11:00:00!)
        fake_1005 = datetime(now.year, now.month, now.day, 10, 5, 0, tzinfo=MOSCOW_TZ)
        with patch("backend.app.routers.shifts.get_now_dt", return_value=fake_1005):
            self.assertEqual(get_rounded_start_time(), "10:05:00")

        # 4. Arrival at 11:20:45 -> 11:20:45
        fake_1120 = datetime(now.year, now.month, now.day, 11, 20, 45, tzinfo=MOSCOW_TZ)
        with patch("backend.app.routers.shifts.get_now_dt", return_value=fake_1120):
            self.assertEqual(get_rounded_start_time(), "11:20:45")

    def test_06_update_and_delete_shift(self):
        test_date = "2026-09-01"
        # 1. Create/update active shift (in_progress, without end_time)
        r = self.client.put(f"/api/shifts/{test_date}", json={
            "start_time": "10:00:00",
            "end_time": "",
            "status": "in_progress"
        })
        self.assertEqual(r.status_code, 200)
        data = r.json()
        self.assertTrue(data["success"])
        self.assertEqual(data["shift"]["start_time"], "10:00:00")
        self.assertIsNone(data["shift"]["end_time"])
        self.assertEqual(data["shift"]["status"], "in_progress")

        # 2. Update start_time on active shift to 10:05 - should stay in_progress!
        r = self.client.put(f"/api/shifts/{test_date}", json={
            "start_time": "10:05:00",
            "end_time": ""
        })
        self.assertEqual(r.status_code, 200)
        data = r.json()
        self.assertEqual(data["shift"]["start_time"], "10:05:00")
        self.assertIsNone(data["shift"]["end_time"])
        self.assertEqual(data["shift"]["status"], "in_progress")

        # 3. Complete shift with end_time
        r = self.client.put(f"/api/shifts/{test_date}", json={
            "start_time": "10:00:00",
            "end_time": "19:00:00",
            "daily_report": "Тест редактирования отчета",
            "report_status": "sent"
        })
        self.assertEqual(r.status_code, 200)
        data = r.json()
        self.assertTrue(data["success"])
        self.assertEqual(data["shift"]["start_time"], "10:00:00")
        self.assertEqual(data["shift"]["end_time"], "19:00:00")
        self.assertEqual(data["shift"]["daily_report"], "Тест редактирования отчета")
        self.assertEqual(data["shift"]["status"], "completed")
        self.assertEqual(data["shift"]["report_status"], "sent")

        r = self.client.delete(f"/api/shifts/{test_date}")
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.json()["success"])

    def test_07_scheduled_shift_report_logic(self):
        fake_now = datetime(2026, 9, 15, 17, 35, 0, tzinfo=MOSCOW_TZ)
        with patch("backend.app.routers.shifts.get_now_dt", return_value=fake_now):
            today = "2026-09-15"
            self.client.delete(f"/api/shifts/{today}")
            self.client.post("/api/shifts/start")

            r = self.client.post("/api/shifts/end", json={"daily_report": "Отчет в 17:35"})
            self.assertEqual(r.status_code, 200)
            data = r.json()
            self.assertTrue(data["success"])
            self.assertEqual(data["shift"]["status"], "completed")
            self.assertEqual(data["shift"]["end_time"], "18:00:00")
            self.assertEqual(data["shift"]["report_status"], "scheduled")
            self.assertEqual(data["shift"]["report_scheduled_at"], "18:00:00")
            self.assertIn("18:00", data["message"])

            r = self.client.post("/api/shifts/send-report-now")
            self.assertEqual(r.status_code, 200)
            data = r.json()
            self.assertTrue(data["success"])
            self.assertEqual(data["shift"]["report_status"], "sent")
            self.assertIsNotNone(data["shift"]["report_sent_at"])

            self.client.delete(f"/api/shifts/{today}")

        fake_1800 = datetime(2026, 9, 15, 18, 0, 0, tzinfo=MOSCOW_TZ)
        with patch("backend.app.routers.shifts.get_now_dt", return_value=fake_1800):
            today = "2026-09-15"
            self.client.post("/api/shifts/start")
            r = self.client.post("/api/shifts/end", json={"daily_report": "Отчет ровно в 18:00"})
            self.assertEqual(r.status_code, 200)
            data = r.json()
            self.assertTrue(data["success"])
            self.assertEqual(data["shift"]["status"], "completed")
            self.assertEqual(data["shift"]["report_status"], "sent")
            self.client.delete(f"/api/shifts/{today}")

    def test_08_tracker_endpoints(self):
        from backend.app.database import save_tracker_projects, save_tracker_issues

        asyncio.run(save_tracker_projects([
            {"id": "itco", "key": "ITCO", "name": "ITCO Dashboard", "color": "#3b82f6"},
            {"id": "mobile", "key": "MOB", "name": "Mobile App", "color": "#10b981"}
        ]))

        asyncio.run(save_tracker_issues([
            {
                "id": "ITCO-101",
                "key": "ITCO-101",
                "title": "Добавить трекер задач",
                "project_id": "itco",
                "project_key": "ITCO",
                "project_name": "ITCO Dashboard",
                "status": "in_progress",
                "priority": "high",
                "tracker_url": "https://tracker.itco.su/workbench/itco/tracker/ITCO-101"
            },
            {
                "id": "ITCO-102",
                "key": "ITCO-102",
                "title": "Сделать смену статусов",
                "project_id": "itco",
                "project_key": "ITCO",
                "project_name": "ITCO Dashboard",
                "status": "todo",
                "priority": "normal",
                "tracker_url": "https://tracker.itco.su/workbench/itco/tracker/ITCO-102"
            }
        ]))

        r = self.client.get("/api/tracker/status")
        self.assertEqual(r.status_code, 200)
        data = r.json()
        self.assertTrue(data["success"])
        self.assertEqual(data["workspace"], "itco")

        r = self.client.get("/api/tracker/projects")
        self.assertEqual(r.status_code, 200)
        projects = r.json()
        self.assertGreaterEqual(len(projects), 2)

        r = self.client.get("/api/tracker/issues")
        self.assertEqual(r.status_code, 200)
        issues = r.json()
        self.assertGreaterEqual(len(issues), 2)

        r = self.client.post("/api/tracker/issues/ITCO-102/status", json={"status": "in_progress"})
        self.assertEqual(r.status_code, 200)
        res = r.json()
        self.assertTrue(res["success"])
        self.assertEqual(res["issue"]["status"], "in_progress")

    def test_09_tracker_status_normalization(self):
        from backend.app.tracker_client import normalize_tracker_status
        self.assertEqual(normalize_tracker_status("К выполнению"), "todo")
        self.assertEqual(normalize_tracker_status("В работе"), "in_progress")
        self.assertEqual(normalize_tracker_status("Готово к тестированию"), "ready_for_testing")
        self.assertEqual(normalize_tracker_status("Тестирование"), "testing")
        self.assertEqual(normalize_tracker_status("Ревью"), "review")
        self.assertEqual(normalize_tracker_status("Готово к мержу"), "ready_to_merge")
        self.assertEqual(normalize_tracker_status("Ready for production"), "ready_for_production")
        self.assertEqual(normalize_tracker_status("Done"), "ready_for_production")

if __name__ == "__main__":
    unittest.main()
