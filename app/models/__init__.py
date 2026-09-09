# alembic autogenerate 및 Base.metadata가 모든 모델을 인식하도록 여기서 모아 임포트한다.
# 주의: app.db.base는 이 패키지를 임포트하지 않는다(순환 임포트 방지).
# 전체 스키마가 필요한 곳(alembic/env.py 등)에서 `import app.models`로 사용한다.
from app.models.tenant import Tenant  # noqa: F401
from app.models.credential import ApiCredential  # noqa: F401
from app.models.channel import Channel  # noqa: F401
from app.models.sku import Sku  # noqa: F401
from app.models.order import Order, OrderItem  # noqa: F401
from app.models.inventory import InventorySnapshot  # noqa: F401
from app.models.forecast import Forecast  # noqa: F401
from app.models.ingestion import IngestionRun, RawIngestionPayload  # noqa: F401
