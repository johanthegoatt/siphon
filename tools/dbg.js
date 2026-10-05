const S=require('../src/engine.js'),G=require('../src/sample.js');
const seed=+process.argv[2]||7;
const g=G.generate({seed});
const csv=S.parseCSV(g.csv);const m=S.guessMapping(csv.rows);
console.log(JSON.stringify({map:m.map,order:m.dateOrder,sign:m.spendSign,cur:m.currency,header:m.headerRow}));
const tx=S.extractTransactions(csv.rows,m).transactions;
const r=S.detect(tx);
for(const s of r.subscriptions) console.log(s.name.padEnd(22),s.cadence.padEnd(10),(s.amount/100).toFixed(2).padStart(9),s.count,s.active?'active':'stopped',s.variable?'var':'',s.priceDelta,s.confidence, s.key);
console.log('truth:');for(const t of g.truth) console.log(' ',t.name,t.key,t.cadence,t.amount);
