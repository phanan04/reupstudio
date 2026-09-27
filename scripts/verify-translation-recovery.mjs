import {Store} from '../server/store.mjs';
import {translateContext} from '../server/translation.mjs';
import fs from 'node:fs/promises';
const root = 'http://127.0.0.1:8765';
const config = await (await fetch(root+'/api/settings')).json();
const episode = await (await fetch(root+'/api/episodes/98dbd277-2b78-485b-99b4-b4702f66ef12')).json();
const dir = await fs.mkdtemp('data/recovery-check-');
const store = new Store(dir);
try {
  const p = store.listSeries()[0];
  const original = episode.cues.slice(0, 100);
  const e = store.addEpisode(p.id, {cues: original});
  const result = await translateContext(store, original, p.options, config, new AbortController().signal, (done,total)=>{if(done>92) console.log(done+'/'+total)}, e.id);
  const unchanged = JSON.stringify(result.slice(0,92)) === JSON.stringify(original.slice(0,92));
  const times = result.every((q,i)=>q.start===original[i].start && q.end===original[i].end);
  if (!unchanged || !times) throw Error('Checkpoint/timestamp changed');
  await fs.writeFile('data/verification/translation-recovery.json', JSON.stringify({unchanged,times,cues:result.slice(92)},null,2));
  console.log(JSON.stringify({unchanged,times,cues:result.slice(92)}));
} finally {store.close();}
