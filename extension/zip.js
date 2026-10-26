// ZIP store method: images are already compressed. UTF-8 names and CRC32.
(()=>{
 const table=Uint32Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
 const crc=data=>{let n=0xffffffff;for(const b of data)n=table[(n^b)&255]^(n>>>8);return (n^0xffffffff)>>>0;};
 function create(files){
  if(files.length>65535)throw Error('ZIP 파일 개수 제한 초과');
  const parts=[],central=[];let offset=0,centralSize=0;
  for(const file of files){
   const name=new TextEncoder().encode(file.name),data=file.data;
   if(name.length>65535||data.length>0xffffffff||offset+30+name.length+data.length>0xffffffff)throw Error('ZIP 용량 제한 초과');
   const sum=crc(data),local=new Uint8Array(30),v=new DataView(local.buffer);
   v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(6,0x800,true);v.setUint16(12,33,true);v.setUint32(14,sum,true);v.setUint32(18,data.length,true);v.setUint32(22,data.length,true);v.setUint16(26,name.length,true);
   const c=new Uint8Array(46),w=new DataView(c.buffer);w.setUint32(0,0x02014b50,true);w.setUint16(4,20,true);w.setUint16(6,20,true);w.setUint16(8,0x800,true);w.setUint16(14,33,true);w.setUint32(16,sum,true);w.setUint32(20,data.length,true);w.setUint32(24,data.length,true);w.setUint16(28,name.length,true);w.setUint32(42,offset,true);
   parts.push(local,name,data);central.push(c,name);offset+=local.length+name.length+data.length;centralSize+=c.length+name.length;
  }
  if(offset+centralSize+22>0xffffffff)throw Error('ZIP 용량 제한 초과');
  const end=new Uint8Array(22),v=new DataView(end.buffer);v.setUint32(0,0x06054b50,true);v.setUint16(8,files.length,true);v.setUint16(10,files.length,true);v.setUint32(12,centralSize,true);v.setUint32(16,offset,true);
  return new Blob([...parts,...central,end],{type:'application/zip'});
 }
 globalThis.MangaZip={create};
})();
