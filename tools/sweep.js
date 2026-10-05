const S=require('../src/engine.js'),G=require('../src/sample.js');
let tp=0,fn=0,fp=0,statusWrong=0,amtWrong=0;const misses={},fps={};
const N=+process.argv[2]||100;
for(let seed=1;seed<=N;seed++){
  const g=G.generate({seed});const csv=S.parseCSV(g.csv);const m=S.guessMapping(csv.rows);
  const subs=S.detect(S.extractTransactions(csv.rows,m).transactions).subscriptions;
  const left=subs.slice();
  for(const t of g.truth){
    const i=left.findIndex(s=>s.key===t.key&&s.cadence===t.cadence&&(t.variable?s.variable:Math.abs(s.amount-t.amount)<=2));
    if(i<0){fn++;misses[t.name]=(misses[t.name]||0)+1;continue;}
    tp++;const s=left.splice(i,1)[0];
    if(s.active!==t.active){statusWrong++;}
  }
  for(const s of left){fp++;const k=s.name+' '+s.cadence+' '+(s.amount/100);fps[k]=(fps[k]||0)+1;}
}
console.log({N,tp,fn,fp,statusWrong,recall:(tp/(tp+fn)).toFixed(4),precision:(tp/(tp+fp)).toFixed(4)});
console.log('misses',misses);console.log('fps',Object.entries(fps).sort((a,b)=>b[1]-a[1]).slice(0,15));
