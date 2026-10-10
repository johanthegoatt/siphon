const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../src/engine.js");
const G = require("../src/sample.js");

const day = (iso) => S.parseDate(iso);

function run(csvText) {
  const csv = S.parseCSV(csvText);
  const mapping = S.guessMapping(csv.rows);
  assert.ok(mapping.ok, mapping.error);
  const tx = S.extractTransactions(csv.rows, mapping).transactions;
  return { mapping, tx, result: S.detect(tx) };
}

test("CSV parser handles quotes, embedded commas and newlines, BOM, CRLF", () => {
  const text = "﻿Date,Description,Amount\r\n2026-01-02,\"ACME, INC \"\"WEB\"\"\",-5.00\r\n2026-01-03,\"two\nlines\",-1\r\n";
  const { rows, delimiter } = S.parseCSV(text);
  assert.equal(delimiter, ",");
  assert.deepEqual(rows[1], ["2026-01-02", 'ACME, INC "WEB"', "-5.00"]);
  assert.equal(rows[2][1], "two\nlines");
  assert.equal(rows.length, 3);
});

test("delimiter sniffing picks semicolons and tabs", () => {
  assert.equal(S.sniffDelimiter("Datum;Omschrijving;Bedrag\n01-02-2026;Albert Heijn, Utrecht;-12,50\n"), ";");
  assert.equal(S.sniffDelimiter("Date\tPayee\tAmount\n2026-01-01\tNetflix\t-15.49\n"), "\t");
});

test("amounts: symbols, thousands, decimal commas, parentheses, DR/CR", () => {
  const cases = [
    ["$1,234.56", 123456], ["-12.99", -1299], ["(12.99)", -1299], ["1.234,56", 123456], ["12,99", 1299],
    ["12.99 DR", -1299], ["40.00 CR", 4000], ["€ 9,99", 999], ["1,234", 123400], ["−5.00", -500],
    ["PHP 1,499.00", 149900], ["12.99-", -1299], ["", null], ["n/a", null]
  ];
  for (const [input, want] of cases) assert.equal(S.parseAmount(input), want, input);
});

test("dates: ISO, US, day-first, month names, compact", () => {
  assert.equal(S.isoDay(S.parseDate("2026-10-05")), "2026-10-05");
  assert.equal(S.isoDay(S.parseDate("10/05/2026", "mdy")), "2026-10-05");
  assert.equal(S.isoDay(S.parseDate("05/10/2026", "dmy")), "2026-10-05");
  assert.equal(S.isoDay(S.parseDate("05 Oct 2026")), "2026-10-05");
  assert.equal(S.isoDay(S.parseDate("Oct 5, 2026")), "2026-10-05");
  assert.equal(S.isoDay(S.parseDate("5-Oct-26")), "2026-10-05");
  assert.equal(S.isoDay(S.parseDate("20261005")), "2026-10-05");
  assert.equal(S.isoDay(S.parseDate("2026-10-05T13:45:00Z")), "2026-10-05");
  assert.equal(S.parseDate("2026-02-30"), null);
  assert.equal(S.detectDateOrder(["03/04/2026", "25/04/2026"]), "dmy");
  assert.equal(S.detectDateOrder(["03/04/2026", "04/25/2026"]), "mdy");
  assert.equal(S.detectDateOrder(["01.08.2026", "01.09.2026", "01.10.2026"]), "dmy");
  assert.equal(S.detectDateOrder(["01/08/2026", "01/09/2026", "01/10/2026"]), "mdy");
  assert.equal(S.detectDateOrder(["12/01/2026", "05/02/2026", "11/02/2026", "03/03/2026"]), "dmy");
});

test("ambiguous day-first statement still finds a monthly charge", () => {
  const t = ["When;What;Value", "01.08.2026;SPOTIFY P1234;-11,99", "01.09.2026;SPOTIFY P5678;-11,99", "01.10.2026;SPOTIFY P9999;-11,99"].join("\n");
  const c = S.parseCSV(t);
  const m = S.guessMapping(c.rows);
  const subs = S.detect(S.extractTransactions(c.rows, m).transactions).subscriptions;
  assert.equal(subs.length, 1);
  assert.equal(subs[0].cadence, "monthly");
  assert.equal(subs[0].amount, 1199);
});

test("addMonths clamps to the end of shorter months", () => {
  assert.equal(S.isoDay(S.addMonths(day("2026-01-31"), 1)), "2026-02-28");
  assert.equal(S.isoDay(S.addMonths(day("2026-12-15"), 1)), "2027-01-15");
  assert.equal(S.isoDay(S.addMonths(day("2028-02-29"), 12)), "2029-02-28");
});

test("column mapping: card export with negative purchases and a post-date column", () => {
  const csv = [
    "Transaction Date,Post Date,Description,Category,Type,Amount,Memo",
    "09/28/2026,09/29/2026,NETFLIX.COM,Entertainment,Sale,-15.49,",
    "09/20/2026,09/21/2026,Payment Thank You-Mobile,,Payment,500.00,",
    "08/28/2026,08/29/2026,NETFLIX.COM,Entertainment,Sale,-15.49,"
  ].join("\n");
  const m = S.guessMapping(S.parseCSV(csv).rows);
  assert.equal(m.columns[m.map.date], "Transaction Date");
  assert.equal(m.columns[m.map.desc], "Description");
  assert.equal(m.columns[m.map.amount], "Amount");
  assert.equal(m.spendSign, "negative");
});

