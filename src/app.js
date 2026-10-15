(function () {
  "use strict";
  var S = window.Siphon;
  var $ = function (id) { return document.getElementById(id); };

  var state = {
    files: [],
    subs: [],
    range: null,
    filter: "active",
    sort: "yearly",
    currency: "",
    decisions: load("siphon.decisions", {}),
    open: {}
  };

  var CURRENCIES = ["", "USD", "EUR", "GBP", "PHP", "CAD", "AUD", "INR", "JPY", "SGD", "BRL", "MXN", "NZD", "ZAR", "CHF", "SEK"];

  function load(key, fallback) {
    try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { }
  }

  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else if (k.slice(0, 2) === "on") n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? "" : v);
    });
    (children || []).forEach(function (c) { if (c != null) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return n;
  }

  function money(cents, opts) {
    opts = opts || {};
    var v = cents / 100;
    var digits = opts.whole && Math.abs(v) >= 100 ? 0 : 2;
    try {
      if (state.currency) return new Intl.NumberFormat(undefined, { style: "currency", currency: state.currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v);
    } catch (e) { }
    return new Intl.NumberFormat(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v);
  }

  var dateFmt = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  var shortFmt = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
  var monthFmt = new Intl.DateTimeFormat(undefined, { month: "short", year: "numeric", timeZone: "UTC" });
  function fmtDay(d, f) { return (f || dateFmt).format(new Date(d * S.DAY_MS)); }
  function today() { var n = new Date(); return Math.floor(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()) / S.DAY_MS); }

  function announce(msg) { $("status").textContent = msg; }

  function showError(msg) {
    var e = $("intake-error");
    e.textContent = msg;
    e.hidden = !msg;
  }

  function readFiles(list) {
    var files = Array.prototype.slice.call(list || []);
    if (!files.length) return;
    showError("");
    var tooBig = files.filter(function (f) { return f.size > 25 * 1024 * 1024; });
    if (tooBig.length) { showError(tooBig[0].name + " is over 25 MB. That is far larger than a bank CSV usually is; check it is the right file."); return; }
    Promise.all(files.map(function (f) {
      return f.text().then(function (text) { return { name: f.name, text: text }; });
    })).then(function (loaded) {
      addSources(loaded);
    }, function () { showError("That file could not be read. Try exporting it again from your bank."); });
  }

  function addSources(sources) {
    var bad = [];
    sources.forEach(function (src) {
      if (/^\s*%PDF|^PK\u0003\u0004/.test(src.text.slice(0, 8))) { bad.push(src.name + " looks like a PDF or spreadsheet. Most banks offer CSV or OFX/QFX (Quicken) next to PDF on the download page."); return; }
      var parsed = S.looksLikeOFX(src.text) ? S.parseOFX(src.text) : S.parseCSV(src.text);
      var mapping = S.guessMapping(parsed.rows);
      state.files.push({ id: Date.now() + Math.random(), name: src.name, rows: parsed.rows, mapping: mapping, isSample: !!src.isSample });
      if (!state.currency && mapping.currency) state.currency = mapping.currency;
    });
    if (bad.length && !state.files.length) { showError(bad.join(" ")); return; }
    if (bad.length) announce(bad.join(" "));
    recompute();
  }

  function recompute() {
    var lists = [];
    state.files.forEach(function (f) {
      f.result = null;
      if (!f.mapping.ok) return;
      f.result = S.extractTransactions(f.rows, f.mapping, f.id);
      lists.push(f.result.transactions);
    });
    var tx = S.mergeTransactions(lists);
    var out = S.detect(tx);
    state.subs = out.subscriptions;
    state.range = out.range;
    state.txCount = tx.length;
    state.spendCount = out.spendCount;
    render();
  }

  function render() {
    var has = state.files.length > 0;
    $("intake").hidden = has;
    $("files").hidden = !has;
    $("results").hidden = !has || !state.files.some(function (f) { return f.mapping.ok; });
    renderFiles();
    if (!$("results").hidden) {
      renderCurrency();
      renderStats();
      renderFilters();
      renderList();
      renderUpcoming();
    }
  }

  function renderFiles() {
    var box = $("file-list");
    box.textContent = "";
    state.files.forEach(function (f) {
      var m = f.mapping;
      var card = el("div", { class: "file" + (m.ok ? "" : " bad") });
      var meta;
      if (m.ok && f.result) {
        var days = f.result.transactions.map(function (t) { return t.day; });
        var lo = Math.min.apply(null, days), hi = Math.max.apply(null, days);
        meta = f.result.transactions.length.toLocaleString() + " transactions, " + (days.length ? fmtDay(lo) + " to " + fmtDay(hi) : "no dated rows") + (f.result.skipped ? ". " + f.result.skipped + " rows skipped (no date or amount)" : "");
      } else {
        meta = m.error || "Pick the columns below.";
      }
      var head = el("div", { class: "file-head" }, [
        el("div", {}, [el("p", { class: "file-name", text: f.isSample ? f.name + " (generated)" : f.name }), el("p", { class: "file-meta", text: meta })]),
        el("button", { type: "button", class: "btn small ghost", "aria-label": "Remove " + f.name, onclick: function () { removeFile(f); } }, ["Remove"])
      ]);
      card.appendChild(head);
      var cols = (m.columns || []).map(function (c, i) { return { v: String(i), t: c }; });
      var none = [{ v: "-1", t: "(none)" }];
      var grid = el("div", { class: "map-grid" });
      function sel(label, key, options, value, onchange) {
        var id = "m-" + String(f.id).replace(/\D/g, "") + "-" + key;
        var s = el("select", { id: id, onchange: function (e) { onchange(e.target.value); } }, options.map(function (o) {
          return el("option", { value: o.v, selected: String(value) === o.v }, [o.t]);
        }));
        grid.appendChild(el("div", { class: "field" }, [el("label", { for: id, text: label }), s]));
      }
      if (!m.columns) { card.appendChild(grid); box.appendChild(card); return; }
      var useSplit = m.map.amount < 0;
      sel("Date", "date", cols, m.map.date, function (v) { m.map.date = +v; m.dateOrder = S.detectDateOrder(f.rows.map(function (r) { return r[+v]; })); refreshFile(f); });
      sel("Description", "desc", cols, m.map.desc, function (v) { m.map.desc = +v; refreshFile(f); });
      sel("Amounts are in", "mode", [{ v: "one", t: "One amount column" }, { v: "two", t: "Separate out / in columns" }], useSplit ? "two" : "one", function (v) {
        if (v === "two") { m.map.debit = m.map.amount >= 0 ? m.map.amount : m.map.debit; m.map.amount = -1; m.spendSign = "debit"; }
        else { m.map.amount = m.map.debit >= 0 ? m.map.debit : 0; m.map.debit = -1; m.map.credit = -1; m.spendSign = "negative"; }
        refreshFile(f);
      });
      if (useSplit) {
        sel("Money out", "debit", none.concat(cols), m.map.debit, function (v) { m.map.debit = +v; refreshFile(f); });
        sel("Money in", "credit", none.concat(cols), m.map.credit, function (v) { m.map.credit = +v; refreshFile(f); });
      } else {
        sel("Amount", "amount", cols, m.map.amount, function (v) { m.map.amount = +v; refreshFile(f); });
        sel("Spending shows as", "sign", [{ v: "negative", t: "Negative numbers" }, { v: "positive", t: "Positive numbers" }], m.spendSign, function (v) { m.spendSign = v; refreshFile(f); });
      }
      sel("Dates are written", "order", [{ v: "mdy", t: "Month first (09/25)" }, { v: "dmy", t: "Day first (25/09)" }], m.dateOrder, function (v) { m.dateOrder = v; refreshFile(f); });
      var details = el("details", { class: "mapping" }, [el("summary", { text: m.ok ? "Columns: " + describeMap(m) : "Choose columns" }), grid]);
      if (!m.ok) details.open = true;
      card.appendChild(details);
      box.appendChild(card);
    });
  }

  function describeMap(m) {
    var c = m.columns;
    var parts = [c[m.map.date], c[m.map.desc]];
    if (m.map.amount >= 0) parts.push(c[m.map.amount] + (m.spendSign === "positive" ? " (spending positive)" : " (spending negative)"));
    else parts.push([c[m.map.debit], c[m.map.credit]].filter(Boolean).join(" / "));
    return parts.join(", ");
  }

  function refreshFile(f) {
    var m = f.mapping;
    m.ok = m.map.date >= 0 && m.map.desc >= 0 && (m.map.amount >= 0 || m.map.debit >= 0);
    m.error = m.ok ? null : "Pick a date, a description and an amount column.";
    if (m.dataStart == null) m.dataStart = 0;
    recompute();
  }

  function removeFile(f) {
    state.files = state.files.filter(function (x) { return x !== f; });
    if (!state.files.length) reset();
    else recompute();
  }

  function reset() {
    state.files = [];
    state.subs = [];
    state.currency = "";
    $("file").value = "";
    $("file-more").value = "";
    render();
    $("intake-title").focus && $("drop").focus();
  }

  function renderCurrency() {
    var s = $("currency");
    if (!s.options.length) {
      CURRENCIES.forEach(function (c) { s.appendChild(el("option", { value: c, text: c ? c : "No symbol" })); });
    }
    if (state.currency && CURRENCIES.indexOf(state.currency) < 0) s.appendChild(el("option", { value: state.currency, text: state.currency }));
    s.value = state.currency;
  }

  function visibleSubs() {
    var d = state.decisions;
    var list = state.subs.filter(function (s) {
      var dec = d[s.id];
      if (state.filter === "ignored") return dec === "ignore";
      if (dec === "ignore") return false;
      if (state.filter === "active") return s.active;
      if (state.filter === "raised") return s.active && s.priceDelta > 0;
      if (state.filter === "new") return s.active && (s.isNew || s.trial);
      if (state.filter === "stopped") return !s.active;
      if (state.filter === "cancel") return dec === "cancel";
      return true;
    });
    list.sort(function (a, b) {
      if (state.sort === "name") return a.name.localeCompare(b.name);
      if (state.sort === "next") return (b.active - a.active) || a.next - b.next;
      return (b.active - a.active) || b.yearly - a.yearly;
    });
    return list;
  }

  function renderStats() {
    var sum = S.summarize(state.subs, state.decisions);
    var r = state.range;
    var months = r ? Math.max(1, Math.round((r.end - r.start) / 30.44)) : 0;
    var box = $("stats");
    box.textContent = "";
    function stat(label, value, sub, cls) {
      box.appendChild(el("div", { class: "stat " + (cls || "") }, [el("p", { class: "stat-label", text: label }), el("p", { class: "stat-value", text: value }), sub ? el("p", { class: "stat-sub", text: sub }) : null]));
    }
    stat("Recurring charges", String(sum.activeCount), sum.stoppedCount ? sum.stoppedCount + " more stopped" : "still billing", "");
    stat("Per month", money(sum.monthly, { whole: true }), "averaged across cadences", "");
    stat("Per year", money(sum.yearly, { whole: true }), sum.raisedCount ? sum.raisedCount + " went up in price" : "at current prices", "accent");
    stat("Marked to cancel", money(sum.cancelYearly, { whole: true }) + " / yr", sum.cancelCount ? sum.cancelCount + " selected" : "tap Cancel on any row", "save");
    var note = el("p", { class: "range-note" }, [
      (state.txCount || 0).toLocaleString() + " transactions" + (r ? " from " + fmtDay(r.start) + " to " + fmtDay(r.end) + " (about " + months + " month" + (months === 1 ? "" : "s") + ")" : "") + "."
    ]);
    if (r && months < 3) note.appendChild(el("span", { class: "warn", text: " Three months or more finds monthly charges reliably; a year or more catches yearly renewals." }));
    else if (r && months < 12) note.appendChild(el("span", { class: "muted", text: " Yearly renewals need about 13 months of history to show up." }));
    box.appendChild(note);
  }

  function renderFilters() {
    var d = state.decisions;
    var counts = { active: 0, raised: 0, "new": 0, stopped: 0, cancel: 0, ignored: 0, all: 0 };
    state.subs.forEach(function (s) {
      if (d[s.id] === "ignore") { counts.ignored++; return; }
      counts.all++;
      if (s.active) counts.active++; else counts.stopped++;
      if (s.active && s.priceDelta > 0) counts.raised++;
      if (s.active && (s.isNew || s.trial)) counts["new"]++;
      if (d[s.id] === "cancel") counts.cancel++;
    });
    var tabs = [["active", "Active"], ["raised", "Price went up"], ["new", "New or trial"], ["stopped", "Stopped"], ["cancel", "To cancel"], ["all", "All"], ["ignored", "Hidden"]];
    var box = $("filters");
    box.textContent = "";
    tabs.forEach(function (t) {
      if ((t[0] === "ignored" || t[0] === "cancel" || t[0] === "new") && !counts[t[0]] && state.filter !== t[0]) return;
      var on = state.filter === t[0];
      box.appendChild(el("button", {
        type: "button", role: "tab", class: "tab", "aria-selected": on ? "true" : "false", tabindex: on ? "0" : "-1",
        onclick: function () { state.filter = t[0]; renderFilters(); renderList(); },
        onkeydown: tabKeys
      }, [t[1], el("span", { class: "count", text: String(counts[t[0]]) })]));
    });
  }

  function tabKeys(e) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    var tabs = Array.prototype.slice.call($("filters").querySelectorAll(".tab"));
    var i = tabs.indexOf(e.currentTarget);
    var n = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
    n.focus();
    n.click();
    var again = $("filters").querySelector('[aria-selected="true"]');
    if (again) again.focus();
  }

  function renderList() {
    var list = visibleSubs();
    var ul = $("subs");
    ul.textContent = "";
    var empty = $("empty");
    empty.textContent = "";
    empty.hidden = list.length > 0;
    if (!list.length) {
      if (!state.subs.length) {
        empty.appendChild(el("h3", { text: "No recurring charges found" }));
        empty.appendChild(el("p", { text: "Siphon needs at least two charges from the same merchant on a steady schedule, three if it does not recognise the merchant. Try a longer date range, add another month of statements, or check the column choices above." }));
      } else {
        empty.appendChild(el("p", { text: { raised: "No active charge has gone up in price over this period.", "new": "No new charges or trials that turned paid.", stopped: "Nothing has stopped billing.", cancel: "Nothing marked to cancel yet.", ignored: "Nothing hidden." }[state.filter] || "Nothing here." }));
      }
      return;
    }
    list.forEach(function (s) { ul.appendChild(renderSub(s)); });
  }

  function renderSub(s) {
    var dec = state.decisions[s.id] || "";
    var li = el("li", { class: "sub" + (s.active ? "" : " stopped") + (dec ? " dec-" + dec : "") });
    var badges = el("div", { class: "badges" });
    if (s.priceDelta > 0) {
      var before = s.amount - s.priceDelta;
      var pct = Math.round(s.priceDelta / before * 100);
      var when = s.priceChanges.length ? fmtDay(s.priceChanges[s.priceChanges.length - 1].day, monthFmt) : "";
      badges.appendChild(el("span", { class: "badge up", text: "Up " + pct + "% since " + money(before) + (when ? " (" + when + ")" : "") }));
    } else if (s.priceDelta < 0) {
      badges.appendChild(el("span", { class: "badge", text: "Price went down" }));
    }
    if (s.trial) badges.appendChild(el("span", { class: "badge up", text: "Started as a " + (s.trial.spend < 100 ? money(s.trial.spend) + " " : "") + "trial on " + fmtDay(s.trial.day) }));
    else if (s.isNew && s.active) badges.appendChild(el("span", { class: "badge up", text: "New since " + fmtDay(s.first) }));
    if (s.variable) badges.appendChild(el("span", { class: "badge", text: "Amount varies" }));
    if (!s.active) badges.appendChild(el("span", { class: "badge stop", text: "Last charged " + fmtDay(s.last) + ", " + s.missed + " missed" }));
    if (s.confidence < 0.7) badges.appendChild(el("span", { class: "badge soft", text: "Worth a look" }));

    var meta = s.cadenceLabel + " \u00b7 since " + fmtDay(s.first, monthFmt) + " \u00b7 " + s.count + " charge" + (s.count === 1 ? "" : "s");
    var nextLine = s.active ? "Next about " + fmtDay(s.next) : "Stopped";

    var toggle = el("button", { type: "button", class: "more", "aria-expanded": state.open[s.id] ? "true" : "false" }, [state.open[s.id] ? "Hide charges" : "Show charges"]);
    var table = chargesTable(s);
    table.hidden = !state.open[s.id];
    toggle.addEventListener("click", function () {
      state.open[s.id] = !state.open[s.id];
      table.hidden = !state.open[s.id];
      toggle.setAttribute("aria-expanded", state.open[s.id] ? "true" : "false");
      toggle.textContent = state.open[s.id] ? "Hide charges" : "Show charges";
    });

    var decide = el("div", { class: "decide", role: "group", "aria-label": "Decision for " + s.name }, [
      decisionBtn(s, "keep", "Keep"), decisionBtn(s, "cancel", "Cancel"), decisionBtn(s, "ignore", dec === "ignore" ? "Unhide" : "Not recurring")
    ]);

    li.appendChild(el("div", { class: "sub-main" }, [
      el("div", { class: "sub-id" }, [
        el("h3", { class: "sub-name", text: s.name }),
        el("p", { class: "sub-meta", text: meta }),
        badges
      ]),
      el("div", { class: "sub-cost" }, [
        el("p", { class: "sub-amount" }, [money(s.amount), el("span", { class: "per", text: perLabel(s.cadence) })]),
        el("p", { class: "sub-year", text: money(s.yearly, { whole: true }) + " a year" }),
        el("p", { class: "sub-next", text: nextLine })
      ])
    ]));
    li.appendChild(timeline(s));
    li.appendChild(el("div", { class: "sub-foot" }, [toggle, decide]));
    li.appendChild(table);
    return li;
  }

  function perLabel(c) {
    return { weekly: " / wk", biweekly: " / 2 wk", monthly: " / mo", quarterly: " / qtr", semiannual: " / 6 mo", annual: " / yr" }[c] || "";
  }

  function decisionBtn(s, value, label) {
    var cur = state.decisions[s.id] || "";
    var on = cur === value;
    return el("button", {
      type: "button", class: "dec dec-" + value, "aria-pressed": on ? "true" : "false",
      onclick: function () {
        if (on) delete state.decisions[s.id]; else state.decisions[s.id] = value;
        save("siphon.decisions", state.decisions);
        renderStats(); renderFilters(); renderList(); renderUpcoming();
        var again = document.querySelector('.sub [aria-label="Decision for ' + cssEscape(s.name) + '"] .dec-' + value);
        if (again) again.focus();
        announce(s.name + (on ? ": choice cleared" : value === "cancel" ? ": marked to cancel" : value === "keep" ? ": keeping" : ": hidden"));
      }
    }, [label]);
  }

  function cssEscape(s) { return String(s).replace(/["\\]/g, "\\$&"); }

  function timeline(s) {
    var r = state.range;
    var span = Math.max(1, r.end + 31 - r.start);
    var pct = function (d) { return Math.max(0, Math.min(100, (d - r.start) / span * 100)); };
    var line = el("div", { class: "timeline" + (s.count > 30 ? " packed" : s.count > 16 ? " dense" : ""), role: "img", "aria-label": s.count + " charges between " + fmtDay(s.first) + " and " + fmtDay(s.last) });
    var run = el("span", { class: "tl-run" });
    run.style.left = pct(s.first) + "%";
    run.style.width = (pct(s.last) - pct(s.first)) + "%";
    line.appendChild(run);
    var changeDays = {};
    s.priceChanges.forEach(function (c) { changeDays[c.day] = true; });
    function dot(d, cls) {
      var n = el("span", { class: cls });
      n.style.left = pct(d) + "%";
      line.appendChild(n);
    }
    s.charges.forEach(function (c) { dot(c.day, changeDays[c.day] ? "tl-dot tl-change" : "tl-dot"); });
    if (s.active && s.next <= r.end + 400) dot(Math.min(s.next, r.end + 31), "tl-dot tl-next");
    return el("div", { class: "tl-wrap" }, [line]);
  }

  function chargesTable(s) {
    var rows = s.charges.slice().reverse().map(function (c) {
      return el("tr", {}, [el("td", { text: fmtDay(c.day) }), el("td", { class: "desc", text: c.desc }), el("td", { class: "num", text: money(c.spend) })]);
    });
    return el("div", { class: "charges" }, [el("table", {}, [
      el("caption", { class: "sr-only", text: "Charges for " + s.name }),
      el("thead", {}, [el("tr", {}, [el("th", { scope: "col", text: "Date" }), el("th", { scope: "col", text: "As written on the statement" }), el("th", { scope: "col", class: "num", text: "Amount" })])]),
      el("tbody", {}, rows)
    ])]);
  }

  function renderUpcoming() {
    var ul = $("upcoming");
    ul.textContent = "";
    var from = Math.max(today(), state.range ? state.range.end : today());
    var items = S.upcoming(state.subs, from, 30, ignoredOnly());
    if (!items.length) { ul.appendChild(el("li", { class: "muted", text: "Nothing expected in the next 30 days." })); return; }
    var total = 0;
    items.forEach(function (u) {
      total += u.sub.amount;
      var dec = state.decisions[u.sub.id];
      ul.appendChild(el("li", { class: dec === "cancel" ? "up-cancel" : "" }, [
        el("span", { class: "up-date", text: fmtDay(u.day, shortFmt) }),
        el("span", { class: "up-name", text: u.sub.name }),
        el("span", { class: "up-amt", text: money(u.sub.amount) })
      ]));
    });
    ul.appendChild(el("li", { class: "up-total" }, [el("span", { text: "" }), el("span", { text: "Total" }), el("span", { class: "up-amt", text: money(total) })]));
  }

  function ignoredOnly() {
    var out = {};
    Object.keys(state.decisions).forEach(function (k) { if (state.decisions[k] === "ignore") out[k] = "ignore"; });
    return out;
  }

  function download(name, text, type) {
    var blob = new Blob([text], { type: type });
    var url = URL.createObjectURL(blob);
    var a = el("a", { href: url, download: name });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  function activeForExport() {
    return state.subs.filter(function (s) { return s.active && state.decisions[s.id] !== "ignore"; });
  }

  $("export-ics").addEventListener("click", function () {
    var list = activeForExport();
    if (!list.length) { announce("No active charges to export."); return; }
    download("recurring-charges.ics", S.toICS(list, { format: function (c) { return money(c); } }), "text/calendar");
    announce("Calendar file with " + list.length + " renewals downloaded.");
  });
  $("export-csv").addEventListener("click", function () {
    download("recurring-charges.csv", S.toCSV(state.subs.filter(function (s) { return state.decisions[s.id] !== "ignore"; }), state.decisions), "text/csv");
    announce("List downloaded.");
  });

  $("file").addEventListener("change", function (e) { readFiles(e.target.files); });
  $("file-more").addEventListener("change", function (e) { readFiles(e.target.files); e.target.value = ""; });
  $("reset").addEventListener("click", reset);
  $("sort").addEventListener("change", function (e) { state.sort = e.target.value; renderList(); });
  $("currency").addEventListener("change", function (e) { state.currency = e.target.value; render(); });

  $("sample").addEventListener("click", function () {
    var g = SiphonSample.generate({ seed: Math.floor(Math.random() * 1e6), endDay: today() - 1 });
    state.currency = "USD";
    addSources([{ name: "sample-checking.csv", text: g.csv, isSample: true }]);
    announce("Sample statement loaded.");
  });

  $("paste-toggle").addEventListener("click", function () {
    var box = $("paste-box");
    box.hidden = !box.hidden;
    this.setAttribute("aria-expanded", box.hidden ? "false" : "true");
    if (!box.hidden) $("paste").focus();
  });
  $("paste-go").addEventListener("click", function () {
    var text = $("paste").value;
    if (!text.trim()) { showError("Paste the CSV text first."); return; }
    showError("");
    addSources([{ name: "pasted text", text: text }]);
  });

  var drop = $("drop");
  ["dragenter", "dragover"].forEach(function (t) {
    document.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add("over"); });
  });
  ["dragleave", "drop"].forEach(function (t) {
    document.addEventListener(t, function (e) {
      e.preventDefault();
      if (t === "dragleave" && e.relatedTarget) return;
      drop.classList.remove("over");
    });
  });
  document.addEventListener("drop", function (e) {
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) readFiles(e.dataTransfer.files);
  });

  window.__siphon = { state: state, recompute: recompute };
  render();
})();
