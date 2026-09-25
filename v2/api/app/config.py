from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    supabase_url: str = "https://placeholder.supabase.co"
    supabase_anon_key: str = "placeholder-anon"
    supabase_service_role_key: str = "placeholder-service"
    supabase_jwt_secret: str = ""

    database_url: str = "sqlite+aiosqlite:///:memory:"

    web_origin: str = "http://localhost:5173"
    storage_bucket: str = "journal"
    signed_url_ttl_seconds: int = 900
    org_timezone: str = "Asia/Manila"
    env: str = "dev"


@lru_cache
def get_settings() -> Settings:
    return Settings()
