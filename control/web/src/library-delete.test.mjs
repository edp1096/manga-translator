import assert from 'node:assert/strict';
import {deleteLibraryJobs} from './library-delete.mjs';
const ids=Array.from({length:503},(_,i)=>'job-'+i),calls=[],pruned=[];
let out=await deleteLibraryJobs([...ids,ids[0]],async m=>pruned.push(m),async(_url,options)=>{const body=JSON.parse(options.body);calls.push(body);return {ok:true,json:async()=>({deleted:body.ids})};});
assert.deepEqual(calls.map(c=>c.ids.length),[500,3]);assert.deepEqual(out.deleted,ids);assert.equal(calls.some(c=>c.allUnkept),false);assert.deepEqual(pruned[0].ids,ids);
let count=0;out=await deleteLibraryJobs(ids,async m=>assert.equal(m.ids.length,501),async(_url,options)=>{const batch=JSON.parse(options.body).ids;count++;return {ok:count===1,json:async()=>({deleted:count===1?batch:[batch[0]],error:count===2?'disk error':undefined})};});assert.equal(out.deleted.length,501);assert.equal(out.error,'disk error');
out=await deleteLibraryJobs(['a'],async()=>{throw Error('offline')},async()=>({ok:true,json:async()=>({deleted:['a','unrelated']})}));assert.deepEqual(out.deleted,['a']);assert(out.cacheError);
out=await deleteLibraryJobs(['a'],async()=>assert.fail('must not prune'),async()=>{throw Error('network')});assert.equal(out.error,'network');
console.log('PASS batched exact deletion, partial failures, cache pruning and network errors');