test("column mapping: positive charges, preamble lines and paid-out/paid-in columns", () => {
  const amex = "Date,Description,Amount\n09/28/2026,SPOTIFY USA,11.99\n09/12/2026,AUTOPAY PAYMENT - THANK YOU,-240.00\n09/02/2026,UBER TRIP,23.10\n";
  assert.equal(S.guessMapping(S.parseCSV(amex).rows).spendSign, "positive");

  const uk = [
    "Account,12345678", "Statement period,01/07/2026 - 30/09/2026", "",
    "Date,Type,Description,Paid out,Paid in,Balance",
    "25/09/2026,DD,SPOTIFY,11.99,,1200.00",
    "24/09/2026,BGC,SALARY,,2100.00,1211.99",
    "25/08/2026,DD,SPOTIFY,11.99,,1100.00"
  ].join("\n");
  const rows = S.parseCSV(uk).rows;
  const m = S.guessMapping(rows);
  assert.equal(m.dateOrder, "dmy");
  assert.equal(m.columns[m.map.debit], "Paid out");
  assert.equal(m.columns[m.map.credit], "Paid in");
  assert.equal(m.columns[m.map.desc], "Description");
  const tx = S.extractTransactions(rows, m).transactions;
  assert.equal(tx.length, 3);
  assert.deepEqual(tx.map((t) => t.spend), [1199, -210000, 1199]);
  assert.equal(S.isoDay(tx[0].day), "2026-09-25");
});

test("merchant names survive processor prefixes, references and store numbers", () => {
  assert.equal(S.merchantOf("PAYPAL *SPOTIFY P1A2B3C4").name, "Spotify");
  assert.equal(S.merchantOf("SQ *MAPLE LAWN CARE 4412 AUSTIN TX").key, S.merchantOf("SQ *MAPLE LAWN CARE 9981 AUSTIN TX").key);
  assert.equal(S.merchantOf("ZELLE PAYMENT TO OAKRIDGE PROPERTY MGMT JD82KQ1").name, "Oakridge Property");
  assert.equal(S.merchantOf("CITY OF AUSTIN WATER UTIL").name, "City of Austin");
  assert.equal(S.merchantOf("APPLE.COM/BILL 866-712-7753 CA").key, "B:Apple");
});

test("finds every planted recurring charge across 40 generated statements", () => {
  let found = 0, total = 0, extra = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const g = G.generate({ seed });
    const subs = run(g.csv).result.subscriptions.slice();
    for (const t of g.truth) {
      total++;
      const i = subs.findIndex((s) => s.key === t.key && s.cadence === t.cadence && (t.variable ? s.variable : Math.abs(s.amount - t.amount) <= 2));
      if (i >= 0) {
        found++;
        assert.equal(subs[i].active, t.active, `${t.name} status on seed ${seed}`);
        subs.splice(i, 1);
      }
    }
    extra += subs.length;
  }
  assert.equal(found, total);
  assert.ok(extra <= 2, `false positives: ${extra}`);
});

test("price rises, stopped subscriptions, two plans from one merchant", () => {
  const g = G.generate({ seed: 7 });
  const subs = run(g.csv).result.subscriptions;
  const netflix = subs.find((s) => s.name === "Netflix");
  assert.equal(netflix.priceDelta, 250);
  assert.equal(netflix.priceChanges.length, 1);
  assert.equal(netflix.amount, 1799);
  const hulu = subs.find((s) => s.name === "Hulu");
  assert.equal(hulu.active, false);
  assert.ok(hulu.missed >= 5);
  const apple = subs.filter((s) => s.key === "B:Apple").map((s) => s.amount).sort((a, b) => a - b);
  assert.deepEqual(apple, [299, 999]);
  assert.equal(subs.find((s) => s.name === "Amazon Prime").cadence, "annual");
  assert.ok(!subs.some((s) => /Starbucks|Kroger|Shell|Amzn/i.test(s.name)));
});

test("frequent same-price purchases are not mistaken for a weekly subscription", () => {
  const lines = ["Date,Description,Amount"];
  let d = day("2026-01-05");
  for (let i = 0; i < 120; i++) {
    if (i % 7 < 5 && i % 3 !== 1) lines.push(`${S.isoDay(d + i)},BLUE BOTTLE COFFEE #${100 + (i % 4)},-5.45`);
  }
  assert.equal(run(lines.join("\n")).result.subscriptions.length, 0);
});

