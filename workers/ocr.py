"""Sample only the configured subtitle ROI, merge stable text across adjacent frames."""
import argparse, json, pathlib, difflib, os, re
import cv2
from rapidocr import RapidOCR
p = argparse.ArgumentParser()
p.add_argument('--input', required=True)
p.add_argument('--output', required=True)
p.add_argument('--roi', default='5,78,90,17')
p.add_argument('--directml', action='store_true')
p.add_argument('--fps', type=float, default=3)
args = p.parse_args()
font = pathlib.Path(os.environ['WINDIR']) / 'Fonts' / 'msyh.ttc' if os.environ.get('WINDIR') else None
params = {'EngineConfig.onnxruntime.use_dml': args.directml,
          'EngineConfig.onnxruntime.intra_op_num_threads': 4,
          'EngineConfig.onnxruntime.inter_op_num_threads': 1}
if font and font.exists():
    params['Global.font_path'] = str(font)
engine = RapidOCR(params=params)
cap = cv2.VideoCapture(args.input)
if not cap.isOpened():
    raise RuntimeError('Cannot open video for OCR')
fps = cap.get(cv2.CAP_PROP_FPS)
duration = cap.get(cv2.CAP_PROP_FRAME_COUNT) / fps
x, y, w, h = [float(v)/100 for v in args.roi.split(',')]
cues, active, votes = [], None, {}
step = 1 / args.fps
at = 0
def normalized(text):
    return re.sub(r'[^\u3400-\u9fffA-Za-z0-9]', '', text)
def finish():
    if active and active['end'] - active['start'] >= step * 1.8:
        winner = max(votes.values(), key=lambda v: (v['count'], v['score'], len(v['text'])))
        active['text'] = winner['text']
        cues.append(active.copy())
while at < duration:
    cap.set(cv2.CAP_PROP_POS_MSEC, at * 1000)
    ok, frame = cap.read()
    if not ok:
        break
    height, width = frame.shape[:2]
    roi = frame[int(y*height):int((y+h)*height), int(x*width):int((x+w)*width)]
    result = engine(roi)
    text = ''
    confidence = 0
    if result.txts is not None:
        accepted = [(t, score) for t, score in zip(result.txts, result.scores) if score >= .80]
        text = ''.join(t for t, score in accepted).strip()
        confidence = sum(score for t, score in accepted)/max(1,len(accepted))
    if len(re.findall(r'[\u3400-\u9fff]', text)) < 2 and confidence < .96:
        text = ''
    key = normalized(text)
    same = text and active and difflib.SequenceMatcher(None, key, normalized(active['text'])).ratio() >= .70
    if same:
        active['end'] = min(duration, at + step)
    elif text:
        finish()
        active = {'start': at, 'end': min(duration, at+step), 'text': text}
        votes = {}
    elif active and at - active['end'] > step:
        finish()
        active, votes = None, {}
    if text and active:
        vote = votes.setdefault(key, {'text': text, 'count': 0, 'score': confidence})
        vote['count'] += 1
        if confidence > vote['score']:
            vote.update(text=text, score=confidence)
    at += step
finish()
cap.release()
pathlib.Path(args.output).write_text(json.dumps(cues, ensure_ascii=False), encoding='utf-8')
print(f'OCR: {len(cues)} cues. Sampling interval {step:.3f}s; review timing before export.')
