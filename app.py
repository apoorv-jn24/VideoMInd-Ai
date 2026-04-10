import os
import json
import re
import base64
import uuid
from datetime import datetime

from flask import (
    Flask, request, jsonify, render_template,
    redirect, url_for, flash
)
from flask_cors import CORS
from flask_sqlalchemy import SQLAlchemy
from flask_login import (
    LoginManager, UserMixin,
    login_user, logout_user, login_required, current_user
)
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.utils import secure_filename
from dotenv import load_dotenv
from youtube_transcript_api import YouTubeTranscriptApi
from fpdf import FPDF

# yt-dlp is optional — used locally for YouTube audio download fallback
try:
    import yt_dlp as _yt_dlp
    YT_DLP_AVAILABLE = True
except ImportError:
    YT_DLP_AVAILABLE = False

# ─── Load environment ────────────────────────────────────────
load_dotenv()

app = Flask(__name__)
CORS(app)

# ─── Config ──────────────────────────────────────────────────
app.config['SECRET_KEY'] = os.getenv('SECRET_KEY', 'videomind-secret-key-change-in-prod-2024')

# ─── Vercel / Serverless: only /tmp is writable at runtime ───
# Locally this still works fine since /tmp is always available.
_TMP_DIR = '/tmp'
DB_PATH  = os.path.join(_TMP_DIR, 'videomind_users.db')
app.config['SQLALCHEMY_DATABASE_URI'] = f'sqlite:///{DB_PATH}'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

UPLOAD_FOLDER = os.path.join(_TMP_DIR, 'uploads')
ALLOWED_EXTENSIONS = {'mp4', 'mov', 'avi', 'mkv', 'webm', 'flv', 'mpeg', 'mpg', 'm4v'}
MAX_CONTENT_LENGTH = 200 * 1024 * 1024  # 200 MB (Vercel request body limit)
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['MAX_CONTENT_LENGTH'] = MAX_CONTENT_LENGTH

# ─── Database ─────────────────────────────────────────────────
db = SQLAlchemy(app)

# ─── Login Manager ────────────────────────────────────────────
login_manager = LoginManager(app)
login_manager.login_view = 'auth_page'
login_manager.login_message = ''

# ─── Models ──────────────────────────────────────────────────
MODEL_CHAT    = 'llama-3.3-70b-versatile'
MODEL_VISION  = 'meta-llama/llama-4-scout-17b-16e-instruct'
MODEL_WHISPER = 'whisper-large-v3'

# ─── User Model ───────────────────────────────────────────────
class User(db.Model, UserMixin):
    id            = db.Column(db.Integer, primary_key=True)
    username      = db.Column(db.String(80),  unique=True,  nullable=False)
    email         = db.Column(db.String(120), unique=True,  nullable=False)
    password_hash = db.Column(db.String(256), nullable=False)
    created_at    = db.Column(db.DateTime, default=datetime.utcnow)

    def set_password(self, password: str):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password: str) -> bool:
        return check_password_hash(self.password_hash, password)

    def to_dict(self):
        return {
            'id':         self.id,
            'username':   self.username,
            'email':      self.email,
            'created_at': self.created_at.strftime('%B %Y'),
        }


@login_manager.user_loader
def load_user(user_id):
    return db.session.get(User, int(user_id))


# ─── Create tables (safely, won't crash Lambda startup) ──────
try:
    with app.app_context():
        db.create_all()
except Exception as _db_err:
    print(f'[!] DB init warning: {_db_err}')


# ─── In-memory video context cache ───────────────────────────
context_cache: dict = {}


# ─── Groq Client ─────────────────────────────────────────────
def get_groq_client(api_key: str = None):
    from groq import Groq
    key = api_key or os.getenv('GROQ_API_KEY', '')
    if not key or key == 'your_groq_api_key_here':
        raise ValueError(
            'No Groq API key configured. '
            'Get a free key at https://console.groq.com/keys and enter it in ⚙️ Settings.'
        )
    return Groq(api_key=key)


def allowed_file(filename: str) -> bool:
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


# ═══════════════════════════════════════════════════════════════
#  Video Processing Pipeline
# ═══════════════════════════════════════════════════════════════

