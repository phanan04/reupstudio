"""One Piper model load per voice, persistent content-addressed utterance cache."""
import argparse, json, pathlib, wave, hashlib, shutil
from piper import PiperVoice

p = argparse.ArgumentParser()
p.add_argument('--input', required=True)
p.add_argument('--voices', required=True)
p.add_argument('--output', required=True)
args = p.parse_args()
out = pathlib.Path(args.output)
out.mkdir(parents=True, exist_ok=True)
cache = out / 'cache'
cache.mkdir(exist_ok=True)
segments = json.loads(pathlib.Path(args.input).read_text(encoding='utf-8'))
for name in dict.fromkeys(s['voice'] for s in segments):
    model = pathlib.Path(args.voices) / (name + '.onnx')
    stat = model.stat()
    voice = None
    for s in (s for s in segments if s['voice'] == name):
        key = hashlib.sha256(f'{name}|{stat.st_size}|{stat.st_mtime_ns}|{s["text"]}'.encode()).hexdigest()
        cached = cache / (key + '.wav')
        if not cached.exists():
            if voice is None:
                voice = PiperVoice.load(str(model), use_cuda=False)
            temp = cached.with_suffix('.pending.wav')
            with wave.open(str(temp), 'wb') as wav:
                voice.synthesize_wav(s['text'], wav)
            temp.replace(cached)
        shutil.copyfile(cached, out / f'{s["id"]}.wav')
        print(f'TTS {s["id"] + 1}/{len(segments)}', flush=True)
    del voice
