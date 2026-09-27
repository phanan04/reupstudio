from importlib.util import spec_from_file_location, module_from_spec
from pathlib import Path
spec=spec_from_file_location('assets',Path(__file__).with_name('install-assets.py'))
a=module_from_spec(spec)
spec.loader.exec_module(a)
repo='Helsinki-NLP/opus-mt-zh-vi'
files=a.get_json('https://huggingface.co/api/models/'+repo+'/tree/main')
for f in files:
    name=f['path']
    if name in ['config.json','generation_config.json','tokenizer_config.json','vocab.json','source.spm','target.spm','pytorch_model.bin','README.md']:
        a.download(f'https://huggingface.co/{repo}/resolve/main/{name}',a.MODELS/'opus-zh-vi'/name,f.get('lfs',{}).get('oid'))
print('OPUS CPU model installed.')
