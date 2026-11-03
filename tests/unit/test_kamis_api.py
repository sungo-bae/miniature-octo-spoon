from __future__ import annotations

from datetime import date
from unittest.mock import patch

import pytest

from src.external.kamis_api import KamisAPIError, KamisClient


def _fake_response(items, error_code="000"):
    return {"data": {"error_code": error_code, "item": items}}


def test_missing_credentials_raises():
    with patch.dict("os.environ", {}, clear=True):
        with pytest.raises(KamisAPIError):
            KamisClient()


def test_fetch_period_prices_parses_items():
    client = KamisClient(cert_key="dummy-key", cert_id="dummy-id")
    fake_items = [
        {"regday": "2026-01-01", "item_name": "배추", "item_code": "245", "unit": "10키로", "price": "8,500"},
        {"regday": "2026-01-02", "item_name": "배추", "item_code": "245", "unit": "10키로", "price": "9,000"},
    ]
    with patch("requests.get") as mock_get:
        mock_get.return_value.raise_for_status.return_value = None
        mock_get.return_value.json.return_value = _fake_response(fake_items)
        records = client.fetch_period_prices(
            item_code="245",
            item_category_code="200",
            start=date(2026, 1, 1),
            end=date(2026, 1, 2),
        )

    assert len(records) == 2
    assert records[0].regday == date(2026, 1, 1)
    assert records[0].item_name == "배추"
    assert records[0].price == pytest.approx(8500.0)
    assert records[1].price == pytest.approx(9000.0)


def test_fetch_period_prices_handles_single_item_as_dict():
    client = KamisClient(cert_key="dummy-key", cert_id="dummy-id")
    single_item = {"regday": "2026-03-01", "item_name": "양파", "item_code": "246", "unit": "1키로", "price": "1,200"}
    with patch("requests.get") as mock_get:
        mock_get.return_value.raise_for_status.return_value = None
        mock_get.return_value.json.return_value = _fake_response(single_item)
        records = client.fetch_period_prices(
            item_code="246", item_category_code="200", start=date(2026, 3, 1), end=date(2026, 3, 1)
        )

    assert len(records) == 1
    assert records[0].item_name == "양파"


def test_fetch_period_prices_handles_missing_price_as_zero():
    client = KamisClient(cert_key="dummy-key", cert_id="dummy-id")
    fake_items = [{"regday": "2026-01-01", "item_name": "배추", "item_code": "245", "unit": "10키로", "price": "-"}]
    with patch("requests.get") as mock_get:
        mock_get.return_value.raise_for_status.return_value = None
        mock_get.return_value.json.return_value = _fake_response(fake_items)
        records = client.fetch_period_prices(
            item_code="245", item_category_code="200", start=date(2026, 1, 1), end=date(2026, 1, 1)
        )

    assert records[0].price == 0.0


def test_api_error_response_raises():
    client = KamisClient(cert_key="dummy-key", cert_id="dummy-id")
    with patch("requests.get") as mock_get:
        mock_get.return_value.raise_for_status.return_value = None
        mock_get.return_value.json.return_value = _fake_response([], error_code="200")
        with pytest.raises(KamisAPIError):
            client.fetch_period_prices(
                item_code="245", item_category_code="200", start=date(2026, 1, 1), end=date(2026, 1, 1)
            )
