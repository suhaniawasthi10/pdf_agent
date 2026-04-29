from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    groq_api_key: str = ""
    embedding_model: str = "BAAI/bge-m3"
    chroma_dir: str = "./data/chroma"
    upload_dir: str = "./data/uploads"
    answer_model: str = "llama-3.3-70b-versatile"
    top_k: int = 6
    # Comma-separated list of allowed CORS origins. Override in prod with the
    # deployed frontend URL, e.g. ALLOWED_ORIGINS=https://pdf-agent.vercel.app
    allowed_origins: str = "http://localhost:5173,http://127.0.0.1:5173"


settings = Settings()
Path(settings.chroma_dir).mkdir(parents=True, exist_ok=True)
Path(settings.upload_dir).mkdir(parents=True, exist_ok=True)
