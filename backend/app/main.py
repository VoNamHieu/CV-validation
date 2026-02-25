from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routers import extract, process, crawl, topcv

app = FastAPI(title="AI Job Fit Optimizer API", version="1.0.0")

# Configure CORS — allow Vercel, ngrok, and local dev
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def read_root():
    return {"message": "AI Job Fit Optimizer Backend is running"}

app.include_router(extract.router)
app.include_router(process.router)
app.include_router(crawl.router)
app.include_router(topcv.router)