test("a known service needs two monthly charges, an unknown one needs three", () => {
  const two = "Date,Description,Amount\n2026-08-14,DISNEY PLUS,-13.99\n2026-09-14,DISNEY PLUS,-13.99\n2026-09-20,PARK CAFE,-8.00\n";
  assert.equal(run(two).result.subscriptions.length, 1);
  const unknown = "Date,Description,Amount\n2026-08-14,RIVERSIDE STORAGE,-89.00\n2026-09-14,RIVERSIDE STORAGE,-89.00\n";
  assert.equal(run(unknown).result.subscriptions.length, 0);
  const unknown3 = unknown + "2026-10-14,RIVERSIDE STORAGE,-89.00\n";
  const r = run(unknown3).result.subscriptions;
  assert.equal(r.length, 1);
  assert.equal(r[0].name, "Riverside Storage");
  assert.equal(S.isoDay(r[0].next), "2026-11-14");
});

test("overlapping statements are merged without double counting", () => {
  const a = run("Date,Description,Amount\n2026-07-03,HULU,-7.99\n2026-08-03,HULU,-7.99\n2026-08-05,LUNCH,-9.00\n2026-08-05,LUNCH,-9.00\n").tx;
  const b = run("Date,Description,Amount\n2026-08-03,HULU,-7.99\n2026-08-05,LUNCH,-9.00\n2026-08-05,LUNCH,-9.00\n2026-09-03,HULU,-7.99\n").tx;
  const merged = S.mergeTransactions([a, b]);
  assert.equal(merged.filter((t) => t.desc === "HULU").length, 3);
  assert.equal(merged.filter((t) => t.desc === "LUNCH").length, 2);
});

test("summary, upcoming charges and decisions", () => {
  const g = G.generate({ seed: 7 });
  const subs = run(g.csv).result.subscriptions;
  const netflix = subs.find((s) => s.name === "Netflix");
  const sum = S.summarize(subs, { [netflix.id]: "cancel" });
  assert.equal(sum.cancelYearly, 1799 * 12);
  assert.equal(sum.stoppedCount, 1);
  assert.equal(sum.monthly, subs.filter((s) => s.active).reduce((a, s) => a + s.monthly, 0));
  const next = S.upcoming(subs, g.end, 31);
  assert.ok(next.length > 0);
  assert.ok(next.every((u) => u.day >= g.end && u.day <= g.end + 31));
  assert.ok(next.some((u) => u.sub.name === "Netflix"));
});

test("calendar export is valid iCalendar with folded lines and reminders", () => {
  const subs = run(G.generate({ seed: 3 }).csv).result.subscriptions.filter((s) => s.active);
  subs[0].name = "A very long merchant name, with commas; and semicolons " + "x".repeat(60);
  const ics = S.toICS(subs, { now: Date.UTC(2026, 9, 5) });
  assert.ok(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n"));
  assert.ok(ics.endsWith("END:VCALENDAR\r\n"));
  const lines = ics.split("\r\n");
  for (const l of lines) assert.ok(Buffer.byteLength(l) <= 75, l);
  assert.equal(lines.filter((l) => l === "BEGIN:VEVENT").length, subs.length);
  assert.ok(ics.includes("TRIGGER:-P3D"));
  assert.ok(ics.includes("RRULE:FREQ=MONTHLY"));
  const unfolded = ics.replace(/\r\n /g, "");
  assert.ok(unfolded.includes("commas\\; and semicolons"));
  assert.ok(unfolded.includes("name\\, with"));
});

test("CSV export neutralises spreadsheet formulas", () => {
  const out = S.toCSV([{ name: "=HYPERLINK(\"x\")", cadenceLabel: "Monthly", amount: 100, monthly: 100, yearly: 1200, first: 0, last: 30, next: 60, active: true, priceDelta: 0, count: 2, id: "x" }]);
  assert.ok(out.split("\r\n")[1].startsWith("\"'=HYPERLINK"));
});

test("a trial that turned paid is flagged, and so is a charge that just started", () => {
  const rows = ["Date,Description,Amount"];
  // Long history so "new" has something to be new against.
  for (let m = 1; m <= 9; m++) rows.push(`2026-0${m}-10,SPOTIFY USA,-11.99`);
  rows.push("2026-07-01,PELOTON* MEMBERSHIP,-1.00");
  rows.push("2026-07-31,PELOTON* MEMBERSHIP,-44.00", "2026-08-31,PELOTON* MEMBERSHIP,-44.00", "2026-09-30,PELOTON* MEMBERSHIP,-44.00");
  rows.push("2026-03-20,RIVERSIDE STORAGE,-89.00", "2026-04-20,RIVERSIDE STORAGE,-89.00", "2026-05-20,RIVERSIDE STORAGE,-89.00");
  const subs = run(rows.join("\n")).result.subscriptions;
  const p = subs.find((s) => /peloton/i.test(s.name));
  assert.ok(p, "found the paid run");
  assert.deepEqual(p.trial, { day: day("2026-07-01"), spend: 100 });
  assert.equal(p.isNew, true);
  const sp = subs.find((s) => /spotify/i.test(s.name));
  assert.equal(sp.trial, null);
  assert.equal(sp.isNew, false);
  const sum = S.summarize(subs, {});
  assert.equal(sum.newCount, 1);
});
