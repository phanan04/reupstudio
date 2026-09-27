import fs from 'node:fs/promises';
import {Store} from '../server/store.mjs';
import {reviewTranslation} from '../server/translation.mjs';
const store=new Store('data/context-evaluation');
try {
  const data=JSON.parse(await fs.readFile('data/context-evaluation/latest.json','utf8'));
  const series=store.listSeries()[0];
  const bad=structuredClone(data.qwen);
  bad[0].vi='Anh không cố ý đâu, em gái.';
  bad[3].vi='Anh ấy là ánh trăng trắng trong tim cô ấy.';
  bad[7].vi='Tôi đã nói cô ấy ăn cắp tiền.';
  const episode=store.addEpisode(series.id,{cues:bad});
  const c={...store.settings(),translationEngine:'ollama',ollamaModel:data.model,forceCpu:true,batchSize:3,contextSize:4096};
  const start=Date.now();
  data.review=await reviewTranslation(store,episode.id,c,new AbortController().signal,(n,t)=>console.log(`Reviewed ${n}/${t}`));
  data.reviewMs=Date.now()-start;
  data.seededErrors=['1','4','8'];
  data.timestampUnchanged=JSON.stringify(data.input.map(c=>[c.start,c.end]))===JSON.stringify(data.qwen.map(c=>[c.start,c.end]));
  await fs.writeFile('data/context-evaluation/latest.json',JSON.stringify(data,null,2));
  console.log(JSON.stringify({status:data.review.status,reviewMs:data.reviewMs,issues:data.review.issues.filter(i=>i.source==='ai')}));
}finally{store.close();}
