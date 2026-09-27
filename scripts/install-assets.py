"""Download portable tools/models into this project; preserve source URLs and SHA256."""
import concurrent.futures, hashlib, json, pathlib, urllib.request, zipfile, time, sys
ROOT = pathlib.Path(__file__).resolve().parents[1]
TOOLS, MODELS = ROOT/'tools', ROOT/'models'
TOOLS.mkdir(exist_ok=True)
MODELS.mkdir(exist_ok=True)
def get_json(url):
    for attempt in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent':'VietStudio-Local'}), timeout=60) as r:
                return json.load(r)
        except Exception:
            if attempt == 2:
                raise
def download(url, dest, digest=None):
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists():
        if not digest or hashlib.file_digest(dest.open('rb'), 'sha256').hexdigest() == digest:
            print(f'Cached: {dest.name}', flush=True)
            return
    temp = dest.with_suffix(dest.suffix + '.part')
    for attempt in range(4):
        try:
            offset = temp.stat().st_size if temp.exists() else 0
            headers = {'User-Agent':'VietStudio-Local'}
            if offset:
                headers['Range'] = f'bytes={offset}-'
            with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=120) as r:
                append = offset and r.status == 206
                with temp.open('ab' if append else 'wb') as f:
                    last = time.monotonic()
                    while chunk := r.read(1024*1024):
                        f.write(chunk)
                        if time.monotonic()-last > 30:
                            print(f'{dest.name}: {f.tell()/1024**2:.0f} MB', flush=True)
                            last = time.monotonic()
            actual = hashlib.file_digest(temp.open('rb'), 'sha256').hexdigest()
            if digest and digest != actual:
                temp.unlink()
                raise RuntimeError('Checksum mismatch: '+dest.name)
            temp.replace(dest)
            dest.with_suffix(dest.suffix+'.source.json').write_text(json.dumps({'url':url,'sha256':actual},indent=2),encoding='utf-8')
            print(f'Ready: {dest.name}', flush=True)
            return
        except Exception as exc:
            print(f'Retry {attempt+1} {dest.name}: {exc}',flush=True)
            if attempt == 3:
                raise
def github_asset(repo, pattern):
    for release in get_json(f'https://api.github.com/repos/{repo}/releases?per_page=10'):
        for asset in release.get('assets',[]):
            if pattern(asset['name']):
                return asset
    raise RuntimeError('No matching release: '+repo)
def zip_tool(repo, pattern, target):
    asset=github_asset(repo,pattern)
    archive=TOOLS/asset['name']
    digest=asset.get('digest','').removeprefix('sha256:') or None
    download(asset['browser_download_url'],archive,digest)
    with zipfile.ZipFile(archive) as z:
        for member in z.infolist():
            dest=(target/member.filename).resolve()
            if not dest.is_relative_to(target.resolve()):
                raise RuntimeError('Unsafe archive member')
        z.extractall(target)
def ffmpeg():
    asset=github_asset('GyanD/codexffmpeg',lambda n:n.endswith('essentials_build.zip'))
    url=asset['browser_download_url']
    digest=asset['digest'].removeprefix('sha256:')
    archive=TOOLS/'ffmpeg-mirror.zip'
    download(url,archive,digest)
    with zipfile.ZipFile(archive) as z:
        for name in z.namelist():
            if name.endswith(('ffmpeg.exe','ffprobe.exe','LICENSE')):
                dest=TOOLS/'ffmpeg'/pathlib.PurePosixPath(name).name
                dest.parent.mkdir(exist_ok=True)
                with z.open(name) as src, dest.open('wb') as out:
                    import shutil
                    shutil.copyfileobj(src,out)
def hf_file(repo, relative, dest):
    marker = dest.with_suffix(dest.suffix+'.source.json')
    if dest.exists() and marker.exists():
        info = json.loads(marker.read_text(encoding='utf-8'))
        if hashlib.file_digest(dest.open('rb'), 'sha256').hexdigest() == info.get('sha256'):
            print(f'Verified cached: {dest.name}', flush=True)
            return
    parent=str(pathlib.PurePosixPath(relative).parent)
    listing=get_json(f'https://huggingface.co/api/models/{repo}/tree/main'+('' if parent=='.' else '/'+parent))
    item=next(x for x in listing if x['path']==relative)
    download(f'https://huggingface.co/{repo}/resolve/main/{relative}',dest,item.get('lfs',{}).get('oid'))
def voices():
    for speaker,quality in [('vais1000','medium'),('vivos','x_low'),('25hours_single','low')]:
        name=f'vi_VN-{speaker}-{quality}'
        for suffix in ['.onnx','.onnx.json']:
            hf_file('rhasspy/piper-voices',f'vi/vi_VN/{speaker}/{quality}/{name}{suffix}',MODELS/'voices'/(name+suffix))
def whisper_model():
    hf_file('ggerganov/whisper.cpp','ggml-small.bin',MODELS/'ggml-small.bin')
def vad_model():
    hf_file('ggml-org/whisper-vad','ggml-silero-v6.2.0.bin',MODELS/'ggml-silero-v6.2.0.bin')
def translation_model():
    hf_file('Qwen/Qwen3-4B-GGUF','Qwen3-4B-Q4_K_M.gguf',MODELS/'Qwen3-4B-Q4_K_M.gguf')
jobs=[voices,whisper_model,vad_model,translation_model]
if sys.platform == 'win32':
    jobs += [ffmpeg,
             lambda:zip_tool('ggml-org/llama.cpp',lambda n:'bin-win-vulkan-x64.zip' in n,TOOLS/'llama'),
             lambda:zip_tool('ggml-org/whisper.cpp',lambda n:n=='whisper-bin-x64.zip',TOOLS/'whisper')]
if __name__=='__main__':
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        futures=[pool.submit(job) for job in jobs]
        for f in concurrent.futures.as_completed(futures):
            f.result()
    print('Models installed. On macOS install native ffmpeg, whisper-cli and optional llama-server separately. GPU execution requires a real benchmark.',flush=True)
