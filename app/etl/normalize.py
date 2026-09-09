"""정규화된(NormalizedOrder/NormalizedInventoryRecord) 데이터를 내부 테이블에
멱등하게(upsert) 적재하는 로직. 같은 주문/재고 스냅샷이 재수집되어도 중복이
쌓이지 않도록 unique key 기준으로 INSERT ... ON CONFLICT를 사용한다.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.integrations.sabangnet.mapper import NormalizedInventoryRecord, NormalizedOrder
from app.models.channel import Channel
from app.models.inventory import InventorySnapshot
from app.models.order import Order, OrderItem, OrderStatus
from app.models.sku import Sku

# 사방넷 status 문자열 -> 내부 OrderStatus. TODO: 실제 사방넷 상태값으로 매핑 보강.
_STATUS_MAP = {
    "paid": OrderStatus.PAID,
    "ready_to_ship": OrderStatus.READY_TO_SHIP,
    "shipped": OrderStatus.SHIPPED,
    "cancelled": OrderStatus.CANCELLED,
    "returned": OrderStatus.RETURNED,
}


def _get_or_create_channel(db: Session, tenant_id: uuid.UUID, channel_code: str) -> Channel:
    channel = (
        db.query(Channel)
        .filter(Channel.tenant_id == tenant_id, Channel.external_channel_code == channel_code)
        .first()
    )
    if channel is None:
        channel = Channel(tenant_id=tenant_id, external_channel_code=channel_code, name=channel_code)
        db.add(channel)
        db.flush()
    return channel


def _get_or_create_sku(db: Session, tenant_id: uuid.UUID, sku_code: str) -> Sku:
    sku = db.query(Sku).filter(Sku.tenant_id == tenant_id, Sku.external_sku_code == sku_code).first()
    if sku is None:
        sku = Sku(tenant_id=tenant_id, external_sku_code=sku_code, name=sku_code)
        db.add(sku)
        db.flush()
    return sku


def upsert_order(db: Session, tenant_id: uuid.UUID, order: NormalizedOrder) -> None:
    channel = _get_or_create_channel(db, tenant_id, order.channel_code)

    stmt = (
        insert(Order)
        .values(
            tenant_id=tenant_id,
            channel_id=channel.id,
            external_order_no=order.external_order_no,
            status=_STATUS_MAP.get(order.status, OrderStatus.PAID),
            ordered_at=order.ordered_at,
        )
        .on_conflict_do_update(
            index_elements=[Order.tenant_id, Order.external_order_no],
            set_={"status": _STATUS_MAP.get(order.status, OrderStatus.PAID)},
        )
        .returning(Order.id)
    )
    order_id = db.execute(stmt).scalar_one()

    for item in order.items:
        sku = _get_or_create_sku(db, tenant_id, item.sku_code)
        db.add(
            OrderItem(
                tenant_id=tenant_id,
                order_id=order_id,
                sku_id=sku.id,
                quantity=item.quantity,
                unit_price=item.unit_price,
            )
        )


def upsert_inventory_snapshot(
    db: Session, tenant_id: uuid.UUID, record: NormalizedInventoryRecord
) -> None:
    sku = _get_or_create_sku(db, tenant_id, record.sku_code)

    stmt = (
        insert(InventorySnapshot)
        .values(
            tenant_id=tenant_id,
            sku_id=sku.id,
            on_hand_qty=record.on_hand_qty,
            safety_stock_qty=record.safety_stock_qty,
            snapshot_at=record.snapshot_at,
        )
        .on_conflict_do_nothing(
            index_elements=[
                InventorySnapshot.tenant_id,
                InventorySnapshot.sku_id,
                InventorySnapshot.snapshot_at,
            ]
        )
    )
    db.execute(stmt)
