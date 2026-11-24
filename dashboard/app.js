// Token Launch Radar's dashboard. It reads window.RADAR (written beside dashboard/ by main.ts) and
// renders three views: the ranked board of pre-token protocols with a filter bar and sortable
// columns, a detail drawer for the selected protocol (its model's four factors as an equation and
// its farm plan), a Live view of the tokened protocols whose market caps set the model's category
// multiples, and a Model view that states the formula and every multiple it derived. No network:
// every byte it shows is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { view: 'board', q: '', category: 'all', chain: 'all', watchOnly: false, sort: 'rank', dir: 1, selected: null };

  function esc(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 730) return (days / 365).toFixed(1) + 'y';
    if (days >= 60) return Math.round(days / 30.4) + 'mo';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(n) { return n === null || n === undefined ? 'n/a' : n.toFixed(2) + 'x'; }

  var rows = DATA.rows;
  var bySlug = {};
  rows.forEach(function (r) { bySlug[r.slug] = r; });
  if (!state.selected && rows.length) state.selected = rows[0].slug;

  // Shareable views: #slug=<slug> opens that protocol's detail, #cat=<category> and #watch=1 set
  // the filters, #view=live|model picks the view. A screenshot or a link can name its view.
  var hashFocusDetail = false;
  if (location.hash.length > 1) {
    location.hash.slice(1).split('&').forEach(function (pair) {
      var kv = pair.split('=');
      var k = decodeURIComponent(kv[0] || '');
      var v = decodeURIComponent(kv[1] || '');
      if (k === 'slug' && bySlug[v]) { state.selected = v; hashFocusDetail = true; }
      if (k === 'cat') state.category = v;
      if (k === 'chain') state.chain = v;
      if (k === 'watch') state.watchOnly = v === '1';
      if (k === 'view' && (v === 'live' || v === 'model' || v === 'detail')) state.view = v;
    });
  }

  var categories = [];
  var chains = [];
  rows.forEach(function (r) {
    if (r.category && categories.indexOf(r.category) === -1) categories.push(r.category);
    r.chains.forEach(function (c) { if (chains.indexOf(c) === -1) chains.push(c); });
  });
  categories.sort();
  chains.sort();
  var maxImplied = rows.reduce(function (m, r) { return Math.max(m, r.implied_value_usd); }, 0);

  function visibleRows() {
    var q = state.q.trim().toLowerCase();
    var out = rows.filter(function (r) {
      if (state.watchOnly && !r.watchlist) return false;
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && r.chains.indexOf(state.chain) === -1) return false;
      if (q && r.name.toLowerCase().indexOf(q) === -1 && r.slug.indexOf(q) === -1) return false;
      return true;
    });
    var key = state.sort;
    var dir = state.dir;
    var val = {
      rank: function (r) { return r.rank; },
      tvl: function (r) { return r.tvl_usd; },
      implied: function (r) { return r.implied_value_usd; },
      change: function (r) { return r.change_7d === null ? -Infinity : r.change_7d; },
      age: function (r) { return r.age_days === null ? -1 : r.age_days; },
    }[key];
    out.sort(function (a, b) { return (val(a) - val(b)) * dir || a.rank - b.rank; });
    return out;
  }

  function headerHtml() {
    return '' +
      '<header class="mast"><div class="mark"><div class="ring" aria-hidden="true"></div><div>' +
      '<h1>Token Launch <span>Radar</span></h1>' +
      '<div class="sub">Pre-token protocols ranked by the value their own figures imply, each with the steps to farm it.</div>' +
      '</div></div>' +
      '<div class="meta">Snapshot <b>' + esc(DATA.as_of) + '</b> · DefiLlama<br>Model <b>' + esc(DATA.model_version) + '</b> · no token is predicted, values are the model\'s own claim</div></header>' +
      '<section class="stats">' +
      '<div class="stat"><div class="k">Protocols scanned</div><div class="v">' + DATA.universe_size + '</div></div>' +
      '<div class="stat"><div class="k">On the board</div><div class="v">' + DATA.board_size + ' <small>(' + DATA.early_size + ' early)</small></div></div>' +
      '<div class="stat"><div class="k">Watchlist covered</div><div class="v">' + DATA.watchlist_size + ' / ' + DATA.watchlist_size + '</div></div>' +
      '<div class="stat"><div class="k">Median category multiple</div><div class="v">' + fmtMult(DATA.global_multiple) + ' <small>of TVL</small></div></div>' +
      '</section>' +
      '<nav class="tabs">' +
      '<button data-view="board" aria-pressed="' + (state.view === 'board') + '">Board</button>' +
      '<button data-view="live" aria-pressed="' + (state.view === 'live') + '">Live tokens</button>' +
      '<button data-view="model" aria-pressed="' + (state.view === 'model') + '">The model</button>' +
      '</nav>';
  }

  function boardHtml() {
    var vis = visibleRows();
    var th = function (label, key, cls) {
      var arrow = state.sort === key ? ' <span class="dir">' + (state.dir === 1 ? '▲' : '▼') + '</span>' : '';
      return '<th class="sortable ' + (cls || '') + '" data-sort="' + key + '">' + label + arrow + '</th>';
    };
    var body = vis.map(function (r) {
      var pct = r.change_7d === null ? '<td>n/a</td>' : '<td class="' + (r.change_7d >= 0 ? 'pos' : 'neg') + '">' + fmtPct(r.change_7d) + '</td>';
      return '<tr data-slug="' + esc(r.slug) + '"' + (state.selected === r.slug ? ' class="selected"' : '') + '>' +
        '<td>#' + r.rank + '</td>' +
        '<td class="name"><span class="pname">' + esc(r.name) + '</span> ' + (r.watchlist ? '<span class="badge watch">WATCHLIST</span>' : '<span class="badge early">EARLY</span>') + '<br><span class="slug">' + esc(r.slug) + '</span></td>' +
        '<td class="cat">' + esc(r.category || 'Uncategorised') + '</td>' +
        '<td>' + esc(r.chains.slice(0, 2).join(', ')) + (r.chains.length > 2 ? ' +' + (r.chains.length - 2) : '') + '</td>' +
        '<td>' + fmtUsd(r.tvl_usd) + '</td>' + pct +
        '<td class="age">' + fmtAge(r.age_days) + '</td>' +
        '<td>' + fmtMult(r.category_multiple) + '</td>' +
        '<td>' + fmtUsd(r.implied_value_usd) + '<div class="bar"><i style="width:' + Math.max(2, Math.round(100 * r.implied_value_usd / maxImplied)) + '%"></i></div></td>' +
        '</tr>';
    }).join('');
    return '' +
      '<div class="controls">' +
      '<input type="search" id="q" placeholder="Search name or slug" value="' + esc(state.q) + '">' +
      '<select id="cat"><option value="all">All categories</option>' + categories.map(function (c) { return '<option' + (state.category === c ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select>' +
      '<select id="chain"><option value="all">All chains</option>' + chains.map(function (c) { return '<option' + (state.chain === c ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select>' +
      '<label class="check"><input type="checkbox" id="watch"' + (state.watchOnly ? ' checked' : '') + '> Watchlist only</label>' +
      '<span class="count">' + vis.length + ' of ' + rows.length + ' rows</span>' +
      '</div>' +
      (vis.length === 0 ? '<div class="panel empty">No protocol matches that filter. Loosen it and the radar sweeps again.</div>' :
        '<table class="board"><thead><tr>' + th('#', 'rank') + th('Protocol', 'rank', 'name') + '<th class="cat">Category</th><th>Chains</th>' +
        th('TVL', 'tvl') + th('7d', 'change') + th('Age', 'age', 'age') + '<th>Multiple</th>' + th('Implied value', 'implied') +
        '</tr></thead><tbody>' + body + '</tbody></table>') +
      detailHtml();
  }

  function stepHtml(step) {
    var at = step.indexOf(' Cost: ');
    if (at === -1) return '<li>' + esc(step) + '</li>';
    return '<li>' + esc(step.slice(0, at)) + '<span class="ct">' + esc(step.slice(at + 1)) + '</span></li>';
  }

  function detailHtml() {
    var r = bySlug[state.selected];
    if (!r) return '';
    var eq = fmtUsd(r.tvl_usd) + ' TVL <span class="f">×</span> ' + fmtMult(r.category_multiple) + ' <span class="f">category</span> × ' +
      r.growth_factor.toFixed(2) + ' <span class="f">growth</span> × ' + r.maturity_factor.toFixed(2) + ' <span class="f">maturity</span> × ' +
      r.breadth_factor.toFixed(2) + ' <span class="f">breadth</span> = <b>' + fmtUsd(r.implied_value_usd) + '</b>';
    return '<section class="detail" id="detail"><h2>#' + r.rank + ' ' + esc(r.name) + ' ' +
      (r.watchlist ? '<span class="badge watch">WATCHLIST</span>' : '<span class="badge early">EARLY</span>') + '</h2>' +
      '<div class="dsub">' + esc(r.category || 'Uncategorised') + ' · records no token in the snapshot · implied value is the model\'s claim, not a prediction</div>' +
      '<div class="cols"><div><h3>How this value is built</h3><div class="equation">' + eq + '</div>' +
      '<dl class="kv">' +
      '<dt>TVL</dt><dd>' + fmtUsd(r.tvl_usd) + '</dd>' +
      '<dt>7d change</dt><dd>' + fmtPct(r.change_7d) + '</dd>' +
      '<dt>Chains</dt><dd>' + esc(r.chains.join(', ') || 'n/a') + '</dd>' +
      '<dt>Tracked since</dt><dd>' + esc(r.listed_at || 'unknown') + ' (' + fmtAge(r.age_days) + ')</dd>' +
      '<dt>Category multiple</dt><dd>' + fmtMult(r.category_multiple) + ' of TVL</dd>' +
      '</dl></div>' +
      '<div><h3>Farm plan</h3><ol class="steps">' + r.farm_steps.map(stepHtml).join('') + '</ol></div>' +
      '</div></section>';
  }

  function liveHtml() {
    var body = DATA.live.map(function (r) {
      return '<tr><td class="l">' + esc(r.name) + '</td><td class="l">' + esc(r.category || '—') + '</td><td>' + fmtUsd(r.tvl_usd) + '</td><td>' + fmtUsd(r.mcap_usd) + '</td><td>' + fmtMult(r.multiple) + '</td><td class="' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg') + '">' + fmtPct(r.change_7d) + '</td></tr>';
    }).join('');
    return '<section class="panel"><h2>Live tokens: the comparables</h2>' +
      '<p>These protocols already trade, so the market has priced them. The model reads each category\'s median market-cap / TVL ratio off this set and prices the pre-token board with it — the board\'s numbers come from these, not from a list anyone wrote by hand.</p>' +
      '<table class="mini"><thead><tr><th class="l">Protocol</th><th class="l">Category</th><th>TVL</th><th>Market cap</th><th>Multiple</th><th>7d</th></tr></thead><tbody>' + body + '</tbody></table></section>';
  }

  function modelHtml() {
    var body = DATA.multiples.map(function (m) {
      return '<tr><td class="l">' + esc(m.category) + '</td><td>' + fmtMult(m.multiple) + '</td><td>' + m.samples + '</td><td class="l">' + (m.own ? 'its own median' : 'global median (thin sample)') + '</td></tr>';
    }).join('');
    return '<section class="panel"><h2>The model, ' + esc(DATA.model_version) + '</h2>' +
      '<p><code>implied = TVL × category multiple × growth × maturity × breadth</code></p>' +
      '<p>The <b>category multiple</b> is the median market-cap / TVL ratio of the category\'s live-token protocols in this snapshot, winsorised to [0.05x, 2.5x]; a category with fewer than three comparables uses the global median of ' + fmtMult(DATA.global_multiple) + '. ' +
      '<b>Growth</b> is the week\'s TVL change clamped to [-50%, +100%] at weight 0.6. <b>Maturity</b> runs from 0.70 to 1.00 over four years of tracked history (0.85 when the start date is unknown): the longer a protocol has operated with no token, the more a launch has to price. ' +
      '<b>Breadth</b> adds 4% per extra chain, up to five. Wrapped, staked and bridged products of tokens that already trade, versioned pools and exchange products are never ranked; the snapshot\'s watchlist is covered in full and the rest of the board is the strongest of the remaining pre-token field.</p>' +
      '<table class="mini"><thead><tr><th class="l">Category</th><th>Multiple</th><th>Comparables</th><th class="l">Basis</th></tr></thead><tbody>' + body + '</tbody></table></section>';
  }

  function render() {
    var html = '<div class="wrap">' + headerHtml();
    if (state.view === 'board') html += boardHtml();
    else if (state.view === 'detail') html += detailHtml();
    else if (state.view === 'live') html += liveHtml();
    else html += modelHtml();
    html += '<footer class="foot">Built from the sealed DefiLlama snapshot of ' + esc(DATA.as_of) + ' (' + esc(DATA.source) + '). A protocol is listed as recording no token because the snapshot carries none for it; that is a statement about the record, not about the protocol. Implied values are this board\'s own model output, not a forecast of any launch.</footer></div>';
    app.innerHTML = html;
    app.setAttribute('aria-busy', 'false');
    bind();
  }

  function bind() {
    app.querySelectorAll('.tabs button').forEach(function (b) {
      b.addEventListener('click', function () { state.view = b.getAttribute('data-view'); render(); });
    });
    var q = document.getElementById('q');
    if (q) q.addEventListener('input', function () { state.q = q.value; refreshBoard(); });
    var cat = document.getElementById('cat');
    if (cat) cat.addEventListener('change', function () { state.category = cat.value; refreshBoard(); });
    var chain = document.getElementById('chain');
    if (chain) chain.addEventListener('change', function () { state.chain = chain.value; refreshBoard(); });
    var watch = document.getElementById('watch');
    if (watch) watch.addEventListener('change', function () { state.watchOnly = watch.checked; refreshBoard(); });
    app.querySelectorAll('th.sortable').forEach(function (t) {
      t.addEventListener('click', function () {
        var key = t.getAttribute('data-sort');
        if (state.sort === key) state.dir = -state.dir;
        else { state.sort = key; state.dir = key === 'rank' ? 1 : -1; }
        refreshBoard();
      });
    });
    app.querySelectorAll('tbody tr[data-slug]').forEach(function (tr) {
      tr.addEventListener('click', function () {
        state.selected = tr.getAttribute('data-slug');
        render();
        var d = document.getElementById('detail');
        if (d) d.scrollIntoView({ block: 'nearest' });
      });
    });
  }

  // Re-render only the board view (keeps the search box focused while typing).
  function refreshBoard() {
    if (state.view !== 'board') return render();
    var active = document.activeElement;
    var wasSearch = active && active.id === 'q';
    var val = wasSearch ? active.value : null;
    var pos = wasSearch ? active.selectionStart : null;
    render();
    if (wasSearch) {
      var nq = document.getElementById('q');
      nq.focus();
      nq.value = val;
      try { nq.setSelectionRange(pos, pos); } catch (e) { /* older engines */ }
    }
  }

  render();
})();
