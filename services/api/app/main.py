from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import get_settings
from app.routers import (
    chat,
    classroom,
    documents,
    flashcards,
    gamification,
    health,
    practice_exams,
    study_plan,
    tools,
    voice,
)

app = FastAPI(title="Newton API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_allow_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(chat.router)
app.include_router(documents.router)
app.include_router(tools.router)
app.include_router(study_plan.router)
app.include_router(classroom.router)
app.include_router(flashcards.router)
app.include_router(gamification.router)
app.include_router(practice_exams.router)
app.include_router(voice.router)