def extract_frames_b64(video_path: str, max_frames: int = 6) -> list:
    """
    Extract evenly-spaced frames from a video file.
    Tries ffmpeg (via subprocess) first; falls back gracefully if not available.
    Returns a list of base64-encoded JPEG strings.
    """
    import subprocess
    import tempfile
    import glob
    from PIL import Image
    import io

    frames_b64 = []
    try:
        # Use ffmpeg subprocess — available on most PaaS runtimes including Vercel
        with tempfile.TemporaryDirectory() as tmpdir:
            out_pattern = os.path.join(tmpdir, 'frame%03d.jpg')
            # Extract up to max_frames frames spread across the video
            cmd = [
                'ffmpeg', '-i', video_path,
                '-vf', f'fps=1/15,scale=1024:-2',  # 1 frame every 15s, max 1024px wide
                '-frames:v', str(max_frames),
                '-q:v', '5',
                out_pattern,
                '-y', '-loglevel', 'error'
            ]
            subprocess.run(cmd, check=True, timeout=60)
            frame_files = sorted(glob.glob(os.path.join(tmpdir, 'frame*.jpg')))
            for fp in frame_files[:max_frames]:
                with open(fp, 'rb') as fh:
                    frames_b64.append(base64.b64encode(fh.read()).decode('utf-8'))
        print(f'[+] Extracted {len(frames_b64)} frame(s) via ffmpeg.')
    except (subprocess.CalledProcessError, FileNotFoundError, OSError) as e:
        print(f'[!] ffmpeg frame extraction unavailable: {e}. Skipping visual analysis.')
    except Exception as e:
        print(f'[!] Frame extraction error: {e}. Skipping visual analysis.')
    return frames_b64


def transcribe_audio(video_path: str, groq_client) -> str:
    """
    Extract audio from video using ffmpeg subprocess and transcribe via Groq Whisper.
    Gracefully returns an informative message if ffmpeg is unavailable.
    """
    import subprocess
    audio_path = video_path + '_audio.mp3'
    try:
        # Extract audio via ffmpeg subprocess (no moviepy/imageio-ffmpeg needed)
        cmd = [
            'ffmpeg', '-i', video_path,
            '-vn',                  # no video
            '-ar', '16000',         # 16kHz sample rate (Whisper optimal)
            '-ac', '1',             # mono
            '-b:a', '64k',
            '-f', 'mp3',
            audio_path,
            '-y', '-loglevel', 'error'
        ]
        result = subprocess.run(cmd, check=True, timeout=120, capture_output=True)

        if not os.path.exists(audio_path):
            return '[Audio extraction produced no output file.]'

        if os.path.getsize(audio_path) > 24 * 1024 * 1024:
            os.remove(audio_path)
            return '[Audio too large for Groq Whisper. Visual analysis only.]'

        with open(audio_path, 'rb') as f:
            transcription = groq_client.audio.transcriptions.create(
                file=(os.path.basename(audio_path), f, 'audio/mpeg'),
                model=MODEL_WHISPER, response_format='text',
            )
        os.remove(audio_path)
        return transcription if isinstance(transcription, str) else getattr(transcription, 'text', str(transcription))

    except (subprocess.CalledProcessError, FileNotFoundError, OSError) as e:
        if os.path.exists(audio_path):
            try: os.remove(audio_path)
            except: pass
        return f'[Audio transcription unavailable — ffmpeg not found or failed: {str(e)[:150]}]'
    except Exception as e:
        if os.path.exists(audio_path):
            try: os.remove(audio_path)
            except: pass
        return f'[Transcription failed: {str(e)[:200]}]'


def extract_yt_id(url: str) -> str:
    """Extract YouTube Video ID from URL."""
    pattern = r'(?:v=|\/)([0-9A-Za-z_-]{11}).*'
    match = re.search(pattern, url)
    return match.group(1) if match else None


