import {existsSync} from 'node:fs';
import {mkdir,writeFile} from 'node:fs/promises';

// 原素材不随源码再分发；开发和构建时从已经确认的官方地址准备。
const folder=new URL('../public/audio/hero/',import.meta.url);
await mkdir(folder,{recursive:true});
for(const [name,id] of [['sweep','3114'],['ring','890']]){
  const file=new URL(`${name}.wav`,folder);
  if(existsSync(file))continue;
  const response=await fetch(`https://assets.mixkit.co/active_storage/sfx/${id}/${id}.wav`,{signal:AbortSignal.timeout(25000)});
  if(!response.ok)throw new Error(`Cannot prepare ${name} audio: HTTP ${response.status}`);
  const bytes=new Uint8Array(await response.arrayBuffer());
  if(bytes.length===0)throw new Error(`Empty ${name} audio`);
  await writeFile(file,bytes);
}
