const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

function readPNG(file) {
  return new Promise((res, rej) => {
    fs.createReadStream(file)
      .pipe(new PNG())
      .on('parsed', function() { res(this); })
      .on('error', rej);
  });
}

async function main() {
  const dir = path.join(__dirname, '..', (process.argv[2] || 'frames'));
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.png')).sort();
  if (!files.length) { console.error('no frames found'); process.exit(1); }
  const diffs = [];
  let prev = null;
  for (let i = 0; i < files.length; i++) {
    const fp = path.join(dir, files[i]);
    const img = await readPNG(fp);
    if (prev) {
      let sum = 0;
      const a = img.data;
      const b = prev.data;
      for (let p = 0; p < a.length; p += 4) {
        sum += Math.abs(a[p] - b[p]);
        sum += Math.abs(a[p+1] - b[p+1]);
        sum += Math.abs(a[p+2] - b[p+2]);
      }
      const px = (img.width * img.height * 3);
      diffs.push({ file: files[i], index: i, mean: sum / px, sum });
    } else {
      diffs.push({ file: files[i], index: i, mean: 0, sum: 0 });
    }
    prev = img;
  }
  const fps = Number(process.argv[3] || 15); // frames per second used when extracting
  // print top peaks
  const peaks = diffs.slice().sort((a,b) => b.mean - a.mean).slice(0, 12);
  console.log('Top motion peaks (frame, time sec, mean diff):');
  peaks.forEach(p => console.log(`${p.index+1}	${((p.index)/fps).toFixed(3)}s	${p.mean.toFixed(2)}`));

  // also dump a CSV of all frames for plotting
  const out = diffs.map(d => `${d.index+1},${((d.index)/fps).toFixed(4)},${d.mean.toFixed(4)}`).join('\n');
  fs.writeFileSync(path.join(__dirname, '..', 'frames-diffs.csv'), out);
  console.log('wrote frames-diffs.csv');
}

main().catch(err => { console.error(err); process.exit(1); });
