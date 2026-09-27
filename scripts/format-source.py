import urllib.request, json, pathlib, hashlib, base64, tarfile
root=pathlib.Path(__file__).resolve().parents[1]
with urllib.request.urlopen('https://registry.npmjs.org/prettier/3.6.2',timeout=60) as r:
    meta=json.load(r)
with urllib.request.urlopen(meta['dist']['tarball'],timeout=60) as r:
    data=r.read()
algo,integrity=meta['dist']['integrity'].split('-',1)
assert base64.b64encode(hashlib.new(algo,data).digest()).decode()==integrity
dest=root/'tools'/'prettier'
dest.mkdir(exist_ok=True)
archive=dest/'package.tgz'
archive.write_bytes(data)
with tarfile.open(archive) as tar:
    tar.extractall(dest,filter='data')
