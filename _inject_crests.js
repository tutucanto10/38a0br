const fs=require('fs');
const path=require('path');

const dir='C:/Users/Domma 55/38a0br/crests';
const htmlPath='C:/Users/Domma 55/38a0br/index.html';

// Build CRESTS object
const obj={};
fs.readdirSync(dir).filter(f=>f.endsWith('.png')||f.endsWith('.svg')).forEach(f=>{
  const slug=f.replace(/\.(png|svg)$/,'');
  const ext=f.endsWith('.svg')?'svg':'png';
  const mime=ext==='svg'?'image/svg+xml':'image/png';
  const buf=fs.readFileSync(path.join(dir,f));
  obj[slug]='data:'+mime+';base64,'+buf.toString('base64');
});

const crestsJs='const CRESTS='+JSON.stringify(obj)+';';

let html=fs.readFileSync(htmlPath,'utf-8');

// 1. Inject CRESTS before slugify
const slugifyMarker='function slugify(s){';
if(!html.includes(slugifyMarker)){console.error('slugify not found');process.exit(1);}
html=html.replace(slugifyMarker, crestsJs+'\n'+slugifyMarker);

// 2. Replace crestImg to use data URLs (no file path needed)
// Find the function and replace it
const oldFn='function crestImg(time, size=28){\n  if(!time) return \'\';\n  const slug=slugify(time);\n  return `<img src="crests/${slug}.png" width="${size}" height="${size}" class="crest-img" style="margin-right:${Math.round(size/4)}px" onerror="this.onerror=function(){this.style.display=\'none\'};this.src=\'crests/${slug}.svg\'">`;';

const newFn='function crestImg(time, size=28){\n  if(!time) return \'\';\n  const slug=slugify(time);\n  const src=CRESTS[slug];\n  if(!src) return \'\';\n  return `<img src="${src}" width="${size}" height="${size}" class="crest-img" style="margin-right:${Math.round(size/4)}px">`;';

if(html.includes(oldFn)){
  html=html.replace(oldFn, newFn);
  console.log('crestImg updated');
} else {
  // Try to find and replace just the return line
  const oldReturn='  return `<img src="crests/${slug}.png" width="${size}" height="${size}" class="crest-img" style="margin-right:${Math.round(size/4)}px" onerror="this.onerror=function(){this.style.display=\'none\'};this.src=\'crests/${slug}.svg\'">`;';
  const newReturn='  const src=CRESTS[slug];\n  if(!src) return \'\';\n  return `<img src="${src}" width="${size}" height="${size}" class="crest-img" style="margin-right:${Math.round(size/4)}px">`;';
  if(html.includes(oldReturn)){
    html=html.replace(oldReturn, newReturn);
    console.log('crestImg return line updated');
  } else {
    console.error('Could not find crestImg return. Searching...');
    const idx=html.indexOf('function crestImg');
    console.log('crestImg at:', idx, html.slice(idx, idx+200));
    process.exit(1);
  }
}

fs.writeFileSync(htmlPath, html);
console.log('Done. HTML size:', (html.length/1024/1024).toFixed(2),'MB');
