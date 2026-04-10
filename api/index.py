import sys
import os

# Add the project root to Python path so we can import app.py
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Import the Flask WSGI app — Vercel looks for 'app' in this module
from app import app  # noqa: F401 — re-exported for Vercel's Python runtime
