"""사방넷 원본 응답(raw payload) -> 내부 스키마 변환.

client.py의 실제 응답 필드명이 확정되지 않았으므로, 이 모듈이 사방넷 스펙
변경의 영향을 흡수하는 유일한 지점이 되도록 한다. ingestion/etl 쪽 코드는
아래 반환 dataclass만 알면 되고 사방넷 원본 필드명을 몰라도 된다.

TODO: 실제 API 문서 확보 후 raw dict의 키 이름을 실제 값으로 교체.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal


@dataclass(frozen=True)
class NormalizedOrderItem:
    sku_code: str
    quantity: int
    unit_price: Decimal


@dataclass(frozen=True)
class NormalizedOrder:
    external_order_no: str
    channel_code: str
    status: str
    ordered_at: datetime
    items: list[NormalizedOrderItem]


@dataclass(frozen=True)
class NormalizedInventoryRecord:
    sku_code: str
    on_hand_qty: int
    safety_stock_qty: int
    snapshot_at: datetime


def map_order(raw: dict) -> NormalizedOrder:
    # TODO: 아래 키 이름은 추정치. 실제 응답 예시를 받으면 즉시 교체.
    return NormalizedOrder(
        external_order_no=str(raw["order_no"]),
        channel_code=str(raw["channel_code"]),
        status=str(raw["status"]),
        ordered_at=datetime.fromisoformat(raw["ordered_at"]),
        items=[
            NormalizedOrderItem(
                sku_code=str(item["sku_code"]),
                quantity=int(item["quantity"]),
                unit_price=Decimal(str(item["unit_price"])),
            )
            for item in raw.get("items", [])
        ],
    )


def map_inventory_record(raw: dict) -> NormalizedInventoryRecord:
    # TODO: 아래 키 이름은 추정치. 실제 응답 예시를 받으면 즉시 교체.
    return NormalizedInventoryRecord(
        sku_code=str(raw["sku_code"]),
        on_hand_qty=int(raw["on_hand_qty"]),
        safety_stock_qty=int(raw.get("safety_stock_qty", 0)),
        snapshot_at=datetime.fromisoformat(raw["snapshot_at"]),
    )
