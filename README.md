# SpeakWithGemini

A web application that combines browser-based Speech-to-Text to Text-to-speech capabilities with Google's Gemini LLM for interactive voice-based chatting.

## Features

- Browser-based Speech-to-Text to Text-to-Speech conversion
- Real-time chat interaction with Gemini AI
- Simple and intuitive web interface
- FastAPI backend for efficient processing

## Setup

1. Clone the repository:
```bash
git clone https://github.com/yourusername/speech-to-text-llm-chat.git
cd speech-to-text-llm-chat
```

2. Install requirements:
```bash
pip install -r requirements.txt
```

3. Create a `.env` file in the root directory and add your Gemini API key:
```
GEMINI_API_KEY=your_api_key_here
```

4. Run the application:
```bash
python main.py
```
or
```bash
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

5. Open your browser and navigate to `http://127.0.0.1:8000`

## Technologies Used

- FastAPI
- Google Gemini AI
- Web Speech API
- VAD (Voice Activity detection)
- Python 3.8+
- Jinja2 Templates

## License

MIT License

## Contributing

Pull requests are welcome. For major changes, please open an issue first to discuss what you would like to change.
