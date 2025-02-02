from fastapi import FastAPI, HTTPException, Request
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import google.generativeai as genai
import os
from dotenv import load_dotenv
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Load environment variables
load_dotenv()
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "AIzaSyAm9tx6n3lR88888888888888888888888")

# Initialize FastAPI
app = FastAPI()

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount static files and templates
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

# Configure Gemini
try:
    genai.configure(api_key=GEMINI_API_KEY)
    model = genai.GenerativeModel('gemini-pro')
    logger.info("Gemini API configured successfully")
except Exception as e:
    logger.error(f"Failed to configure Gemini API: {str(e)}")
    raise

class ChatRequest(BaseModel):
    text: str

@app.get("/", response_class=HTMLResponse)
async def root(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})

@app.post("/api/chat")
async def chat(request: ChatRequest):
    try:
        if not request.text.strip():
            return JSONResponse(
                status_code=400,
                content={"response": "Empty text request"}
            )

        context = """You are a friendly and helpful AI assistant.
        Respond naturally and conversationally, as if speaking.
        Keep responses concise and engaging.
        If unsure, be honest about it."""

        prompt = f"{context}\n\nUser: {request.text}\nAssistant:"

        response = model.generate_content(
            prompt,
            generation_config={
                "temperature": 0.7,
                "top_p": 0.8,
                "top_k": 40,
                "max_output_tokens": 200,
            }
        )

        if not response or not hasattr(response, 'text'):
            return {"response": "I apologize, but I cannot provide a response at this moment."}

        cleaned_response = response.text.strip()
        return {"response": cleaned_response}

    except Exception as e:
        logger.error(f"Error in chat endpoint: {str(e)}")
        return {"response": "I apologize, but I encountered an error. Please try again."}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000, reload=True)