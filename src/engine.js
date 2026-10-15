(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Siphon = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var DAY_MS = 86400000;
  var MONTHS = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, SEPT: 9, OCT: 10, NOV: 11, DEC: 12 };

  function sniffDelimiter(text) {
    var lines = text.split(/\r?\n/).filter(function (l) { return l.trim() !== ""; }).slice(0, 30);
    var best = ",", bestScore = -1;
    [",", ";", "\t", "|"].forEach(function (d) {
      var counts = lines.map(function (l) { return countOutsideQuotes(l, d); });
      var freq = {};
      counts.forEach(function (c) { if (c > 0) freq[c] = (freq[c] || 0) + 1; });
      var mode = 0, modeN = 0;
      Object.keys(freq).forEach(function (k) { if (freq[k] > modeN || (freq[k] === modeN && +k > mode)) { mode = +k; modeN = freq[k]; } });
      var score = modeN * 100 + mode;
      if (modeN > 0 && score > bestScore) { best = d; bestScore = score; }
    });
    return best;
  }

  function countOutsideQuotes(line, d) {
    var n = 0, q = false;
    for (var i = 0; i < line.length; i++) {
      var c = line[i];
      if (c === '"') q = !q;
      else if (c === d && !q) n++;
    }
    return n;
  }

  function parseCSV(text) {
    text = String(text || "").replace(/^\uFEFF/, "");
    var delim = sniffDelimiter(text);
    var rows = [], row = [], field = "", q = false, i = 0, started = false;
    while (i < text.length) {
      var c = text[i];
      if (q) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          q = false; i++; continue;
        }
        field += c; i++; continue;
      }
      if (c === '"' && field.trim() === "") { q = true; field = ""; started = true; i++; continue; }
      if (c === delim) { row.push(field); field = ""; started = true; i++; continue; }
      if (c === "\r" || c === "\n") {
        row.push(field); rows.push(row); row = []; field = ""; started = false;
        if (c === "\r" && text[i + 1] === "\n") i++;
        i++; continue;
      }
      field += c; started = true; i++;
    }
    if (started || row.length) { row.push(field); rows.push(row); }
    rows = rows
      .map(function (r) { return r.map(function (s) { return s.trim(); }); })
      .filter(function (r) { return r.some(function (s) { return s !== ""; }); });
    return { delimiter: delim, rows: rows };
  }

  function dayFromYMD(y, m, d) {
    if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 1900 && y <= 2200)) return null;
    var t = Date.UTC(y, m - 1, d);
    var back = new Date(t);
    if (back.getUTCDate() !== d) return null;
    return Math.floor(t / DAY_MS);
  }

  function fullYear(y) {
    y = +y;
    return y < 100 ? 2000 + y : y;
  }

  function dateParts(s) {
    s = String(s || "").trim().toUpperCase();
    if (!s) return null;
    var m;
    if ((m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})(?:[T\s].*)?$/))) return { kind: "ymd", a: +m[1], b: +m[2], c: +m[3] };
    if ((m = s.match(/^(\d{4})(\d{2})(\d{2})$/))) return { kind: "ymd", a: +m[1], b: +m[2], c: +m[3] };
    if ((m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2}|\d{4})(?:\s.*)?$/))) return { kind: "xy", a: +m[1], b: +m[2], c: fullYear(m[3]) };
    if ((m = s.match(/^(\d{1,2})[-\s\/.]?([A-Z]{3,4})[A-Z]*\.?[-\s\/.,]*(\d{2}|\d{4})(?:\s.*)?$/)) && MONTHS[m[2]]) return { kind: "ymd", a: fullYear(m[3]), b: MONTHS[m[2]], c: +m[1] };
    if ((m = s.match(/^([A-Z]{3,4})[A-Z]*\.?[-\s\/.]*(\d{1,2})(?:ST|ND|RD|TH)?,?[-\s\/.]*(\d{2}|\d{4})(?:\s.*)?$/)) && MONTHS[m[1]]) return { kind: "ymd", a: fullYear(m[3]), b: MONTHS[m[1]], c: +m[2] };
    return null;
  }

  function detectDateOrder(values) {
    var dmy = false, mdy = false;
    values.forEach(function (v) {
      var p = dateParts(v);
      if (!p || p.kind !== "xy") return;
      if (p.a > 12) dmy = true;
      if (p.b > 12) mdy = true;
    });
    if (dmy && !mdy) return "dmy";
    if (mdy) return "mdy";
    var a = orderBreaks(values, "mdy"), b = orderBreaks(values, "dmy");
    if (a !== b) return b < a ? "dmy" : "mdy";
    var dotted = values.some(function (v) { return /^\s*\d{1,2}\.\d{1,2}\.\d{2,4}\s*$/.test(String(v || "")); });
    return dotted ? "dmy" : "mdy";
  }

  function orderBreaks(values, order) {
    var days = values.map(function (v) { return parseDate(v, order); }).filter(function (d) { return d != null; });
    var up = 0, down = 0;
    for (var i = 1; i < days.length; i++) {
      if (days[i] > days[i - 1]) up++;
      else if (days[i] < days[i - 1]) down++;
    }
    return Math.min(up, down);
  }

  function parseDate(s, order) {
    var p = dateParts(s);
    if (!p) return null;
    if (p.kind === "ymd") return dayFromYMD(p.a, p.b, p.c);
    if (order === "dmy") return dayFromYMD(p.c, p.b, p.a);
    return dayFromYMD(p.c, p.a, p.b);
  }

  var AMOUNT_RE = /^\(?\s*[-\u2212+]?\s*(?:[A-Z]{3}\s?|[$\u20ac\u00a3\u20b1\u00a5\u20b9]|R\$|A\$|C\$|US\$)?\s*[-\u2212+]?\s*\d[\d.,' ]*\s*(?:[A-Z]{3})?\s*\)?\s*(?:CR|DR)?\.?\s*[-\u2212]?$/i;

  function isAmountLike(s) {
    s = String(s || "").trim();
    return s !== "" && AMOUNT_RE.test(s) && /\d/.test(s);
  }

  function parseAmount(s) {
    if (s == null) return null;
    var t = String(s).trim();
    if (!t || !/\d/.test(t)) return null;
    var neg = false;
    if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1); }
    if (/(?:^|[\s\d])DR\.?$/i.test(t)) { neg = !neg; t = t.replace(/DR\.?$/i, ""); }
    else if (/(?:^|[\s\d])CR\.?$/i.test(t)) t = t.replace(/CR\.?$/i, "");
    t = t.replace(/[^\d.,\-\u2212+']/g, "").replace(/'/g, "");
    if (/^[-\u2212]|[-\u2212]$/.test(t)) neg = !neg;
    t = t.replace(/[-\u2212+]/g, "");
    if (!/\d/.test(t)) return null;
    var lastDot = t.lastIndexOf("."), lastComma = t.lastIndexOf(",");
    if (lastDot > -1 && lastComma > -1) {
      if (lastComma > lastDot) t = t.replace(/\./g, "").replace(",", ".");
      else t = t.replace(/,/g, "");
    } else if (lastComma > -1) {
      var commas = (t.match(/,/g) || []).length;
      if (commas === 1 && t.length - lastComma - 1 !== 3) t = t.replace(",", ".");
      else t = t.replace(/,/g, "");
    } else if ((t.match(/\./g) || []).length > 1) {
      t = t.replace(/\./g, "");
    }
    var v = parseFloat(t);
    if (!isFinite(v)) return null;
    var cents = Math.round(v * 100);
    return neg ? -cents : cents;
  }

  var CURRENCY_SIGNS = [
    [/\u20b1|\bPHP\b/, "PHP"], [/\u20ac|\bEUR\b/, "EUR"], [/\u00a3|\bGBP\b/, "GBP"], [/\u20b9|\bINR\b/, "INR"],
    [/\u00a5|\bJPY\b/, "JPY"], [/A\$|\bAUD\b/, "AUD"], [/C\$|\bCAD\b/, "CAD"], [/R\$|\bBRL\b/, "BRL"], [/\$|\bUSD\b/, "USD"]
  ];

  function detectCurrency(samples) {
    var joined = samples.join(" ").toUpperCase();
    for (var i = 0; i < CURRENCY_SIGNS.length; i++) if (CURRENCY_SIGNS[i][0].test(joined)) return CURRENCY_SIGNS[i][1];
    return "";
  }

  var HEADER_HINTS = {
    date: /^(transaction |trans\.? |txn |booking |value |posted |posting |effective )?date|^date|^when$|^time$/i,
    desc: /desc|payee|merchant|narrat|particular|details|memo|^name$|counterpart|beneficiar|reference|^transaction$|^description/i,
    amount: /^(transaction |txn )?amount|^amt$|^value$|^sum$|^betrag|^montant|^importe|amount$/i,
    debit: /debit|withdraw|paid out|money out|outflow|^out$|spent|^charges?$|payments?$/i,
    credit: /credit|deposit|paid in|money in|inflow|^in$|received/i,
    skip: /balance|running|saldo|category|type|status|card|account|check|cheque/i
  };

  function guessMapping(rows) {
    var width = mostCommonWidth(rows);
    var dataStart = -1;
    for (var r = 0; r < rows.length; r++) {
      if (rows[r].length < Math.min(width, 2)) continue;
      var hasDate = rows[r].some(function (c) { return dateParts(c); });
      var hasAmt = rows[r].some(function (c) { return isAmountLike(c) && !dateParts(c); });
      if (hasDate && hasAmt) { dataStart = r; break; }
    }
    if (dataStart < 0) return { ok: false, error: "No rows with both a date and an amount were found." };
    var headerRow = null;
    for (var h = dataStart - 1; h >= 0; h--) {
      if (rows[h].length >= 2 && !rows[h].some(function (c) { return dateParts(c); })) { headerRow = h; break; }
    }
    var header = headerRow == null ? [] : rows[headerRow];
    var data = rows.slice(dataStart).filter(function (rw) { return rw.length >= 2; });
    var cols = Math.max(width, header.length);
    var names = [];
    for (var c = 0; c < cols; c++) names.push(header[c] && header[c].trim() ? header[c].trim() : "Column " + (c + 1));

    var stats = names.map(function (_, ci) {
      var n = 0, dates = 0, amts = 0, filled = 0, len = 0, neg = 0, letters = 0;
      data.slice(0, 400).forEach(function (rw) {
        var v = rw[ci] == null ? "" : rw[ci];
        n++;
        if (v === "") return;
        filled++;
        len += v.length;
        if (dateParts(v)) dates++;
        else if (isAmountLike(v)) { amts++; if ((parseAmount(v) || 0) < 0) neg++; }
        if (/[A-Za-z]{3,}/.test(v)) letters++;
      });
      return { n: n, filled: filled, dateRate: dates / Math.max(1, filled), amtRate: amts / Math.max(1, filled), fillRate: filled / Math.max(1, n), avgLen: len / Math.max(1, filled), textRate: letters / Math.max(1, filled), neg: neg };
    });

    function pick(test, cands) {
      for (var i = 0; i < cands.length; i++) if (test(cands[i])) return cands[i];
      return -1;
    }
    var idx = names.map(function (_, i) { return i; });
    var map = { date: -1, desc: -1, amount: -1, debit: -1, credit: -1 };

    map.date = pick(function (i) { return /^(transaction |trans\.? |txn |booking )?date$|^date$/i.test(names[i]) && stats[i].dateRate > 0.6; }, idx);
    if (map.date < 0) map.date = pick(function (i) { return HEADER_HINTS.date.test(names[i]) && stats[i].dateRate > 0.6; }, idx);
    if (map.date < 0) {
      var bestD = -1, bestR = 0.6;
      idx.forEach(function (i) { if (stats[i].dateRate > bestR) { bestR = stats[i].dateRate; bestD = i; } });
      map.date = bestD;
    }

    var numeric = idx.filter(function (i) { return i !== map.date && stats[i].amtRate > 0.8 && !HEADER_HINTS.skip.test(names[i]) && !HEADER_HINTS.desc.test(names[i]); });
    map.amount = pick(function (i) { return HEADER_HINTS.amount.test(names[i]) && stats[i].fillRate > 0.8; }, numeric);
    if (map.amount < 0) {
      map.debit = pick(function (i) { return HEADER_HINTS.debit.test(names[i]); }, numeric.concat(idx.filter(function (i) { return HEADER_HINTS.debit.test(names[i]) && i !== map.date; })));
      map.credit = pick(function (i) { return HEADER_HINTS.credit.test(names[i]) && i !== map.debit; }, numeric.concat(idx.filter(function (i) { return HEADER_HINTS.credit.test(names[i]) && i !== map.date; })));
      if (map.debit < 0) {
        var full = numeric.filter(function (i) { return stats[i].fillRate > 0.9; });
        if (full.length) map.amount = full[0];
        else if (numeric.length >= 2) { map.debit = numeric[0]; map.credit = numeric[1]; }
        else if (numeric.length === 1) map.amount = numeric[0];
      }
    }

    var used = [map.date, map.amount, map.debit, map.credit];
    map.desc = pick(function (i) { return used.indexOf(i) < 0 && /^(description|desc|payee|merchant|merchant name|details|narrative|particulars|transaction details|name)$/i.test(names[i]); }, idx);
    if (map.desc < 0) map.desc = pick(function (i) { return used.indexOf(i) < 0 && HEADER_HINTS.desc.test(names[i]) && stats[i].textRate > 0.5; }, idx);
    if (map.desc < 0) {
      var bestT = -1, bestScore = 0;
      idx.forEach(function (i) {
        if (used.indexOf(i) >= 0) return;
        var s = stats[i].textRate * stats[i].avgLen * stats[i].fillRate;
        if (s > bestScore) { bestScore = s; bestT = i; }
      });
      map.desc = bestT;
    }

    var order = detectDateOrder(data.map(function (rw) { return map.date >= 0 ? rw[map.date] : ""; }));
    var currency = detectCurrency(data.slice(0, 200).map(function (rw) {
      return [map.amount, map.debit, map.credit].filter(function (i) { return i >= 0; }).map(function (i) { return rw[i] || ""; }).join(" ");
    }).concat(names));

    var ok = map.date >= 0 && map.desc >= 0 && (map.amount >= 0 || map.debit >= 0);
    return {
      ok: ok,
      error: ok ? null : "Could not tell which columns hold the date, description and amount.",
      headerRow: headerRow,
      dataStart: dataStart,
      columns: names,
      map: map,
      dateOrder: order,
      currency: currency,
      spendSign: guessSpendSign(data, map)
    };
  }

  function mostCommonWidth(rows) {
    var f = {}, best = 0, bestN = 0;
    rows.forEach(function (r) { f[r.length] = (f[r.length] || 0) + 1; });
    Object.keys(f).forEach(function (k) { if (+k >= 2 && (f[k] > bestN || (f[k] === bestN && +k > best))) { best = +k; bestN = f[k]; } });
    return best || 2;
  }

  function guessSpendSign(data, map) {
    if (map.amount < 0) return "debit";
    var pos = 0, neg = 0;
    data.forEach(function (rw) {
      var v = parseAmount(rw[map.amount]);
      if (v == null || v === 0) return;
      if (v < 0) neg++; else pos++;
    });
    return neg >= pos ? "negative" : "positive";
  }

  function extractTransactions(rows, mapping, fileId) {
    var m = mapping.map, out = [], skipped = 0;
    var start = mapping.dataStart == null ? 0 : mapping.dataStart;
    for (var r = start; r < rows.length; r++) {
      var rw = rows[r];
      if (mapping.headerRow != null && r === mapping.headerRow) continue;
      var day = parseDate(rw[m.date], mapping.dateOrder);
      if (day == null) { skipped++; continue; }
      var spend = null;
      if (m.amount >= 0) {
        var v = parseAmount(rw[m.amount]);
        if (v == null) { skipped++; continue; }
        spend = mapping.spendSign === "positive" ? v : -v;
      } else {
        var d = m.debit >= 0 ? parseAmount(rw[m.debit]) : null;
        var c = m.credit >= 0 ? parseAmount(rw[m.credit]) : null;
        if (d == null && c == null) { skipped++; continue; }
        spend = (d ? Math.abs(d) : 0) - (c ? Math.abs(c) : 0);
      }
      var desc = (rw[m.desc] || "").replace(/\s+/g, " ").trim();
      out.push({ day: day, desc: desc, spend: spend, file: fileId || 0 });
    }
    return { transactions: out, skipped: skipped };
  }

  function mergeTransactions(lists) {
    var maxCount = {}, byKey = {};
    lists.forEach(function (list) {
      var local = {};
      list.forEach(function (t) {
        var k = t.day + "|" + t.spend + "|" + t.desc.toUpperCase();
        local[k] = (local[k] || 0) + 1;
        if (!byKey[k]) byKey[k] = [];
        if (byKey[k].length < local[k]) byKey[k].push(t);
      });
      Object.keys(local).forEach(function (k) { maxCount[k] = Math.max(maxCount[k] || 0, local[k]); });
    });
    var out = [];
    Object.keys(byKey).forEach(function (k) { out = out.concat(byKey[k].slice(0, maxCount[k])); });
    out.sort(function (a, b) { return a.day - b.day || a.desc.localeCompare(b.desc); });
    return out;
  }

  var BRANDS = [
    ["Netflix", /NETFLIX/], ["Spotify", /SPOTIFY/], ["Hulu", /\bHULU/], ["Disney+", /DISNEY ?(PLUS|\+)|DISNEYPLUS/],
    ["Max", /\bHBO ?MAX|\bMAX\.COM|\bHBO\b/], ["YouTube Premium", /YOUTUBE ?(PREMIUM|MUSIC|MEMBER)/], ["YouTube TV", /YOUTUBE ?TV|YOUTUBETV/],
    ["Apple", /APPLE\.COM|APPLE COM BILL|ITUNES/], ["iCloud", /ICLOUD/], ["Amazon Prime", /AMAZON PRIME|PRIME VIDEO|AMZN PRIME|PRIME MEMBERSHIP/],
    ["Audible", /AUDIBLE/], ["Kindle Unlimited", /KINDLE UNL/], ["Paramount+", /PARAMOUNT/], ["Peacock", /PEACOCK/],
    ["Crunchyroll", /CRUNCHYROLL/], ["Dropbox", /DROPBOX/], ["Google One", /GOOGLE ?(ONE|STORAGE)/], ["Google Workspace", /GSUITE|GOOGLE ?WORKSPACE/],
    ["Microsoft 365", /MICROSOFT ?(365|OFFICE)|MSFT ?\*|MS 365/], ["Xbox", /XBOX/], ["PlayStation", /PLAYSTATION|\bPSN\b|SONY ?INTERACTIVE/],
    ["Nintendo", /NINTENDO/], ["Adobe", /ADOBE/], ["Canva", /CANVA/], ["Notion", /NOTION/], ["ChatGPT", /OPENAI|CHATGPT/],
    ["GitHub", /GITHUB/], ["Figma", /FIGMA/], ["Slack", /SLACK/], ["Zoom", /ZOOM\.US|ZOOM VIDEO|\bZOOM\b/], ["LinkedIn", /LINKEDIN/],
    ["Duolingo", /DUOLINGO/], ["Headspace", /HEADSPACE/], ["Calm", /\bCALM\.COM|\bCALM\b/], ["Peloton", /PELOTON/],
    ["Planet Fitness", /PLANET ?FIT/], ["Patreon", /PATREON/], ["Substack", /SUBSTACK/], ["New York Times", /NYTIMES|NY TIMES|NEW YORK TIMES/],
    ["Wall Street Journal", /\bWSJ\b|WALL ?ST(REET)? ?JOURNAL|DOW JONES/], ["Medium", /MEDIUM\.COM|\bMEDIUM\b/], ["Grammarly", /GRAMMARLY/],
    ["NordVPN", /NORDVPN|NORD ?SEC/], ["ExpressVPN", /EXPRESSVPN/], ["1Password", /1PASSWORD|AGILEBITS/], ["LastPass", /LASTPASS/],
    ["Evernote", /EVERNOTE/], ["Tidal", /\bTIDAL\b/], ["Deezer", /DEEZER/], ["SiriusXM", /SIRIUS/], ["Pandora", /PANDORA/],
    ["HelloFresh", /HELLO ?FRESH/], ["Tinder", /TINDER/], ["Bumble", /BUMBLE/], ["Hinge", /\bHINGE\b/], ["Uber One", /UBER ?ONE/],
    ["DashPass", /DASHPASS|DOORDASH ?DASHPASS/], ["Instacart+", /INSTACART ?\+|INSTACART ?PLUS|INSTACART MEMBER/], ["Walmart+", /WALMART ?(\+|PLUS)/],
    ["Costco", /COSTCO ?(MEMBER|ANNUAL)/], ["Verizon", /VERIZON/], ["T-Mobile", /T-?MOBILE/], ["AT&T", /\bAT ?& ?T\b|\bATT\b/],
    ["Xfinity", /XFINITY|COMCAST/], ["Spectrum", /SPECTRUM/], ["Geico", /GEICO/], ["Progressive", /PROGRESSIVE/], ["State Farm", /STATE ?FARM/],
    ["PLDT", /\bPLDT\b/], ["Globe", /\bGLOBE ?(TELECOM|POSTPAID|AT HOME)?\b/], ["Smart", /\bSMART ?(COMM|POSTPAID)/], ["Converge", /CONVERGE/],
    ["Viu", /\bVIU\b/], ["iWantTFC", /IWANT/], ["Twitch", /TWITCH/], ["Discord Nitro", /DISCORD/], ["X Premium", /X CORP|TWITTER/],
    ["Quizlet", /QUIZLET/], ["Chegg", /CHEGG/], ["Skillshare", /SKILLSHARE/], ["MasterClass", /MASTERCLASS/], ["Strava", /STRAVA/],
    ["Fitbit Premium", /FITBIT/], ["Noom", /\bNOOM\b/], ["WW", /WEIGHTWATCHERS|WW INTL/], ["Ring", /\bRING\b.*(PROTECT|PLAN)|RING\.COM/],
    ["SimpliSafe", /SIMPLISAFE/], ["ADT", /\bADT\b/], ["Squarespace", /SQUARESPACE/], ["Wix", /\bWIX\b/], ["GoDaddy", /GODADDY/],
    ["Shopify", /SHOPIFY/], ["Mailchimp", /MAILCHIMP/], ["Backblaze", /BACKBLAZE/], ["Proton", /PROTON ?(MAIL|AG|VPN)/]
  ];

  var PROCESSOR_PREFIX = /^(?:SQ|TST|SP|PP|PAYPAL|PY|IN|FS|EB|SMP|GOOGLE|CKO|PADDLE|2CO|FASTSPRING|STRIPE|DRI|WL|BT|LS)\s?\*\s*/;
  var NOISE = /\b(?:POS|PURCHASE|PURCH|DEBIT|CREDIT|CARD|VISA|MASTERCARD|MC|DBT|CHECKCARD|CHK|RECURRING|RECUR|AUTOPAY|ONLINE|WWW|HTTPS?|INTL|INTERNATIONAL|TRANSACTION|PREAUTHORIZED|ACH|WITHDRAWAL|ELECTRONIC|ECOMM|SALE|REF|TRN|INC|LLC|LTD|CORP|GMBH|BV|PTE|THE|PAYMENT|PMT|BILL|BILLING|SUBSCRIPTION|SUBSCR|SUB|MEMBERSHIP|MONTHLY|USA|US|CA|NY|TX|WA|FL|IL|GB|UK|IE|NL|LU|SE|PH|AU|SG|HELP|SUPPORT|TO|FROM|DES|INDN|PPD|WEB|CO|ID|NO)\b/g;

  function cleanDescription(desc) {
    var s = String(desc || "").toUpperCase();
    s = s.replace(PROCESSOR_PREFIX, "");
    s = s.replace(/\b([A-Z0-9][A-Z0-9-]*)\.(?:COM|NET|ORG|IO|CO|TV|APP|AI|ME|US|UK|PH|DE|FM)\b(?:\/\S*)?/g, "$1");
    s = s.replace(/\S*\d{3,}\S*/g, " ");
    s = s.replace(/\b\d{1,2}[\/-]\d{1,2}(?:[\/-]\d{2,4})?\b/g, " ");
    s = s.replace(/[*#]\s*\S*/g, " ");
    s = s.replace(/[^A-Z0-9&+ ]/g, " ");
    s = s.replace(NOISE, " ");
    s = s.replace(/\b\d+\b/g, " ");
    s = s.replace(/\s+/g, " ").trim();
    return s;
  }

  function merchantOf(desc) {
    var upper = String(desc || "").toUpperCase();
    for (var i = 0; i < BRANDS.length; i++) {
      if (BRANDS[i][1].test(upper)) return { key: "B:" + BRANDS[i][0], name: BRANDS[i][0], known: true };
    }
    var clean = cleanDescription(desc).replace(/^(?:ZELLE|VENMO|CASH ?APP|WISE|REVOLUT|GCASH|MAYA)\b\s*/, "");
    var tokens = clean.split(" ").filter(function (t) { return t.length > 1 || t === "&"; });
    if (!tokens.length) tokens = upper.replace(/[^A-Z ]/g, " ").trim().split(/\s+/).slice(0, 2);
    var keyTokens = [], shown = [];
    for (var k = 0; k < tokens.length && keyTokens.length < 2; k++) {
      shown.push(tokens[k]);
      if (!/^(?:OF|AND|&|DE|LA|LE|DU|DER|DEL)$/.test(tokens[k])) keyTokens.push(tokens[k]);
    }
    var key = keyTokens.join(" ") || upper.slice(0, 12);
    return { key: "M:" + key, name: titleCase(shown.join(" ") || key), known: false };
  }

  function titleCase(s) {
    return s.toLowerCase().replace(/\b[a-z]/g, function (c) { return c.toUpperCase(); }).replace(/ (And|Of|De|La)\b/g, function (w) { return w.toLowerCase(); });
  }

  function addMonths(day, n) {
    var d = new Date(day * DAY_MS);
    var y = d.getUTCFullYear(), m = d.getUTCMonth() + n, dd = d.getUTCDate();
    var ty = y + Math.floor(m / 12), tm = ((m % 12) + 12) % 12;
    var last = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
    return Math.floor(Date.UTC(ty, tm, Math.min(dd, last)) / DAY_MS);
  }

  var CADENCES = [
    { id: "weekly", label: "Weekly", min: 6, max: 8, perYear: 52.18, minRun: 4, rrule: "FREQ=WEEKLY", step: function (d) { return d + 7; } },
    { id: "biweekly", label: "Every 2 weeks", min: 12, max: 16, perYear: 26.09, minRun: 3, rrule: "FREQ=WEEKLY;INTERVAL=2", step: function (d) { return d + 14; } },
    { id: "monthly", label: "Monthly", min: 26, max: 35, perYear: 12, minRun: 3, rrule: "FREQ=MONTHLY", step: function (d) { return addMonths(d, 1); } },
    { id: "quarterly", label: "Quarterly", min: 83, max: 100, perYear: 4, minRun: 2, rrule: "FREQ=MONTHLY;INTERVAL=3", step: function (d) { return addMonths(d, 3); } },
    { id: "semiannual", label: "Every 6 months", min: 170, max: 195, perYear: 2, minRun: 2, rrule: "FREQ=MONTHLY;INTERVAL=6", step: function (d) { return addMonths(d, 6); } },
    { id: "annual", label: "Yearly", min: 350, max: 380, perYear: 1, minRun: 2, rrule: "FREQ=YEARLY", step: function (d) { return addMonths(d, 12); } }
  ];

  function ratioOk(a, b, lo, hi) {
    if (a <= 0 || b <= 0) return false;
    var r = b / a;
    return r >= lo && r <= hi;
  }

  function sameAmount(a, b) {
    return Math.abs(a - b) <= Math.max(2, Math.round(Math.max(a, b) * 0.02));
  }

  function buildChains(charges, cad) {
    var used = charges.map(function (c) { return c.used; });
    var chains = [];
    for (var i = 0; i < charges.length; i++) {
      if (used[i]) continue;
      var chain = [i];
      var cur = i;
      while (true) {
        var bestJ = -1, bestCost = Infinity;
        for (var j = cur + 1; j < charges.length; j++) {
          if (used[j] || chain.indexOf(j) >= 0) continue;
          var gap = charges[j].day - charges[cur].day;
          if (gap < cad.min) continue;
          if (gap > cad.max) break;
          if (!ratioOk(charges[cur].spend, charges[j].spend, 0.55, 1.8)) continue;
          var ideal = cad.step(charges[cur].day) - charges[cur].day;
          var cost = Math.abs(charges[j].spend - charges[cur].spend) / charges[cur].spend * 40 + Math.abs(gap - ideal);
          if (cost < bestCost) { bestCost = cost; bestJ = j; }
        }
        if (bestJ < 0) break;
        chain.push(bestJ);
        cur = bestJ;
      }
      if (chain.length >= 2) {
        chain.forEach(function (k) { used[k] = true; });
        chains.push(chain);
      }
    }
    return chains;
  }

  function median(xs) {
    if (!xs.length) return 0;
    var s = xs.slice().sort(function (a, b) { return a - b; });
    var m = s.length >> 1;
    return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
  }

  function chainQuality(list, cad, known) {
    var n = list.length;
    var steps = n - 1;
    var same = 0, variation = 0;
    for (var i = 1; i < n; i++) {
      if (sameAmount(list[i - 1].spend, list[i].spend)) same++;
      variation += Math.abs(list[i].spend - list[i - 1].spend) / list[i - 1].spend;
    }
    var sameRate = steps ? same / steps : 0;
    var amounts = list.map(function (c) { return c.spend; });
    var med = median(amounts);
    var mean = amounts.reduce(function (a, b) { return a + b; }, 0) / n;
    var sd = Math.sqrt(amounts.reduce(function (a, b) { return a + (b - mean) * (b - mean); }, 0) / n);
    var cv = mean ? sd / mean : 0;
    var changes = 0;
    for (var k = 1; k < n; k++) if (!sameAmount(list[k - 1].spend, list[k].spend)) changes++;
    return { sameRate: sameRate, cv: cv, median: med, changes: changes, variable: sameRate < 0.5 };
  }

  function detect(transactions, opts) {
    opts = opts || {};
    var all = transactions.slice().sort(function (a, b) { return a.day - b.day; });
    if (!all.length) return { subscriptions: [], range: null, spendCount: 0 };
    var range = { start: all[0].day, end: all[all.length - 1].day };
    var spends = all.filter(function (t) { return t.spend > 0; });
    var groups = {};
    spends.forEach(function (t) {
      var m = merchantOf(t.desc);
      if (!groups[m.key]) groups[m.key] = { key: m.key, name: m.name, known: m.known, charges: [] };
      groups[m.key].charges.push({ day: t.day, spend: t.spend, desc: t.desc, used: false });
    });

    var subs = [];
    Object.keys(groups).forEach(function (gk) {
      var g = groups[gk];
      g.charges.sort(function (a, b) { return a.day - b.day || a.spend - b.spend; });
      var found = [];
      CADENCES.forEach(function (cad) {
        var chains = buildChains(g.charges, cad);
        chains.forEach(function (idxs) {
          var list = idxs.map(function (i) { return g.charges[i]; });
          var q = chainQuality(list, cad, g.known);
          var minRun = cad.minRun;
          if (g.known && cad.id === "monthly") minRun = 2;
          if (list.length < minRun) return;
          if (!g.known && list.length === 2 && Math.abs(list[0].spend - list[1].spend) > 1) return;
          if (!g.known && q.sameRate < 0.5 && q.cv > 0.25) return;
          if (q.variable && (list.length < 4 || (!g.known && cad.id !== "monthly" && cad.id !== "quarterly"))) return;
          if (!g.known && !onSchedule(list, cad, q.variable)) return;
          if (!g.known) {
            var span0 = list[0].day - cad.min, span1 = list[list.length - 1].day + cad.min;
            var others = g.charges.filter(function (c) { return !c.used && idxs.indexOf(g.charges.indexOf(c)) < 0 && c.day >= span0 && c.day <= span1 && c.spend > list[0].spend * 0.25; }).length;
            if (others > list.length * 0.3) return;
          }
          idxs.forEach(function (i) { g.charges[i].used = true; });
          found.push({ cad: cad, list: list, q: q });
        });
      });

      found = mergeRuns(found);
      found.forEach(function (f) { subs.push(makeSub(g, f.cad, f.list, range)); });
    });

    subs.sort(function (a, b) { return (b.active - a.active) || b.yearly - a.yearly; });
    return { subscriptions: subs, range: range, spendCount: spends.length, merchants: Object.keys(groups).length };
  }

  function onSchedule(list, cad, variable) {
    var hits = 0, n = list.length - 1;
    for (var i = 1; i < list.length; i++) {
      var gap = list[i].day - list[i - 1].day;
      var ideal = cad.step(list[i - 1].day) - list[i - 1].day;
      if (Math.abs(gap - ideal) <= (variable ? 3 : 4)) hits++;
    }
    var exact = 0;
    for (var k = 1; k < list.length; k++) if (list[k].day - list[k - 1].day === cad.step(list[k - 1].day) - list[k - 1].day) exact++;
    if (cad.id === "weekly" || cad.id === "biweekly") return exact >= n * 0.6;
    return hits >= n * (variable ? 1 : 0.8);
  }

  function mergeRuns(found) {
    found.sort(function (a, b) { return a.list[0].day - b.list[0].day; });
    var out = [];
    found.forEach(function (f) {
      var host = null;
      for (var i = 0; i < out.length; i++) {
        var o = out[i];
        if (o.cad.id !== f.cad.id) continue;
        var last = o.list[o.list.length - 1];
        var gap = f.list[0].day - last.day;
        var variable = o.q.variable || f.q.variable;
        if (variable ? gap > 0 && gap <= o.cad.max + 3 && ratioOk(o.q.median, f.q.median, 0.5, 2)
          : gap > 0 && gap <= o.cad.max * 3 && ratioOk(last.spend, f.list[0].spend, 0.66, 1.5)) { host = o; break; }
      }
      if (host) { host.list = host.list.concat(f.list); host.q = chainQuality(host.list); }
      else out.push({ cad: f.cad, list: f.list.slice(), q: f.q });
    });
    return out;
  }

  function makeSub(g, cad, list, range) {
    var q = chainQuality(list, cad, g.known);
    var last = list[list.length - 1];
    var current = q.variable ? median(list.slice(-6).map(function (c) { return c.spend; })) : last.spend;
    var next = cad.step(last.day);
    var grace = Math.max(4, Math.round((cad.max - cad.min) / 2) + 3);
    var active = range.end <= next + grace;
    var missed = 0;
    if (!active) {
      var d = next;
      while (d + grace < range.end && missed < 99) { missed++; d = cad.step(d); }
    }
    var changes = [];
    if (!q.variable) {
      for (var i = 1; i < list.length; i++) {
        if (!sameAmount(list[i - 1].spend, list[i].spend)) changes.push({ day: list[i].day, from: list[i - 1].spend, to: list[i].spend });
      }
    }
    var first = list[0];
    var firstRegular = q.variable ? median(list.slice(0, 3).map(function (c) { return c.spend; })) : first.spend;
    var gaps = [];
    for (var k = 1; k < list.length; k++) gaps.push(list[k].day - list[k - 1].day);
    // A free or cheap trial that turned into this: a small charge from the
    // same merchant 3 to 35 days before the first full one.
    var trial = null;
    g.charges.forEach(function (c) {
      var before = first.day - c.day;
      if (c.used || before < 3 || before > 35) return;
      if (c.spend > Math.max(199, firstRegular * 0.25)) return;
      if (!trial || c.day > trial.day) trial = { day: c.day, spend: c.spend };
    });
    // Started inside the last two cycles of the statement: easy to miss.
    var isNew = first.day > range.start + cad.max && range.end - first.day <= 2 * cad.max + 3;
    var confidence = Math.min(1,
      0.25 + Math.min(0.35, (list.length - 1) * 0.08) +
      (q.variable ? 0.05 : 0.2 * q.sameRate) +
      (g.known ? 0.25 : 0) +
      (gaps.every(function (x) { return x >= cad.min && x <= cad.max; }) ? 0.1 : 0));
    return {
      id: g.key + "|" + cad.id + "|" + first.day,
      key: g.key,
      name: g.name,
      known: g.known,
      cadence: cad.id,
      cadenceLabel: cad.label,
      rrule: cad.rrule,
      perYear: cad.perYear,
      amount: current,
      monthly: Math.round(current * cad.perYear / 12),
      yearly: Math.round(current * cad.perYear),
      first: first.day,
      last: last.day,
      next: next,
      active: active,
      missed: missed,
      variable: q.variable,
      priceChanges: changes,
      trial: trial,
      isNew: isNew,
      priceDelta: q.variable ? 0 : last.spend - firstRegular,
      count: list.length,
      charges: list.map(function (c) { return { day: c.day, spend: c.spend, desc: c.desc }; }),
      confidence: Math.round(confidence * 100) / 100
    };
  }

  function summarize(subs, decisions) {
    decisions = decisions || {};
    var out = { activeCount: 0, monthly: 0, yearly: 0, cancelYearly: 0, cancelCount: 0, stoppedCount: 0, raisedCount: 0, newCount: 0, ignored: 0 };
    subs.forEach(function (s) {
      var d = decisions[s.id];
      if (d === "ignore") { out.ignored++; return; }
      if (!s.active) { out.stoppedCount++; return; }
      out.activeCount++;
      out.monthly += s.monthly;
      out.yearly += s.yearly;
      if (s.priceDelta > 0) out.raisedCount++;
      if (s.isNew || s.trial) out.newCount++;
      if (d === "cancel") { out.cancelCount++; out.cancelYearly += s.yearly; }
    });
    return out;
  }

  function upcoming(subs, fromDay, days, decisions) {
    decisions = decisions || {};
    var out = [];
    subs.forEach(function (s) {
      if (!s.active || decisions[s.id] === "ignore") return;
      var cad = CADENCES.filter(function (c) { return c.id === s.cadence; })[0];
      var d = s.next, guard = 0;
      while (d < fromDay && guard++ < 400) d = cad.step(d);
      while (d <= fromDay + days && guard++ < 400) { out.push({ day: d, sub: s }); d = cad.step(d); }
    });
    out.sort(function (a, b) { return a.day - b.day || b.sub.amount - a.sub.amount; });
    return out;
  }

  function isoDay(day) {
    return new Date(day * DAY_MS).toISOString().slice(0, 10);
  }

  function icsEscape(s) {
    return String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
  }

  function foldLine(line) {
    var bytes = 0, out = "", cur = "";
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      var code = line.charCodeAt(i);
      if (code >= 0xd800 && code <= 0xdbff && i + 1 < line.length) { ch += line[i + 1]; i++; }
      var b = utf8Len(ch);
      if (bytes + b > (out ? 74 : 75)) { out += (out ? "\r\n " : "") + cur; cur = ""; bytes = 0; }
      cur += ch; bytes += b;
    }
    return out ? out + "\r\n " + cur : cur;
  }

  function utf8Len(ch) {
    var c = ch.codePointAt(0);
    return c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
  }

  function toICS(subs, opts) {
    opts = opts || {};
    var fmt = opts.format || function (c) { return (c / 100).toFixed(2); };
    var stamp = (opts.now ? new Date(opts.now) : new Date()).toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
    var lead = opts.leadDays == null ? 3 : opts.leadDays;
    var lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//johanthegoatt//Siphon//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:Recurring charges"];
    subs.forEach(function (s) {
      var date = isoDay(s.next).replace(/-/g, "");
      var end = isoDay(s.next + 1).replace(/-/g, "");
      var title = s.name + " renews" + (s.variable ? " (about " + fmt(s.amount) + ")" : ": " + fmt(s.amount));
      var desc = s.cadenceLabel + " charge, about " + fmt(s.yearly) + " a year. Seen " + s.count + " times from " + isoDay(s.first) + " to " + isoDay(s.last) + ".";
      lines.push("BEGIN:VEVENT");
      lines.push("UID:" + s.id.replace(/[^A-Za-z0-9|.-]/g, "-") + "@siphon.johanthegoat.xyz");
      lines.push("DTSTAMP:" + stamp);
      lines.push("DTSTART;VALUE=DATE:" + date);
      lines.push("DTEND;VALUE=DATE:" + end);
      lines.push("RRULE:" + s.rrule);
      lines.push("SUMMARY:" + icsEscape(title));
      lines.push("DESCRIPTION:" + icsEscape(desc));
      lines.push("TRANSP:TRANSPARENT");
      if (lead > 0) {
        lines.push("BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:" + icsEscape(title), "TRIGGER:-P" + lead + "D", "END:VALARM");
      }
      lines.push("END:VEVENT");
    });
    lines.push("END:VCALENDAR");
    return lines.map(foldLine).join("\r\n") + "\r\n";
  }

  function csvCell(v) {
    var s = String(v == null ? "" : v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function toCSV(subs, decisions) {
    decisions = decisions || {};
    var rows = [["Merchant", "Cadence", "Amount", "Per month", "Per year", "First seen", "Last seen", "Next expected", "Status", "Price change", "Times seen", "Decision"]];
    subs.forEach(function (s) {
      rows.push([s.name, s.cadenceLabel, (s.amount / 100).toFixed(2), (s.monthly / 100).toFixed(2), (s.yearly / 100).toFixed(2),
        isoDay(s.first), isoDay(s.last), s.active ? isoDay(s.next) : "", s.active ? "active" : "stopped",
        s.priceDelta ? (s.priceDelta / 100).toFixed(2) : "", s.count, decisions[s.id] || ""]);
    });
    return rows.map(function (r) { return r.map(csvCell).join(","); }).join("\r\n") + "\r\n";
  }

  function analyzeFiles(files) {
    var parsed = files.map(function (f, i) {
      var csv = parseCSV(f.text);
      var mapping = guessMapping(csv.rows);
      return { name: f.name, rows: csv.rows, delimiter: csv.delimiter, mapping: mapping, id: i };
    });
    return parsed;
  }

  // OFX and QFX (Quicken / Money downloads, often offered next to CSV, and the
  // only export some banks have). Version 1 is SGML with unclosed tags, 2 is
  // XML; reading each field up to the next tag handles both. The statement
  // becomes the same rows a CSV would give, so detection doesn't care.
  function looksLikeOFX(text) {
    return /^\s*(?:OFXHEADER:|<\?xml[^>]*>\s*<\?OFX|<OFX>)/i.test(String(text).slice(0, 400)) || /<STMTTRN>/i.test(String(text).slice(0, 20000));
  }

  function ofxField(block, tag) {
    var m = block.match(new RegExp("<" + tag + ">([^<\\r\\n]*)", "i"));
    if (!m) return "";
    return m[1].trim().replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");
  }

  function parseOFX(text) {
    var rows = [["Date", "Description", "Amount"]];
    var blocks = String(text).split(/<STMTTRN>/i).slice(1);
    blocks.forEach(function (raw) {
      var block = raw.split(/<\/STMTTRN>/i)[0];
      var posted = ofxField(block, "DTPOSTED").match(/^(\d{4})(\d{2})(\d{2})/);
      var amount = ofxField(block, "TRNAMT").replace(",", ".");
      if (!posted || !amount) return;
      var desc = ofxField(block, "NAME") || ofxField(block, "PAYEE") || ofxField(block, "MEMO");
      rows.push([posted[1] + "-" + posted[2] + "-" + posted[3], desc, amount]);
    });
    return { rows: rows, delimiter: "ofx" };
  }

  return {
    looksLikeOFX: looksLikeOFX,
    parseOFX: parseOFX,
    DAY_MS: DAY_MS,
    CADENCES: CADENCES,
    parseCSV: parseCSV,
    sniffDelimiter: sniffDelimiter,
    parseDate: parseDate,
    detectDateOrder: detectDateOrder,
    parseAmount: parseAmount,
    isAmountLike: isAmountLike,
    detectCurrency: detectCurrency,
    guessMapping: guessMapping,
    extractTransactions: extractTransactions,
    mergeTransactions: mergeTransactions,
    cleanDescription: cleanDescription,
    merchantOf: merchantOf,
    addMonths: addMonths,
    detect: detect,
    summarize: summarize,
    upcoming: upcoming,
    toICS: toICS,
    toCSV: toCSV,
    isoDay: isoDay,
    analyzeFiles: analyzeFiles
  };
});
