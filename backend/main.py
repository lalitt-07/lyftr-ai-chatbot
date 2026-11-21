
import os
import re
import time
import sqlite3
from pathlib import Path

import litellm
from litellm import completion
from litellm.caching import Cache
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlalchemy import true

# Load environment variables from the project root
ROOT_DIR = Path(__file__).resolve().parent.parent
load_dotenv(ROOT_DIR / ".env")

# Configuration
API_KEYS = [
    os.getenv("GOOGLE_API_KEY", "").strip(),
    os.getenv("GOOGLE_API_KEY_2", "").strip(),
]
API_KEYS = [key for key in API_KEYS if key]

MODEL = "gemini/gemini-3.5-flash-lite"
ENABLE_FAILURE_SIMULATION = (
    os.getenv("ENABLE_FAILURE_SIMULATION", "false").lower() == "true"
)

DATABASE_URL = os.getenv(
    "DATABASE_URL", "sqlite+aiosqlite:///./app.db"
)

# Convert SQLAlchemy-style SQLite URL into a local SQLite path
def get_database_path():
    if "////" in DATABASE_URL:
        path = DATABASE_URL.split("////", 1)[1]
        return "/" + path
    if "///" in DATABASE_URL:
        return str(ROOT_DIR / DATABASE_URL.split("///", 1)[1])
    return str(ROOT_DIR / "app.db")


DB_PATH = get_database_path()

# Enable LiteLLM's built-in local response cache
litellm.cache = Cache(type="local")

if "cache" not in litellm.input_callback:
    litellm.input_callback.append("cache")

if "cache" not in litellm.success_callback:
    litellm.success_callback.append("cache")

print("LITELLM CACHE ENABLED:", litellm.cache is not None)

app = FastAPI(title="LLM Chatbot with Key Failover and Caching")

origins = os.getenv(
    "ALLOWED_ORIGINS", "http://localhost:3000"
).split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in origins],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Database setup
def get_db():
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def initialize_database():
    Path(DB_PATH).parent.mkdir(parents=True, exist_ok=True)

    with get_db() as db:
        db.execute("""
            CREATE TABLE IF NOT EXISTS sessions (
                session_id TEXT PRIMARY KEY,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        db.execute("""
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                resolution_source TEXT,
                model TEXT,
                latency_ms INTEGER,
                input_tokens INTEGER,
                output_tokens INTEGER,
                FOREIGN KEY(session_id) REFERENCES sessions(session_id)
            )
        """)


@app.on_event("startup")
def startup():
    initialize_database()


# Request validation
class ChatRequest(BaseModel):
    session_id: str = Field(min_length=1, max_length=100)
    message: str = Field(min_length=1, max_length=4000)
    system_prompt: str | None = Field(default=None, max_length=2000)


# Helpers
def get_session_history(session_id):
    with get_db() as db:
        rows = db.execute(
            """
            SELECT role, content FROM messages
            WHERE session_id = ?
            ORDER BY id ASC
            """,
            (session_id,),
        ).fetchall()

    return [{"role": row["role"], "content": row["content"]} for row in rows]


def save_message(session_id, role, content, metadata=None):
    metadata = metadata or {}

    with get_db() as db:
        db.execute(
            "INSERT OR IGNORE INTO sessions (session_id) VALUES (?)",
            (session_id,),
        )

        db.execute(
            """
            INSERT INTO messages (
                session_id, role, content, resolution_source,
                model, latency_ms, input_tokens, output_tokens
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                session_id,
                role,
                content,
                metadata.get("resolution_source"),
                metadata.get("model"),
                metadata.get("latency_ms"),
                metadata.get("input_tokens"),
                metadata.get("output_tokens"),
            ),
        )


def simulate_status(header_value, key_id):
    if not header_value:
        return None

    for item in header_value.split(","):
        item = item.strip()

        if "=" not in item:
            continue

        target, status = item.split("=", 1)

        if target.strip() in (key_id, "*"):
            try:
                return int(status.strip())
            except ValueError:
                return None

    return None



