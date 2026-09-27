"""Explicit lightweight CPU translation mode. No claim of LLM contextual reasoning."""
import argparse, json, pathlib
import torch
from transformers import MarianMTModel, MarianTokenizer
p=argparse.ArgumentParser()
p.add_argument('--model',required=True)
p.add_argument('--input',required=True)
p.add_argument('--output',required=True)
p.add_argument('--threads',type=int,default=4)
args=p.parse_args()
torch.set_num_threads(args.threads)
tokenizer=MarianTokenizer.from_pretrained(args.model,local_files_only=True)
model=MarianMTModel.from_pretrained(args.model,local_files_only=True,weights_only=True).eval()
rows=json.loads(pathlib.Path(args.input).read_text(encoding='utf-8'))
result=[]
for start in range(0,len(rows),8):
    batch=rows[start:start+8]
    tokens=tokenizer([q['text'] for q in batch],return_tensors='pt',padding=True,truncation=False)
    if tokens['input_ids'].shape[1]>512:
        raise ValueError('Câu vượt giới hạn 512 token. Chia nhỏ phụ đề hoặc chọn LLM.')
    with torch.inference_mode():
        outputs=model.generate(**tokens,max_new_tokens=256,num_beams=4)
    for row,text in zip(batch,tokenizer.batch_decode(outputs,skip_special_tokens=True)):
        if not text.strip():
            raise RuntimeError('OPUS trả bản dịch rỗng')
        result.append({'id':row['id'],'vi':text.strip()})
    checkpoint = pathlib.Path(args.output)
    temp = checkpoint.with_suffix('.tmp')
    temp.write_text(json.dumps(result,ensure_ascii=False),encoding='utf-8')
    temp.replace(checkpoint)
    print(f'Translated {len(result)}/{len(rows)}',flush=True)
pathlib.Path(args.output).write_text(json.dumps(result,ensure_ascii=False),encoding='utf-8')