def get_yt_details(yt_url: str) -> dict:
    """Fetch video title from YouTube using lightweight HTML scraping (no yt-dlp needed)."""
    try:
        import urllib.request
        req = urllib.request.Request(
            yt_url,
            headers={'User-Agent': 'Mozilla/5.0 (compatible; VideoMindBot/1.0)'}
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            html = resp.read().decode('utf-8', errors='replace')
        # Extract title from og:title or <title> tag
        m = re.search(r'<meta property="og:title" content="([^"]+)"', html)
        if not m:
            m = re.search(r'<title>([^<]+)</title>', html)
        title = m.group(1).replace(' - YouTube', '').strip() if m else 'YouTube Video'
        return {'title': title, 'id': extract_yt_id(yt_url)}
    except Exception:
        return {'title': 'YouTube Video', 'id': extract_yt_id(yt_url)}


def describe_frames(frames_b64: list, groq_client) -> str:
    if not frames_b64:
        return '[No frames extracted.]'
    descriptions = []
    for i, b64 in enumerate(frames_b64):
        try:
            resp = groq_client.chat.completions.create(
                model=MODEL_VISION,
                messages=[{'role': 'user', 'content': [
                    {'type': 'image_url', 'image_url': {'url': f'data:image/jpeg;base64,{b64}'}},
                    {'type': 'text', 'text': (
                        f'Frame {i+1} from a video. Describe in detail: people, '
                        'objects, text on screen, setting, activities. Be specific.'
                    )}
                ]}],
                max_tokens=400,
            )
            descriptions.append(f'[Frame {i+1}]\n{resp.choices[0].message.content.strip()}')
            print(f'[+] Frame {i+1} described.')
        except Exception as e:
            descriptions.append(f'[Frame {i+1}]\n[Error: {e}]')
    return '\n\n'.join(descriptions)


def build_combined_context(transcript: str, visual_context: str, filename: str) -> str:
    return (
        f'=== VIDEO: {filename} ===\n\n'
        f'--- AUDIO TRANSCRIPT ---\n{transcript or "[none]"}\n\n'
        f'--- VISUAL FRAME ANALYSIS ---\n{visual_context or "[none]"}\n'
    )


def llm_with_context(token: str, system_prompt: str, user_prompt: str,
                     api_key: str = '', max_tokens: int = 1500) -> str:
    info = context_cache.get(token)
    if not info:
        raise KeyError('Video session not found. Please re-upload the video.')
    client = get_groq_client(api_key or info['api_key'])
    resp = client.chat.completions.create(
        model=MODEL_CHAT,
        messages=[
            {'role': 'system', 'content': system_prompt + f'\n\nVIDEO CONTEXT:\n{info["combined_context"]}'},
            {'role': 'user',   'content': user_prompt},
        ],
        temperature=0.3, max_tokens=max_tokens,
    )
    return resp.choices[0].message.content.strip()


# ═══════════════════════════════════════════════════════════════
#  Auth Routes
# ═══════════════════════════════════════════════════════════════

@app.route('/auth')
def auth_page():
    if current_user.is_authenticated:
        return redirect(url_for('index'))
    return render_template('auth.html')


@app.route('/api/register', methods=['POST'])
def register():
    data     = request.get_json(force=True)
    username = data.get('username', '').strip()
    email    = data.get('email', '').strip().lower()
    password = data.get('password', '')

    # Validate
    if not username or len(username) < 3:
        return jsonify({'error': 'Username must be at least 3 characters.'}), 400
    if not email or '@' not in email:
        return jsonify({'error': 'Please enter a valid email address.'}), 400
    if len(password) < 6:
        return jsonify({'error': 'Password must be at least 6 characters.'}), 400

    if User.query.filter_by(username=username).first():
        return jsonify({'error': 'Username already taken. Please choose another.'}), 409
    if User.query.filter_by(email=email).first():
        return jsonify({'error': 'An account with this email already exists.'}), 409

    user = User(username=username, email=email)
    user.set_password(password)
    db.session.add(user)
    db.session.commit()

    login_user(user, remember=True)
    return jsonify({'success': True, 'user': user.to_dict()})


@app.route('/api/login', methods=['POST'])
def login():
    data       = request.get_json(force=True)
    identifier = data.get('identifier', '').strip()   # username or email
    password   = data.get('password', '')
    remember   = data.get('remember', False)

    if not identifier or not password:
        return jsonify({'error': 'Please fill in all fields.'}), 400

    # Look up by username OR email
    user = (
        User.query.filter_by(username=identifier).first()
        or User.query.filter_by(email=identifier.lower()).first()
    )

    if not user or not user.check_password(password):
        return jsonify({'error': 'Invalid username/email or password.'}), 401

    login_user(user, remember=remember)
    return jsonify({'success': True, 'user': user.to_dict()})


@app.route('/api/logout', methods=['POST', 'GET'])
def logout():
    logout_user()
    return jsonify({'success': True})


@app.route('/logout')
def logout_redirect():
    """Fallback GET logout — redirects to auth page after clearing session."""
    logout_user()
    return redirect(url_for('auth_page'))


@app.route('/api/me')
@login_required
def me():
    return jsonify({'user': current_user.to_dict()})


# ═══════════════════════════════════════════════════════════════
#  Main App Routes  (all protected)
# ═══════════════════════════════════════════════════════════════

@app.route('/')
@login_required
def index():
    return render_template('index.html', user=current_user)


@app.route('/favicon.ico')
def favicon():
    return '', 204


# ─── Upload ──────────────────────────────────────────────────
@app.route('/upload', methods=['POST'])
@login_required
def upload_video():
    api_key = request.form.get('api_key', '')
    if 'video' not in request.files:
        return jsonify({'error': 'No video file provided.'}), 400
    file = request.files['video']
    if not file.filename or not allowed_file(file.filename):
        return jsonify({'error': 'Unsupported or missing file.'}), 400
    try:
        groq_client = get_groq_client(api_key)
    except ValueError as e:
        return jsonify({'error': str(e)}), 401

    filename   = secure_filename(file.filename)
    local_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    file.save(local_path)
    print(f'\n[+] Saved: {filename}')

    try:
        frames_b64     = extract_frames_b64(local_path, max_frames=6)
        transcript     = transcribe_audio(local_path, groq_client)
        visual_context = describe_frames(frames_b64, groq_client)
        combined       = build_combined_context(transcript, visual_context, filename)

        token = uuid.uuid4().hex[:16]
        context_cache[token] = {
            'filename': filename, 'local_path': local_path,
            'transcript': transcript, 'visual_context': visual_context,
            'combined_context': combined, 'api_key': api_key,
            'frames_n': len(frames_b64),
            'user_id': current_user.id,
        }
        print(f'[+] Done. Token: {token}')
        return jsonify({'success': True, 'token': token, 'display_name': filename,
                        'frames_analyzed': len(frames_b64), 'transcript_chars': len(transcript)})
    except Exception as e:
        if os.path.exists(local_path):
            try: os.remove(local_path)
            except: pass
        return jsonify({'error': f'Processing failed: {str(e)}'}), 500


@app.route('/upload_yt', methods=['POST'])
@login_required
def upload_youtube():
    data = request.get_json(force=True)
    yt_url = data.get('url', '').strip()
    api_key = data.get('api_key', '')
    
    if not yt_url:
        return jsonify({'error': 'YouTube URL is required.'}), 400
    
    v_id = extract_yt_id(yt_url)
    if not v_id:
        return jsonify({'error': 'Invalid YouTube URL.'}), 400

    try:
        groq_client = get_groq_client(api_key)
    except ValueError as e:
        return jsonify({'error': str(e)}), 401

    try:
        # 1. Try to get automated transcript
        transcript = ""
        try:
            transcript_list = YouTubeTranscriptApi.get_transcript(v_id)
            transcript = " ".join([item['text'] for item in transcript_list])
            print(f'[+] Extracted YouTube transcript (API) for {v_id}')
        except Exception as api_err:
            print(f'[!] API transcript unavailable for {v_id}: {api_err}.')

            if not YT_DLP_AVAILABLE:
                # On serverless deployments (Vercel), yt-dlp is not installed.
                # The youtube-transcript-api is the only transcript source available.
                transcript = '[Transcript not available for this video. YouTube auto-captions may be disabled.]'
            else:
                # 2. Fallback (local / Docker only): Download audio and use Whisper
                temp_path = os.path.join(app.config['UPLOAD_FOLDER'], f'yt_{v_id}')
                local_audio = temp_path + '.mp3'
                if os.path.exists(local_audio):
                    try: os.remove(local_audio)
                    except: pass
                ydl_opts = {
                    'format': 'bestaudio/best',
                    'outtmpl': temp_path,
                    'postprocessors': [{
                        'key': 'FFmpegExtractAudio',
                        'preferredcodec': 'mp3',
                        'preferredquality': '128',
                    }],
                    'quiet': True,
                    'no_warnings': True
                }
                try:
                    with _yt_dlp.YoutubeDL(ydl_opts) as ydl:
                        ydl.download([yt_url])
                    if os.path.exists(local_audio):
                        with open(local_audio, 'rb') as f:
                            result = groq_client.audio.transcriptions.create(
                                file=(os.path.basename(local_audio), f, 'audio/mpeg'),
                                model=MODEL_WHISPER, response_format='text',
                            )
                        transcript = result if isinstance(result, str) else getattr(result, 'text', str(result))
                        try: os.remove(local_audio)
                        except: pass
                        print(f'[+] Generated YouTube transcript (Whisper) for {v_id}')
                    else:
                        transcript = '[Could not generate YouTube transcript. Ensure ffmpeg is installed.]'
                except Exception as dl_err:
                    print(f'[!] YouTube download error: {dl_err}')
                    transcript = f'[YouTube Download Failed: {str(dl_err)[:100]}]'

        # 3. Create context session
        details = get_yt_details(yt_url)
        disp_name = details['title']
        combined = build_combined_context(transcript, "[YouTube Video - No Vision Analysis]", disp_name)

        token = uuid.uuid4().hex[:16]
        context_cache[token] = {
            'filename': disp_name, 'local_path': None,
            'transcript': transcript, 'visual_context': "[YouTube Analysis]",
            'combined_context': combined, 'api_key': api_key,
            'frames_n': 0, 'user_id': current_user.id,
        }
        
        return jsonify({
            'success': True, 'token': token, 'display_name': disp_name,
            'frames_analyzed': 0, 'transcript_chars': len(transcript)
        })

    except Exception as e:
        return jsonify({'error': f'YouTube processing failed: {str(e)}'}), 500


@app.route('/download_summary', methods=['POST'])
@login_required
def download_summary():
    data = request.get_json(force=True)
    token = data.get('token', '')
    summary_text = data.get('summary', '')
    
    info = context_cache.get(token)
    title = info['filename'] if info else "Video Summary"
    
    try:
        class PDF(FPDF):
            def header(self):
                self.set_font('helvetica', 'B', 15)
                self.cell(0, 10, 'VideoMind AI - Video Summary', 0, 1, 'C')
                self.ln(5)

            def footer(self):
                self.set_y(-15)
                self.set_font('helvetica', 'I', 8)
                self.cell(0, 10, f'Page {self.page_no()} | Generated by VideoMind AI', 0, 0, 'C')

        pdf = PDF()
        pdf.add_page()
        pdf.set_font("helvetica", 'B', 16)
        pdf.multi_cell(0, 10, f"Video: {title}")
        pdf.ln(5)
        
        pdf.set_font("helvetica", '', 11)
        # Clean markdown-ish text for simple PDF
        # Ensure we only use characters helvetica supports (latin-1)
        clean_text = summary_text.replace('##', '').replace('**', '').replace('*', '•')
        clean_text = clean_text.encode('latin-1', 'replace').decode('latin-1')
        pdf.multi_cell(0, 7, clean_text)
        
        pdf_filename = f"Summary_{token[:8]}.pdf"
        output_dir = app.config['UPLOAD_FOLDER']
        pdf_path = os.path.abspath(os.path.join(output_dir, pdf_filename))
        pdf.output(pdf_path)
        
        from flask import send_from_directory
        return send_from_directory(output_dir, pdf_filename, as_attachment=True)
        
    except Exception as e:
        return jsonify({'error': f'PDF generation failed: {str(e)}'}), 500


# ─── Ask ─────────────────────────────────────────────────────
@app.route('/ask', methods=['POST'])
@login_required
def ask_question():
    data     = request.get_json(force=True)
    token    = data.get('token', '')
    question = data.get('question', '').strip()
    api_key  = data.get('api_key', '')
    if not token:    return jsonify({'error': 'No video session.'}), 400
    if not question: return jsonify({'error': 'Question cannot be empty.'}), 400
    try:
        answer = llm_with_context(token,
            'You are an intelligent AI assistant that analysed a video via transcript and vision frames. '
            'Answer accurately based only on provided context. Say so if info is unavailable.',
            question, api_key=api_key)
        return jsonify({'success': True, 'answer': answer})
    except (KeyError, ValueError) as e: return jsonify({'error': str(e)}), 400
    except Exception as e:              return jsonify({'error': str(e)}), 500


# ─── Summarise ───────────────────────────────────────────────
@app.route('/summarize', methods=['POST'])
@login_required
def summarize_video():
    data    = request.get_json(force=True)
    token   = data.get('token', '')
    api_key = data.get('api_key', '')
    if not token: return jsonify({'error': 'No video session.'}), 400
    try:
        summary = llm_with_context(token,
            'You are an expert video analyst. Produce accurate, well-structured summaries.',
            ('Structured summary:\n\n## 🎯 Overview\n2-3 sentence summary.\n\n'
             '## 📌 Key Topics\nBullet list.\n\n## 🕒 Key Moments\nKey events.\n\n'
             '## 💡 Key Takeaways\n3-5 insights.\n\n## 📝 Detailed Notes\nFull notes.\n\nFormat in markdown.'),
            api_key=api_key, max_tokens=2000)
        return jsonify({'success': True, 'summary': summary})
    except (KeyError, ValueError) as e: return jsonify({'error': str(e)}), 400
    except Exception as e:              return jsonify({'error': str(e)}), 500


# ─── Quiz ────────────────────────────────────────────────────
@app.route('/quiz', methods=['POST'])
@login_required
def generate_quiz():
    data          = request.get_json(force=True)
    token         = data.get('token', '')
    api_key       = data.get('api_key', '')
    num_questions = min(int(data.get('num_questions', 5)), 10)
    if not token: return jsonify({'error': 'No video session.'}), 400
    try:
        raw = llm_with_context(token,
            'You are a quiz generator. Respond with ONLY valid JSON arrays, no extra text.',
            (f'Generate exactly {num_questions} MCQ questions about this video.\n\n'
             'Return ONLY a JSON array:\n[{"question":"...","options":["A","B","C","D"],"correct":0,"explanation":"..."}]\n\n'
             '"correct" is 0-based index. Vary difficulty.'),
            api_key=api_key, max_tokens=2000)
        raw = re.sub(r'^```(?:json)?\s*', '', raw.strip())
        raw = re.sub(r'\s*```$', '', raw)
        return jsonify({'success': True, 'quiz': json.loads(raw)})
    except json.JSONDecodeError as e: return jsonify({'error': f'Quiz parse error: {e}'}), 500
    except (KeyError, ValueError) as e: return jsonify({'error': str(e)}), 400
    except Exception as e:              return jsonify({'error': str(e)}), 500


# ─── Transcript ──────────────────────────────────────────────
@app.route('/transcript', methods=['POST'])
@login_required
def get_transcript():
    data  = request.get_json(force=True)
    token = data.get('token', '')
    if not token: return jsonify({'error': 'No video session.'}), 400
    info = context_cache.get(token)
    if not info: return jsonify({'error': 'Session not found.'}), 404
    full = (
        '## 🎙️ Audio Transcript\n*(via Groq Whisper)*\n\n' + info['transcript'] +
        '\n\n---\n\n## 🖼️ Visual Frame Analysis\n*(via Groq Vision — ' +
        str(info['frames_n']) + f' frames)*\n\n' + info['visual_context']
    )
    return jsonify({'success': True, 'transcript': full})


# ─── Delete ──────────────────────────────────────────────────
@app.route('/delete', methods=['POST'])
@login_required
def delete_video():
    data  = request.get_json(force=True)
    token = data.get('token', '')
    info  = context_cache.pop(token, None)
    if info and info.get('local_path'):
        try:
            if os.path.exists(info['local_path']): os.remove(info['local_path'])
        except: pass
    return jsonify({'success': True})


# ─── Run ─────────────────────────────────────────────────────
if __name__ == '__main__':
    print('=' * 60)
    print('  VideoMind AI — Groq + Login System')
    print('  Open http://127.0.0.1:5000 in your browser')
    print('=' * 60)
    port = int(os.environ.get('PORT', 5000))
    app.run(debug=False, host='0.0.0.0', port=port)
