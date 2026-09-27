"""Import native worker dependencies without loading/downloading user models."""
import ast
import pathlib
import platform
from importlib.metadata import version

root = pathlib.Path(__file__).resolve().parents[1]
for folder in ['workers', 'scripts']:
    for file in (root / folder).glob('*.py'):
        ast.parse(file.read_text(encoding='utf-8'), filename=str(file))
import cv2
from piper import PiperVoice
from rapidocr import RapidOCR
import onnxruntime
import yt_dlp
if not (platform.system() == 'Darwin' and platform.machine() == 'x86_64'):
    import torch
    from transformers import MarianMTModel, MarianTokenizer
    print('Native OPUS imports OK:', torch.__version__)
else:
    print('Intel macOS: OPUS uses Docker CPU. Native PyTorch is intentionally excluded.')
print('OCR/TTS/download imports OK:', {p: version(p) for p in ['piper-tts', 'rapidocr', 'onnxruntime', 'opencv-python', 'yt-dlp']})
