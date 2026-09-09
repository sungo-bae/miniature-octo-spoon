from celery import Celery
from celery.schedules import crontab

from app.core.config import get_settings

settings = get_settings()

celery_app = Celery(
    "sabangnet_forecast",
    broker=settings.redis_url,
    backend=settings.redis_url,
    include=["app.ingestion.tasks", "app.forecasting.train"],
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="Asia/Seoul",
    enable_utc=True,
)

# 테넌트별 개별 주기는 ingestion_schedule 테이블에서 관리하고,
# 여기서는 "스케줄러를 깨우는" 최소 주기만 등록한다.
celery_app.conf.beat_schedule = {
    "dispatch-order-ingestion-every-15-min": {
        "task": "app.ingestion.tasks.dispatch_due_order_ingestion",
        "schedule": crontab(minute="*/15"),
    },
    "dispatch-inventory-ingestion-hourly": {
        "task": "app.ingestion.tasks.dispatch_due_inventory_ingestion",
        "schedule": crontab(minute=0),
    },
    "retrain-forecast-daily": {
        "task": "app.forecasting.train.retrain_all_tenants",
        "schedule": crontab(hour=3, minute=0),
    },
}
