from functools import lru_cache

import chromadb
from chromadb.utils import embedding_functions

from app.config import settings


@lru_cache(maxsize=1)
def get_collection():
    """Singleton Chroma collection wired with bge-m3 at creation time.

    The embedding_function MUST be passed here (not just at query time) —
    otherwise Chroma silently uses its default MiniLM and retrieval breaks.
    """
    client = chromadb.PersistentClient(path=settings.chroma_dir)
    embedder = embedding_functions.SentenceTransformerEmbeddingFunction(
        model_name=settings.embedding_model
    )
    return client.get_or_create_collection(
        name="pdf_chunks",
        embedding_function=embedder,
        metadata={"hnsw:space": "cosine"},
    )
