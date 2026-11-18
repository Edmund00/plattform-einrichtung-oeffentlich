// K3 N2: serverlose CSS-Vertraege und echter Scrollhelfer.
import {readFileSync as read} from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
const css=read('public/kunde.css','utf8'), shop=read('public/kunde.js','utf8');
assert.match(css,/h1\[tabindex="-1"\]:focus,h2\[tabindex="-1"\]:focus,h3\[tabindex="-1"\]:focus\{outline:none\}/);
// Alle vorhandenen focus-visible-Regeln bleiben bytegleich zum Abgabestand.
const fokus=s=>s.match(/[^{}\r\n]*:focus-visible[^{}]*\{[^}]*\}/g);
assert.equal(createHash('sha256').update(fokus(css).join('\n')).digest('hex'),'60ab59390c3863712d1c6a45f407818140df9ccd95128f11348a0d5ed145a8ab');
assert.match(css,/\.k3-chips\{mask-image:linear-gradient/);
assert.match(css,/\.k3-chips\.k3-chips-ende\{mask-image:none;-webkit-mask-image:none\}/);
assert.match(css,/\.k3-chips\{[^}]*overflow-x:auto/);
assert.match(css,/\.k3-chips a\{[^}]*min-height:44px/);
assert.match(shop,/onscroll:e => k3ChipsEnde\(e.currentTarget\)/);
assert.match(shop,/app.replaceChildren[^\n]*\n\s*document.querySelectorAll\('\.k3-chips'\).forEach\(k3ChipsEnde\)/);
assert.match(shop,/window.addEventListener\('resize',.*forEach\(k3ChipsEnde\)/);
const start=shop.indexOf('function k3ChipsEnde('), end=shop.indexOf('\n}',start)+2;
const c=vm.createContext({});vm.runInContext(shop.slice(start,end),c);
let ende;
const chips={scrollLeft:0,clientWidth:331,scrollWidth:2123,classList:{toggle(name,on){assert.equal(name,'k3-chips-ende');ende=on;}}};
for(const [left,width,total,expected] of [[0,331,2123,false],[1000,331,2123,false],[1792,331,2123,true],[1791.5,331,2123,true],[0,331,331,true],[0,2400,2123,true],[0,331,2123,false]]){
 Object.assign(chips,{scrollLeft:left,clientWidth:width,scrollWidth:total});c.k3ChipsEnde(chips);assert.equal(ende,expected);
}
for(const path of ['public/kunde.js','public/kunde.css'])assert.ok(!/(?<!\r)\n/.test(read(path,'utf8')),path+' CRLF');
console.log('K3 N2: Fokusregeln, Fade, Initialisierung/Resize und Scrollende bestanden.');
