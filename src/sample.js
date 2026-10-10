(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./engine.js"));
  else root.SiphonSample = factory(root.Siphon);
})(typeof self !== "undefined" ? self : this, function (S) {
  "use strict";

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function weekdayOf(day) {
    return new Date(day * S.DAY_MS).getUTCDay();
  }

  function posted(day) {
    var w = weekdayOf(day);
    return w === 6 ? day + 2 : w === 0 ? day + 1 : day;
  }

  function monthStart(day) {
    var d = new Date(day * S.DAY_MS);
    return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / S.DAY_MS);
  }

  function onDayOfMonth(m0, monthOffset, dom) {
    var first = S.addMonths(m0, monthOffset);
    var d = new Date(first * S.DAY_MS);
    var last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    return first + Math.min(dom, last) - 1;
  }

  function ref(rand, n) {
    var a = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789", s = "";
    for (var i = 0; i < n; i++) s += a[Math.floor(rand() * a.length)];
    return s.replace(/^[A-Z]+$/, function (x) { return x.slice(0, -1) + "7"; });
  }

  function generate(opts) {
    opts = opts || {};
    var seed = opts.seed == null ? 7 : opts.seed;
    var rand = mulberry32(seed);
    var months = opts.months || 14;
    var endDay = opts.endDay == null ? Math.floor(Date.UTC(2026, 8, 30) / S.DAY_MS) : opts.endDay;
    var m0 = S.addMonths(monthStart(endDay), -(months - 1));
    var startDay = m0;
    var tx = [];
    var truth = [];
    function r(lo, hi) { return lo + rand() * (hi - lo); }
    function ri(lo, hi) { return Math.floor(r(lo, hi + 1)); }
    function cents(v) { return Math.round(v * 100); }
    function add(day, desc, spend) {
      if (day < startDay || day > endDay) return;
      tx.push({ day: day, desc: desc, spend: spend });
    }

    function monthly(name, key, dom, amountFor, descFor, fromMonth, toMonth, cadence) {
      for (var m = fromMonth; m <= toMonth && m < months; m++) add(posted(onDayOfMonth(m0, m, dom)), descFor(m), amountFor(m));
      truth.push({ name: name, key: key, cadence: cadence || "monthly", active: toMonth >= months - 1, amount: amountFor(Math.min(toMonth, months - 1)) });
    }

    monthly("Netflix", "B:Netflix", ri(3, 26), function (m) { return m >= 8 ? 1799 : 1549; }, function () { return "NETFLIX.COM 866-579-7172 CA"; }, 0, 99);
    monthly("Spotify", "B:Spotify", ri(1, 28), function () { return 1199; }, function () { return "SPOTIFY P" + ref(rand, 10) + " STOCKHOLM SE"; }, 0, 99);
    var appleDay = ri(5, 25);
    monthly("Apple (2.99)", "B:Apple", appleDay, function () { return 299; }, function () { return "APPLE.COM/BILL 866-712-7753 CA"; }, 0, 99);
    monthly("Apple (9.99)", "B:Apple", appleDay + ri(1, 3), function () { return 999; }, function () { return "APPLE.COM/BILL 866-712-7753 CA"; }, 2, 99);
    var gymDay = ri(1, 27);
    monthly("Planet Fitness", "B:Planet Fitness", gymDay, function () { return 2499; }, function () { return "PLANET FITNESS #0412 AUSTIN TX"; }, 0, 99);
    var hfStop = ri(4, 7);
    monthly("Hulu", "B:Hulu", ri(2, 26), function () { return 799; }, function () { return "HULU 877-8244858 CA"; }, 0, hfStop);
    monthly("T-Mobile", "B:T-Mobile", ri(10, 24), function () { return 8500; }, function () { return "T-MOBILE AUTOPAY PCS SVC"; }, 0, 99);
    monthly("Rent", "M:OAKRIDGE PROPERTY", 1, function () { return 185000; }, function () { return "ZELLE PAYMENT TO OAKRIDGE PROPERTY MGMT " + ref(rand, 8); }, 0, 99);
    var power = [];
    for (var pm = 0; pm < months; pm++) power.push(cents(r(78, 142)));
    monthly("City Power & Light", "M:CITY POWER", ri(8, 20), function (m) { return power[m]; }, function () { return "CITY POWER & LIGHT BILL PAY WEB ID " + ref(rand, 6); }, 0, 99);
    truth[truth.length - 1].variable = true;

    var feeDay = posted(onDayOfMonth(m0, 0, gymDay + 15 > 28 ? 28 : gymDay + 15));
    add(feeDay, "PLANET FIT ANNUAL FEE AUSTIN TX", 4900);
    add(posted(S.addMonths(feeDay, 12)), "PLANET FIT ANNUAL FEE AUSTIN TX", 4900);
    truth.push({ name: "Planet Fitness annual fee", key: "B:Planet Fitness", cadence: "annual", active: true, amount: 4900 });

    var primeDay = posted(onDayOfMonth(m0, 1, ri(1, 28)));
    add(primeDay, "AMAZON PRIME*" + ref(rand, 6) + " AMZN.COM/BILL WA", 13900);
    add(posted(S.addMonths(primeDay, 12)), "AMAZON PRIME*" + ref(rand, 6) + " AMZN.COM/BILL WA", 13900);
    truth.push({ name: "Amazon Prime", key: "B:Amazon Prime", cadence: "annual", active: true, amount: 13900 });

    var geico = posted(onDayOfMonth(m0, 0, ri(2, 26)));
    for (var g = 0; g < 3; g++) add(posted(S.addMonths(geico, 6 * g)), "GEICO *AUTO 800-841-3000 DC", 61240);
    truth.push({ name: "Geico", key: "B:Geico", cadence: "semiannual", active: true, amount: 61240 });

    var water = onDayOfMonth(m0, 0, ri(5, 20));
    for (var w = 0; w < 5; w++) add(posted(S.addMonths(water, 3 * w)), "CITY OF AUSTIN WATER UTIL", 9630);
    truth.push({ name: "City water", key: "M:CITY AUSTIN", cadence: "quarterly", active: true, amount: 9630 });

    var hf = startDay + 40 + ri(0, 6);
    while (hf <= endDay) { add(hf, "HELLOFRESH 646-846-3663 NY", 7192); hf += 7; }
    truth.push({ name: "HelloFresh", key: "B:HelloFresh", cadence: "weekly", active: true, amount: 7192 });

    var dog = startDay + ri(0, 13);
    while (dog <= endDay) { add(dog, "GREENLEAF DOG WALKING LLC", 18000); dog += 14; }
    truth.push({ name: "Greenleaf Dog Walking", key: "M:GREENLEAF DOG", cadence: "biweekly", active: true, amount: 18000 });

    add(posted(onDayOfMonth(m0, ri(2, 8), ri(1, 28))), "DUOLINGO PLUS ANNUAL", 8499);

    // A $0.99 first month that rolled into the full price three months ago.
    var trialDom = ri(1, 26);
    add(posted(onDayOfMonth(m0, months - 4, trialDom)), "AUDIBLE*" + ref(rand, 6) + " AMZN.COM/BILL NJ", 99);
    monthly("Audible", "B:Audible", trialDom, function () { return 1495; }, function () { return "AUDIBLE*" + ref(rand, 6) + " AMZN.COM/BILL NJ"; }, months - 3, 99);

    var pay = startDay + ri(0, 13);
    while (pay <= endDay) { add(posted(pay), "ACME CORP PAYROLL DIR DEP", -245000); pay += 14; }

    var stores = ["0412", "1187"];
    var places = ["CHIPOTLE 2291", "SHAKE SHACK 1043", "TST* JOE'S PIZZA", "SQ *TACO TRUCK", "PANERA BREAD #6021", "THAI KITCHEN", "SUSHI ZEN", "DOMINO'S 7745"];
    for (var d = startDay; d <= endDay; d++) {
      var wd = weekdayOf(d);
      if (rand() < 0.32) add(d, "KROGER #" + ri(300, 899) + " AUSTIN TX", cents(r(18, 160)));
      if (wd >= 1 && wd <= 5 && rand() < 0.55) add(d, "STARBUCKS STORE " + stores[ri(0, 1)] + " AUSTIN TX", 545);
      if (rand() < 0.15) add(d, "SHELL OIL " + ri(10000000, 99999999) + " AUSTIN TX", cents(r(32, 61)));
      if (rand() < 0.2) add(d, "AMZN MKTP US*" + ref(rand, 9) + " AMZN.COM/BILL WA", cents(r(8, 95)));
      if (rand() < 0.18) add(d, places[ri(0, places.length - 1)] + " AUSTIN TX", cents(r(11, 64)));
      if (rand() < 0.03) add(d, "VENMO PAYMENT " + ri(1000000000, 9999999999), cents(r(10, 120)));
      if (rand() < 0.01) add(d, "VENMO CASHOUT", -cents(r(20, 200)));
    }
    add(startDay + ri(30, 300), "BEST BUY 00012345 AUSTIN TX", 34999);

    tx.sort(function (a, b) { return b.day - a.day || a.desc.localeCompare(b.desc); });
    var balance = 820000;
    var lines = ["Date,Description,Amount,Balance"];
    var asc = tx.slice().reverse();
    var bal = {};
    asc.forEach(function (t, i) { balance -= t.spend; bal[i] = balance; });
    tx.forEach(function (t, i) {
      var b = bal[asc.length - 1 - i];
      var iso = S.isoDay(t.day).split("-");
      var desc = /[",]/.test(t.desc) ? '"' + t.desc.replace(/"/g, '""') + '"' : t.desc;
      lines.push(iso[1] + "/" + iso[2] + "/" + iso[0] + "," + desc + "," + (-t.spend / 100).toFixed(2) + "," + (b / 100).toFixed(2));
    });
    return { csv: lines.join("\n") + "\n", truth: truth, start: startDay, end: endDay, count: tx.length };
  }

  return { generate: generate, mulberry32: mulberry32 };
});
