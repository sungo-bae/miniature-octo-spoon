from fastapi import FastAPI

from app.api.v1.forecasts import router as forecasts_router
from app.api.v1.tenants import router as tenants_router

app = FastAPI(title="사방넷 연동 판매예측 API")

app.include_router(tenants_router, prefix="/api/v1")
app.include_router(forecasts_router, prefix="/api/v1")


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok"}
