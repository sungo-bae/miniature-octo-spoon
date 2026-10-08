from __future__ import annotations

from datetime import date
from unittest.mock import patch

import pytest

from src.external.holiday_api import HolidayAPIError, HolidayClient


def _fake_response(items):
    return {
        "response": {
            "header": {"resultCode": "00", "resultMsg": "OK"},
            "body": {"items": {"item": items}},
        }
    }


def test_missing_service_key_raises():
    with patch.dict("os.environ", {}, clear=True):
        with pytest.raises(HolidayAPIError):
            HolidayClient()


def test_fetch_month_parses_items():
    client = HolidayClient(service_key="dummy-key")
    fake_items = [
        {
            "locdate": "20260101",
            "dateName": "신정",
            "dateKind": "01",
            "isHoliday": "Y",
        },
        {
            "locdate": "20260215",
            "dateName": "설날",
            "dateKind": "01",
            "isHoliday": "Y",
        },
    ]
    with patch("requests.get") as mock_get:
        mock_get.return_value.raise_for_status.return_value = None
        mock_get.return_value.json.return_value = _fake_response(fake_items)
        records = client.fetch_month(2026, 1)

    assert len(records) == 2
    assert records[0].locdate == date(2026, 1, 1)
    assert records[0].date_name == "신정"
    assert records[0].is_holiday is True


def test_fetch_month_handles_single_item_as_dict():
    client = HolidayClient(service_key="dummy-key")
    single_item = {
        "locdate": "20260301",
        "dateName": "삼일절",
        "dateKind": "01",
        "isHoliday": "Y",
    }
    with patch("requests.get") as mock_get:
        mock_get.return_value.raise_for_status.return_value = None
        mock_get.return_value.json.return_value = _fake_response(single_item)
        records = client.fetch_month(2026, 3)

    assert len(records) == 1
    assert records[0].date_name == "삼일절"


def test_fetch_range_filters_and_sorts():
    client = HolidayClient(service_key="dummy-key")

    def fake_fetch_month(year, month):
        if (year, month) == (2026, 1):
            return [
                _record(date(2026, 1, 1), "신정"),
                _record(date(2026, 1, 31), "말일"),
            ]
        if (year, month) == (2026, 2):
            return [_record(date(2026, 2, 15), "설날")]
        return []

    with patch.object(client, "fetch_month", side_effect=fake_fetch_month):
        records = client.fetch_range(date(2026, 1, 15), date(2026, 2, 20))

    assert [r.locdate for r in records] == [date(2026, 1, 31), date(2026, 2, 15)]


def test_api_error_response_raises():
    client = HolidayClient(service_key="dummy-key")
    with patch("requests.get") as mock_get:
        mock_get.return_value.raise_for_status.return_value = None
        mock_get.return_value.json.return_value = {
            "response": {"header": {"resultCode": "03", "resultMsg": "NODATA_ERROR"}}
        }
        with pytest.raises(HolidayAPIError):
            client.fetch_month(2026, 1)


def _record(locdate, name):
    from src.external.holiday_api import HolidayRecord

    return HolidayRecord(locdate=locdate, date_name=name, date_kind="01", is_holiday=True)
