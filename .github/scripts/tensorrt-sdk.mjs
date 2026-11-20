import { extractTar } from './extract-tar.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';

const run = (program, args) => execFileSync(program,args,{stdio:'inherit'});
async function download(file, url, digest) {
  run('curl',['--fail','--location','--retry','4','--output',file,url]);
  if (digest) await verify(file,digest);
}
async function verify(file, expected) {
  const hash=crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  if (hash.digest('hex')!==expected) throw Error('Checksum mismatch for '+file);
}

export async function tensorrtSDK(source,work,platform) {
  const win=platform==='windows-amd64';
  const x64=platform==='linux-amd64';
  const arch=win?'windows-x86_64':x64?'linux-x86_64':'linux-sbsa';
  const sdk=path.join(work,'trt-sdk');
  fs.mkdirSync(sdk,{recursive:true});
  const cuda={};
  for (const [component,digest] of Object.entries(win?{
    cuda_cudart:'82fb29001895810ce02e88b180cbaa90607b852a7f67a63f18f202079eaa2966',
    cuda_crt:'48c126a17e1a9f8f00ffa115614adee558bf4fc93e5d90c40b4738c609aa582f'
  }:x64?{
    cuda_cudart:'30ffafae23833dafc965cf4e4d034f8553805586959328c64e2c47b3ef3bcd55',
    cuda_crt:'ac444278c0f9d72b4a1b26c3bd9c694f07e1dbdc1e309aac9fd668378692e3e4'
  }:{
    cuda_cudart:'796da98c6868eb8aa0de5c28f4fb7fb77c2250cd91c9a763a2169faec95fc5dc',
    cuda_crt:'f50e86885ab56ae1b8ea4d908ede5a7995131d768c4458c2252f96c1c281c7ed'
  })) {
    const folder=component+'-'+arch+'-13.0.48-archive';
    const name=folder+(win?'.zip':'.tar.xz'), file=path.join(work,name);
    await download(file,'https://developer.download.nvidia.com/compute/cuda/redist/'+component+'/'+arch+'/'+name,digest);
    extractTar(file,work);
    cuda[component]=path.join(work,folder);
  }
  let trt;
  if (win) {
    const manifest=JSON.parse(fs.readFileSync(new URL('./tensorrt-windows-sdk.json',import.meta.url)));
    const archive=path.join(work,'trt-sdk.zip');
    await download(archive,manifest.source);
    extractTar(archive,sdk,Object.keys(manifest.files));
    for (const [entry,digest] of Object.entries(manifest.files)) await verify(path.join(sdk,entry),digest);
    trt=path.join(sdk,'TensorRT-10.14.1.48');
  } else {
    for (const [name,digest] of Object.entries(x64?{
      'libnvinfer-headers-dev':'b1ec6dd029cca33dfbbcc33b247bfd0ec00bfbfe33dbc9a8dbaabfcff5d53cf2',
      'libnvonnxparsers-dev':'27e61d52586125feb9b01cc949db4f3bf0c4807af8022c0bd8218e5cfef5ef74'
    }:{
      'libnvinfer-headers-dev':'2c4f9a5431005c7fb79d5583c69e618bee88bdef5b9a330ff244e97715997714',
      'libnvonnxparsers-dev':'543933403f1bac3a220c5a7f103cb134f35d3e3b00461fef672d3b9f6f0e113f'
    })) {
      const file=name+'_10.14.1.48-1+cuda13.0_'+(x64?'amd64':'arm64')+'.deb', dest=path.join(work,file);
      await download(dest,'https://developer.download.nvidia.com/compute/cuda/repos/ubuntu2404/'+(x64?'x86_64':'sbsa')+'/'+file,digest);
      run('dpkg-deb',['-x',dest,sdk]);
    }
    trt=path.join(sdk,'usr');
    const catalog=JSON.parse(fs.readFileSync(path.join(source,'control/internal/assets/bundle/catalog.json')));
    const libs=catalog.artifacts.find(a=>a.id==='tensorrt-libs-'+platform);
    const file=path.join(work,'tensorrt.whl'), dst=path.join(trt,'lib',x64?'x86_64-linux-gnu':'aarch64-linux-gnu');
    await download(file,libs.url,libs.sha256);
    run('unzip',['-ojq',file,'tensorrt_libs/libnvinfer.so.10','tensorrt_libs/libnvonnxparser.so.10','-d',dst]);
  }
  return ['-DMANGA_HAYAI_TRT=ON','-DTRT_SDK='+trt,'-DCUDA_CUDART='+cuda.cuda_cudart,'-DCUDA_CRT='+cuda.cuda_crt];
}
