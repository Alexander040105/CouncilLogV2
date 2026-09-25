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
    avatars_bucket: str = "avatars"  # public bucket — avatars render as plain <img src>
    signed_url_ttl_seconds: int = 900
    org_timezone: str = "Asia/Manila"
    env: str = "dev"

    # Transactional email (assignment notifications) — Maileroo SMTP.
    # Leave smtp_user/password empty to disable sending (dev default).
    smtp_host: str = "smtp.maileroo.com"
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    mail_from: str = ""  # verified sender, e.g. "CounciLog <no-reply@yourdomain.com>"
    app_base_url: str = "http://localhost:5173"  # used for links inside emails


@lru_cache
def get_settings() -> Settings:
    return Settings()
