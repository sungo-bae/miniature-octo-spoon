from __future__ import annotations

from datetime import date
from unittest.mock import patch

import pytest

from src.external.kamis_api import KamisAPIError, KamisClient


def _fake_response(items, total_count=None, result_code="00"):
    if total_count is None:
        total_count = len(items) if isinstance(items, list) else 1
    return {
        "response": {
            "header": {"resultCode": result_code, "resultMsg": "OK"},
            "body": {
                "numOfRows": 1000,
                "pageNo": 1,
                "totalCount": total_count,
                "dataType": "JSON",
                "items": {"item": items},
            },
        }
    }


def _raw_item(**overrides):
    base = {
        "exmn_ymd": "20260101",
        "se_cd": "01",
        "se_nm": "소매",
        "ctgry_cd": "200",
        "ctgry_nm": "채소류",
        "item_cd": "211",
        "item_nm": "배추",
        "unit": "10키로",
        "unit_sz": "10",
        "mrkt_nm": "서울",
        "exmn_dd_prc": "8,500",
        "exmn_dd_cnvs_prc": "850",
    }
    base.update(overrides)
    return base


def test_missing_service_key_raises():
    with patch.dict("os.environ", {}, clear=True):
        with pytest.raises(KamisAPIError):
            KamisClient()


def test_fetch_period_prices_parses_items():
    client = KamisClient(service_key="dummy-key")
    fake_items = [
        _raw_item(exmn_ymd="20260101", exmn_dd_prc="8,500", exmn_dd_cnvs_prc="850"),
        _raw_item(exmn_ymd="20260102", exmn_dd_prc="9,000", exmn_dd_cnvs_prc="900"),
    ]
    with patch("requests.get") as mock_get:
        mock_get.return_value.raise_for_status.return_value = None
        mock_get.return_value.json.return_value = _fake_response(fake_items)
        records = client.fetch_period_prices(
            item_code="211", category_code="200", start=date(2026, 1, 1), end=date(2026, 1, 2)
        )

    assert len(records) == 2
    assert records[0].exmn_ymd == date(2026, 1, 1)
    assert records[0].item_name == "배추"
    assert records[0].price == pytest.approx(8500.0)
    assert records[0].price_per_kg == pytest.approx(850.0)


def test_fetch_period_prices_handles_single_item_as_dict():
    client = KamisClient(service_key="dummy-key")
    single_item = _raw_item(item_nm="양파", item_cd="212")
    with patch("requests.get") as mock_get:
        mock_get.return_value.raise_for_status.return_value = None
        mock_get.return_value.json.return_value = _fake_response(single_item, total_count=1)
        records = client.fetch_period_prices(
            item_code="212", category_code="200", start=date(2026, 1, 1), end=date(2026, 1, 1)
        )

    assert len(records) == 1
    assert records[0].item_name == "양파"


def test_fetch_period_prices_handles_missing_price_as_zero():
    client = KamisClient(service_key="dummy-key")
    fake_items = [_raw_item(exmn_dd_prc="-", exmn_dd_cnvs_prc="-")]
    with patch("requests.get") as mock_get:
        mock_get.return_value.raise_for_status.return_value = None
        mock_get.return_value.json.return_value = _fake_response(fake_items)
        records = client.fetch_period_prices(
            item_code="211", category_code="200", start=date(2026, 1, 1), end=date(2026, 1, 1)
        )

    assert records[0].price == 0.0
    assert records[0].price_per_kg == 0.0


def test_fetch_period_prices_paginates_across_multiple_pages():
    client = KamisClient(service_key="dummy-key")
    page1 = _fake_response([_raw_item(exmn_ymd="20260101")], total_count=2)
    page2 = _fake_response([_raw_item(exmn_ymd="20260102")], total_count=2)

    with patch("requests.get") as mock_get:
        mock_get.return_value.raise_for_status.return_value = None
        mock_get.return_value.json.side_effect = [page1, page2]
        records = client.fetch_period_prices(
            item_code="211", category_code="200", start=date(2026, 1, 1), end=date(2026, 1, 2)
        )

    assert len(records) == 2
    assert mock_get.call_count == 2


def test_api_error_response_raises():
    client = KamisClient(service_key="dummy-key")
    with patch("requests.get") as mock_get:
        mock_get.return_value.raise_for_status.return_value = None
        mock_get.return_value.json.return_value = _fake_response([], result_code="30")
        with pytest.raises(KamisAPIError):
            client.fetch_period_prices(
                item_code="211", category_code="200", start=date(2026, 1, 1), end=date(2026, 1, 1)
            )
