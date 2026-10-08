from __future__ import annotations

from datetime import date, datetime
from unittest.mock import patch

import pytest

from src.external.weather_api import WeatherAPIError, WeatherClient, _latest_base_datetime


def _fake_items():
    return [
        {"fcstDate": "20260110", "category": "TMP", "fcstValue": "3"},
        {"fcstDate": "20260110", "category": "TMX", "fcstValue": "5"},
        {"fcstDate": "20260110", "category": "TMN", "fcstValue": "-2"},
        {"fcstDate": "20260110", "category": "POP", "fcstValue": "30"},
        {"fcstDate": "20260110", "category": "PCP", "fcstValue": "강수없음"},
        {"fcstDate": "20260111", "category": "TMX", "fcstValue": "7"},
        {"fcstDate": "20260111", "category": "TMN", "fcstValue": "0"},
        {"fcstDate": "20260111", "category": "POP", "fcstValue": "80"},
        {"fcstDate": "20260111", "category": "PCP", "fcstValue": "5"},
    ]


def _fake_response(items):
    return {
        "response": {
            "header": {"resultCode": "00", "resultMsg": "OK"},
            "body": {"items": {"item": items}},
        }
    }


def test_missing_service_key_raises():
    with patch.dict("os.environ", {}, clear=True):
        with pytest.raises(WeatherAPIError):
            WeatherClient()


def test_fetch_daily_features_summarizes_by_date():
    client = WeatherClient(service_key="dummy-key")
    with patch("requests.get") as mock_get:
        mock_get.return_value.raise_for_status.return_value = None
        mock_get.return_value.json.return_value = _fake_response(_fake_items())
        features = client.fetch_daily_features(reference=datetime(2026, 1, 10, 6, 0))

    by_date = {f.fcst_date: f for f in features}
    assert by_date[date(2026, 1, 10)].tmp_max == 5.0
    assert by_date[date(2026, 1, 10)].tmp_min == -2.0
    assert by_date[date(2026, 1, 10)].pop_max == 30.0
    assert by_date[date(2026, 1, 10)].precip_expected is False

    assert by_date[date(2026, 1, 11)].tmp_max == 7.0
    assert by_date[date(2026, 1, 11)].precip_expected is True


def test_api_error_response_raises():
    client = WeatherClient(service_key="dummy-key")
    with patch("requests.get") as mock_get:
        mock_get.return_value.raise_for_status.return_value = None
        mock_get.return_value.json.return_value = {
            "response": {"header": {"resultCode": "03", "resultMsg": "NODATA_ERROR"}}
        }
        with pytest.raises(WeatherAPIError):
            client.fetch_daily_features(reference=datetime(2026, 1, 10, 6, 0))


@pytest.mark.parametrize(
    "now, expected_date, expected_time",
    [
        (datetime(2026, 1, 10, 6, 0), "20260110", "0500"),
        (datetime(2026, 1, 10, 0, 5), "20260109", "2300"),
        # 23:05은 10분 반영지연 버퍼를 적용하면 22:55 시점 -> 23시 발표분은
        # 아직 반영 전이므로 직전 발표분인 20시가 선택되어야 한다.
        (datetime(2026, 1, 10, 23, 5), "20260110", "2000"),
        (datetime(2026, 1, 10, 23, 15), "20260110", "2300"),
    ],
)
def test_latest_base_datetime(now, expected_date, expected_time):
    base_date, base_time = _latest_base_datetime(now)
    assert base_date == expected_date
    assert base_time == expected_time
