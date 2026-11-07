import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const bytes = path => readFile(new URL(path, import.meta.url));
const pngSize = buffer => {
  assert.equal(buffer.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
  return [buffer.readUInt32BE(16),buffer.readUInt32BE(20)];
};

test("browser and Apple icon exports have their advertised square dimensions",async()=>{
  assert.deepEqual(pngSize(await bytes('./assets/favicon-96.png')),[96,96]);
  assert.deepEqual(pngSize(await bytes('./assets/apple-touch-icon.png')),[180,180]);
});

test("ICO has three valid PNG frames for small browser surfaces",async()=>{
  const ico=await bytes('./favicon.ico');
  assert.equal(ico.readUInt16LE(0),0); assert.equal(ico.readUInt16LE(2),1); assert.equal(ico.readUInt16LE(4),3);
  for(const [index,size] of [16,32,48].entries()) {
    const entry=6+index*16,length=ico.readUInt32LE(entry+8),offset=ico.readUInt32LE(entry+12);
    assert.equal(ico[entry],size); assert.equal(ico[entry+1],size); assert.ok(offset+length<=ico.length);
    assert.deepEqual(pngSize(ico.subarray(offset,offset+length)),[size,size]);
  }
});

test("both HTML entry pages use versioned relative icon URLs that resolve inside the Pages subpath",async()=>{
  for(const page of ['reading-prototype.html','index.html']) {
    const html=await readFile(new URL(page,import.meta.url),'utf8');
    const links=[...html.matchAll(/<link\b[^>]*rel="(?:icon|shortcut icon|apple-touch-icon)"[^>]*href="([^"]+)"[^>]*>/g)];
    assert.equal(links.length,3);
    for(const [,href] of links) {
      const url=new URL(href,`https://example.com/readtrace-prototype/${page}`);
      assert.ok(url.pathname.startsWith('/readtrace-prototype/')); assert.ok(url.searchParams.has('v'));
      await bytes(`.${url.pathname.slice('/readtrace-prototype'.length)}`);
    }
  }
});

test("in-app mark is a lightweight export rather than another logo design",async()=>{
  const original=await bytes('./assets/readtrace-mark.png'),web=await bytes('./assets/readtrace-mark-web.png');
  assert.equal(pngSize(web)[0],160); assert.ok(web.length<original.length/10);
  const app=await readFile(new URL('./readtrace-app.mjs',import.meta.url),'utf8');
  assert.ok(app.includes('src="./assets/readtrace-mark-web.png"'));
});