def get_cache_hit(response):
    hidden = getattr(response, "_hidden_params", {}) or {}
    cache_info = getattr(response, "cache", None)

    return (
        bool(hidden.get("cache_hit", False))
        or bool(hidden.get("cache_key"))
        or cache_info is not None
    )
def generate_reply(messages, failure_header=None):
    last_error = None

    for index, api_key in enumerate(API_KEYS):
        key_id = f"key_{index + 1}"

        # Optional assignment-required failure simulation
        if ENABLE_FAILURE_SIMULATION:
            simulated_status = simulate_status(
                failure_header, key_id
            )

            if simulated_status in (429, 500):
                last_error = f"Simulated {simulated_status}"
                continue

        try:
            response = completion(
                model=MODEL,
                messages=messages,
                api_key=api_key,
                temperature=0.7,
                timeout=30,
                drop_params=True,
                caching=True   
                
            )

            reply = response.choices[0].message.content or ""
            
            usage = response.usage

            input_tokens = usage.prompt_tokens if usage else 0
            output_tokens = usage.completion_tokens if usage else 0

            cache_hit = get_cache_hit(response)
            print("CACHE DEBUG:", getattr(response, "_hidden_params", {}))
            print("CACHE OBJECT:", getattr(response, "cache", None))

            return {
                "reply": reply,
                "resolution_source": (
                    "LLM_CACHE" if cache_hit else "LIVE_INFERENCE"
                ),
                "model": MODEL,
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "key_id": None if cache_hit else key_id,
                "fallback_attempts": 0 if cache_hit else index,
            }

        except Exception as error:
            last_error = error
            continue

    print("All configured providers failed:", str(last_error))
    raise HTTPException(
        status_code=503,
        detail="all providers unavailable",
    )


# API endpoints
@app.get("/health")
def health():
    if not API_KEYS or len(API_KEYS) < 2:
        raise HTTPException(
            status_code=503,
            detail="Two API keys are required",
        )

    try:
        with get_db() as db:
            db.execute("SELECT 1")
    except Exception:
        raise HTTPException(
            status_code=503,
            detail="Database unavailable",
        )

    return {
        "status": "ok",
        "keys_configured": len(API_KEYS),
        "cache_enabled": True,
    }


@app.post("/chat")
def chat(
    request: ChatRequest,
    x_simulate_failure: str | None = Header(default=None),
):
    message = request.message.strip()

    if not message:
        raise HTTPException(
            status_code=422,
            detail="Message cannot be empty",
        )

    history = get_session_history(request.session_id)

    messages = []

    if request.system_prompt and request.system_prompt.strip():
        messages.append({
            "role": "system",
            "content": request.system_prompt.strip(),
        })

    messages.extend(history)
    messages.append({"role": "user", "content": message})

    start_time = time.perf_counter()

    result = generate_reply(
        messages,
        x_simulate_failure,
    )

    latency_ms = int(
        (time.perf_counter() - start_time) * 1000
    )

    metadata = {
        "resolution_source": result["resolution_source"],
        "model": result["model"],
        "latency_ms": latency_ms,
        "input_tokens": result["input_tokens"],
        "output_tokens": result["output_tokens"],
    }

    # Save only after successful inference
    save_message(request.session_id, "user", message)
    save_message(
        request.session_id,
        "assistant",
        result["reply"],
        metadata,
    )

    return {
        "session_id": request.session_id,
        "reply": result["reply"],
        "metadata": {
            **metadata,
            "key_id": result["key_id"],
            "fallback_attempts": result["fallback_attempts"],
        },
    }


@app.get("/sessions/{session_id}/messages")
def get_messages(session_id: str):
    with get_db() as db:
        session = db.execute(
            "SELECT session_id FROM sessions WHERE session_id = ?",
            (session_id,),
        ).fetchone()

        if not session:
            raise HTTPException(
                status_code=404,
                detail="Session not found",
            )

        rows = db.execute(
            """
            SELECT role, content, resolution_source, model,
                   latency_ms, input_tokens, output_tokens
            FROM messages
            WHERE session_id = ?
            ORDER BY id ASC
            """,
            (session_id,),
        ).fetchall()

    return {
        "session_id": session_id,
        "messages": [dict(row) for row in rows],
    }
