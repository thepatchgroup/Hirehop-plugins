/*
 HireHop Warehouse schedule plugin — Job Prep Colour + Warehouse Notes indicators.

 What it does
 ------------
 On the Warehouse module's schedule view:

 1) A bold coloured stripe down the left edge of each OUTGOING job card
    (Incoming is left untouched, per request), reflecting the job's "Job
    Prep Colour" custom field (field name: Job_Prep_Colour — a select
    field whose value is a hex colour, e.g. "#FF0000"), labelled "PREP
    COLOUR" in small vertical text. Text colour (dark/light) is picked
    automatically from the stripe colour's luminance, so it stays legible
    on every option configured on this account's Custom Fields screen
    (NONE, Red, Pink, Yellow, Grey, Brown, Green, Blue, Orange, Purple,
    Cyan) and on any colour added later. Only the stripe itself is
    coloured — the rest of the card keeps its normal background. Skipped
    entirely when the field is blank or "#FFFFFF" (the field's "NONE"
    option) — no stripe.

 2) The job's "Warehouse Notes" custom field (field name: warehouse_notes),
    shown directly on each OUTGOING card as a small single-line note pill
    (no click needed to see it) — only added when the field is non-empty.
    Clicking it opens the full text in HireHop's own popup_message()
    dialog, useful if the note is longer than the pill's width.

 3) Title emphasis swapped on EVERY card (Outgoing and Incoming both).
    HireHop's own markup puts the job number + job type + venue in bold
    ("(2959) Dry Hire - Grand Hotel Birmingham") and the job's "Job name"
    field (data key OWNER_NAME - confusingly named, but it's what shows
    as "Job name" on the job's own page, and on this account is generally
    used as the primary human-readable reference, e.g. a person's name)
    underneath in regular text. That's backwards for how this account
    actually uses HireHop day to day, so we swap it: job number + job
    name bold ("(2959) Tony Hadley"), job type + venue underneath, smaller
    ("Dry Hire - Grand Hotel Birmingham"). Only runs when the job name
    field isn't empty - if it is, HireHop's original bold line is left
    alone rather than showing an empty-looking header.

 4) A second scan-screen link added next to the existing barcode icon, on
    OUTGOING ordinary job cards only (not subcontractor/PO cards - "Prep
    job" isn't a meaningful concept for those). HireHop's own barcode icon
    only ever opens "Check job out" (or the equivalent for whatever TYPE
    the row is) - there's no built-in way to jump straight to "Prep job"
    from the schedule board, even though that's usually the FIRST scan
    pass a job needs before it goes out. Both icons are now labelled
    ("Check job out" under the existing barcode, "Prep job" under the new
    one next to it) so it's clear what each does without hovering. Labels
    size to their own text (no fixed width) so "Check job out" stays on
    one line instead of wrapping awkwardly.

 5) A "Prep Progress" bar on OUTGOING ordinary job cards only (same
    restriction as the Prep-job-link above - subcontractor/PO cards don't
    have a Prep job pass to show progress for), sitting directly under
    the title: a thin bar plus "<scanned> / <ordered> (<pct>%)" text, not
    just a bare bar. Reflects how much of the job's Prep job (scan kind
    1) pass is done - the same scan pass the new "Prep job" link above
    opens. Turns green at 100%. Skipped entirely (no bar at all) when the
    job has nothing on its Prep job pass, or the fetch fails - same
    "nothing to show, so show nothing" convention as the stripe/note.

 Adding the note line, icon labels and Prep Progress bar does make
 Outgoing cards a little taller than before; that's a deliberate
 trade-off the user asked for (wanted things "automatically in the job
 tile", not hidden behind a click/hover). The prep-colour stripe adds no
 height at all - it's a left column, not an extra line.

 Where the data comes from
 --------------------------
 Items 1-4 above come straight off this page's own list.php AJAX
 response, which already returns CUSTOM_FIELDS on every row it loads —
 confirmed live via the widget instance's `.data.rows`. So those need no
 extra network requests: they just read fields off the same `data` object
 HireHop already attaches to each card via `.data("data", data)`.

 Prep Progress (5) is the one exception - list.php's own row data has no
 scan-completion counts on it at all, so this fetches
 /modules/scanning/get_prep_list.php?main_id=<job>&kind=1 itself (same
 endpoint the Scanning module's own screen uses, confirmed live - works
 with just main_id/kind, no extra params needed). That returns a flat
 list of every line on the job's Prep job pass, each with
 ordered/scanned/remain counts; totals are summed across every row that
 isn't a heading/comment (TYPE 5/100), clamping each line's scanned count
 to its own ordered count first so an over-scanned item can't push the
 percentage past 100%. One fetch measured ~500ms live, so this is kept to
 a small, capped number of concurrent requests (see
 PREP_PROGRESS_MAX_CONCURRENT) rather than firing one per card at once -
 in practice there are usually only a handful of Outgoing ordinary job
 cards on screen at a time (6 of 73 total cards, in one live snapshot),
 so this isn't normally a heavy ask even unthrottled, but the cap is
 there regardless. (Contrast with the Scanning module's Warehouse Notes
 panel — a separate plugin, scanning-tree-view.js — which fetches
 /job.php itself for the same reason: that screen's own data doesn't
 carry custom fields either. That plugin has its own, independent Prep
 Progress bar too, shown at the top of the scanning screen itself -
 the two are deliberately duplicated rather than shared, since they're
 separate plugin files loaded independently.)

 Outgoing vs Incoming
 ---------------------
 HireHop's own fill_container() puts a row in the Outgoing column when
 `data.TYPE === 3 || data.TYPE === 2` and Incoming otherwise (TYPE 3/4 for
 ordinary job events via add_job_event, TYPE 2/1 for subcontractor/PO rows
 via add_subcontractor_event). This plugin uses that exact same TYPE check
 to decide which cards get the stripe/note/Prep-job-link/Prep-Progress-bar
 (Prep job is further restricted to TYPE 3 only, ordinary jobs, not
 subcontractor rows - see addPrepJobLink and addPrepProgressBar). The
 title-emphasis swap applies regardless of TYPE/column, since it's just
 fixing which field reads as the "headline" and isn't specific to
 Outgoing.

 How it's wired in
 ------------------
 Same instance-patching approach as scanning-tree-view.js: the warehouse
 widget ($.custom.warehouse) instantiates itself immediately on page load,
 before a class-level $.widget() redefinition would reliably apply. So we
 poll for the already-created instance ($(el).data('customWarehouse')),
 then wrap add_job_event and add_subcontractor_event to call the original
 and augment the div each returns. The widget already rebuilds the whole
 card list from scratch on every refresh (every 5 minutes, or whenever a
 filter/depot/period changes), so wrapping those two methods is enough for
 items 1-4 - no extra polling/self-heal loop needed for those.

 Prep Progress (5) adds one small additional loop of its own: each
 card's bar is rendered as a placeholder first and filled in once its
 fetch resolves (so a slow network never blocks the rest of the card),
 and - since the widget only rebuilds cards from scratch every 5 minutes
 - a lightweight timer separately re-fetches and updates already-shown
 bars in place every PREP_PROGRESS_REFRESH_MS, so progress made on a
 scanning terminal elsewhere shows up on the board without needing a
 full refresh.
*/

(function () {
  var PREP_COLOUR_FIELD = 'Job_Prep_Colour';
  var WAREHOUSE_NOTES_FIELD = 'warehouse_notes';
  var POLL_INTERVAL_MS = 400;
  var POLL_TIMEOUT_MS = 30000;

  // Simple perceived-brightness heuristic (ITU-R BT.601), good enough to
  // choose readable label text against any of the configured swatch colours.
  function pickTextColor(hex) {
    hex = String(hex).replace('#', '');
    var r = parseInt(hex.substring(0, 2), 16);
    var g = parseInt(hex.substring(2, 4), 16);
    var b = parseInt(hex.substring(4, 6), 16);
    var luminance = 0.299 * r + 0.587 * g + 0.114 * b;
    return luminance > 150 ? '#1c2b36' : '#ffffff';
  }

  function isOutgoingRow(data) {
    return data.TYPE === 3 || data.TYPE === 2;
  }

  function addPrepColourStripe(div, hex) {
    if (div.find('.wh_prep_stripe').length) return; // already added
    // Only the stripe itself carries the colour - the rest of the card
    // keeps its normal background (previously a faint tint of `hex`
    // washed the whole tile too; removed per request).
    div.css({ display: 'flex', 'align-items': 'stretch' });
    var stripe = $('<div>', {
      'class': 'wh_prep_stripe',
      title: 'Prep colour: ' + hex,
      style:
        'flex:0 0 22px; background:' + hex + '; display:flex; align-items:center;' +
        'justify-content:center; padding:4px 0; border-radius:8px 0 0 8px;'
    });
    $('<span>', {
      text: 'PREP COLOUR',
      style:
        'writing-mode:vertical-rl; font-size:7px; font-weight:700; letter-spacing:.08em;' +
        'color:' + pickTextColor(hex) + '; white-space:nowrap;'
    }).appendTo(stripe);
    div.prepend(stripe);
    div.children('table').css('flex', '1');
  }

  function addNoteLine(div, noteText) {
    var mainCell = div.find('td.warehouse_event_maincell').first();
    if (!mainCell.length || mainCell.find('.wh_note_line').length) return;
    $('<div>', {
      'class': 'wh_note_line',
      title: 'Warehouse note (click to view full note):\n' + noteText,
      style:
        'margin-top:3px; font-size:0.85em; font-style:italic; color:#8a6d1a;' +
        'background:#fff8dd; border:1px solid #e0c975; border-radius:3px; padding:1px 6px;' +
        'white-space:nowrap; overflow:hidden; text-overflow:ellipsis; cursor:pointer;',
      text: '📝 ' + noteText // memo emoji
    })
      .appendTo(mainCell)
      .on('click', function (e) {
        e.stopPropagation();
        popup_message(nl2br(htmlEntities(noteText)), 'Warehouse Notes');
      });
  }

  // Swaps which field reads as the bold "headline" on a card. HireHop's
  // own add_job_event/add_subcontractor_event always append exactly two
  // divs to the maincell td - title (bold) then OWNER_NAME (plain) - so
  // we just rewrite both in place rather than rebuilding the cell.
  // OWNER_NAME is what field the job's own page itself labels "Job name"
  // (not to be confused with DESCRIPTION, which is "Job type"). Only
  // touches cards where OWNER_NAME is actually set, so a job with no
  // name never ends up with a blank-looking bold header.
  function fixTitleEmphasis(div, data) {
    var mainCell = div.find('td.warehouse_event_maincell').first();
    if (!mainCell.length || mainCell.data('wh_title_fixed')) return;
    mainCell.data('wh_title_fixed', true);

    var jobName = data.OWNER_NAME ? String(data.OWNER_NAME) : '';
    if (!jobName) return; // nothing to promote to bold - leave HireHop's own text as-is

    var lines = mainCell.children('div');
    var boldLine = lines.eq(0);
    var smallLine = lines.eq(1);
    if (!boldLine.length) return;

    var jobNumberPrefix = data.JOB_ID != null ? '(' + data.JOB_ID + ') ' : '';
    var typeAndVenue = (data.DESCRIPTION || '') + (data.VENUE ? ' - ' + data.VENUE : '');

    boldLine.text(jobNumberPrefix + jobName);
    if (smallLine.length) {
      smallLine.text(typeAndVenue);
    } else {
      $('<div>', { text: typeAndVenue }).appendTo(mainCell);
    }
  }

  // Opens the scanning screen for a job directly, for a given "kind"
  // (1 = Prep job, 2 = Check job out, 3 = Check job in, ...). Mirrors
  // HireHop's own check_in_out() (see warehouse.js) rather than calling
  // it, since that method only ever routes to a fixed kind per row TYPE
  // (2 for TYPE 3, 3 for TYPE 4, 15 for TYPE 2, 10 for TYPE 1) - there's
  // no "open this specific kind" entry point to reuse for Prep job (1).
  function openScanScreen(jobId, kind) {
    var newTab = (typeof user !== 'undefined' && user && user.NEW_TABS == 1);
    window.open('/modules/scanning/?main_id=' + encodeURIComponent(jobId) + '&kind=' + kind, newTab ? '_blank' : '_self');
  }

  // Adds a second scan-screen icon+label ("Prep job") next to the
  // existing barcode icon, and a matching label under the existing one
  // ("Check job out") so both are clear without hovering. Restricted to
  // TYPE 3 (ordinary outgoing job rows) - subcontractor/PO rows (TYPE 2)
  // don't have a "Prep job" scan pass, and this plugin doesn't touch
  // Incoming at all (same restriction as the stripe/notes above).
  function addPrepJobLink(div, data) {
    if (data.TYPE !== 3) return;
    var barcode = div.find('img.warehouse_barcode').first();
    if (!barcode.length || barcode.data('wh_scan_links_added')) return;
    barcode.data('wh_scan_links_added', true);

    // Wrap the existing barcode <img> with a caption underneath. The
    // <img> element itself is only moved (not cloned/replaced), so
    // HireHop's own click handler - already bound directly to this
    // element before our code runs - is preserved untouched.
    var checkOutWrap = $('<span>', {
      style: 'display:inline-block; text-align:center; vertical-align:top;'
    });
    barcode.before(checkOutWrap);
    checkOutWrap.append(barcode);
    $('<div>', {
      text: 'Check job out',
      style: 'font-size:0.6em; white-space:nowrap; color:#555;'
    }).appendTo(checkOutWrap);

    var prepWrap = $('<span>', {
      style: 'display:inline-block; text-align:center; vertical-align:top; margin-left:6px; cursor:pointer;',
      title: 'Prep job'
    }).insertAfter(checkOutWrap);
    $('<img>', { src: '/images/barcode.svg' }).appendTo(prepWrap);
    $('<div>', {
      text: 'Prep job',
      style: 'font-size:0.6em; white-space:nowrap; color:#555;'
    }).appendTo(prepWrap);
    prepWrap.on('click', function () {
      openScanScreen(data.ID, 1); // 1 = Prep job
    });
  }

  // --- Prep Progress bar ---
  // (see header comment, item 5, for the full design/rationale)

  var PREP_PROGRESS_KIND = 1; // Prep job - same pass the Prep job link above opens
  var PREP_PROGRESS_MAX_CONCURRENT = 3;
  var PREP_PROGRESS_REFRESH_MS = 45000; // how often already-shown bars refresh in place
  var PREP_HEADING_TYPE = 5;
  var PREP_COMMENT_TYPE = 100;

  var prepProgressQueue = [];
  var prepProgressActive = 0;
  // jobId -> {wrap, fill, text} for whichever card currently on screen
  // shows that job's bar - lets the periodic refresh update bars in
  // place without waiting for the board's own 5-minute full rebuild.
  var prepProgressBars = {};

  // Sums ordered/scanned across every non-heading/comment row of a
  // get_prep_list.php response, clamping each line's scanned count to
  // its own ordered count first so one over-scanned item can't push the
  // overall percentage past 100%. Returns null when there's nothing on
  // the Prep job pass at all - the caller hides the bar entirely rather
  // than showing an empty/zero one.
  function computePrepProgressFromRows(rows) {
    var ordered = 0, scanned = 0;
    (rows || []).forEach(function (r) {
      if (!r || r.TYPE === PREP_HEADING_TYPE || r.TYPE === PREP_COMMENT_TYPE) return;
      if (typeof r.ordered !== 'number') return;
      var ord = r.ordered || 0;
      var scn = typeof r.scanned === 'number' ? r.scanned : 0;
      ordered += ord;
      scanned += Math.min(scn, ord);
    });
    if (ordered <= 0) return null;
    return { ordered: ordered, scanned: scanned, pct: Math.round((100 * scanned) / ordered) };
  }

  function doFetchPrepProgress(jobId) {
    var url = '/modules/scanning/get_prep_list.php?main_id=' +
      encodeURIComponent(jobId) + '&kind=' + PREP_PROGRESS_KIND;
    return fetch(url, { credentials: 'same-origin' })
      .then(function (res) { return res.json(); })
      .then(function (resp) { return computePrepProgressFromRows(resp && resp.rows); })
      .catch(function (e) {
        console.warn('[warehouse-notes-prep-colour plugin] could not load Prep job progress', e);
        return null;
      });
  }

  // Runs fetches through a small concurrency cap rather than firing one
  // per card all at once - one fetch alone measured ~500ms live, and a
  // busy board could have several Outgoing cards wanting this
  // simultaneously (at the board's own refresh, or this bar's own
  // periodic one below).
  function pumpPrepProgressQueue() {
    while (prepProgressActive < PREP_PROGRESS_MAX_CONCURRENT && prepProgressQueue.length) {
      var job = prepProgressQueue.shift();
      prepProgressActive++;
      doFetchPrepProgress(job.jobId).then(function (result) {
        job.resolve(result);
      }).then(function () {
        prepProgressActive--;
        pumpPrepProgressQueue();
      });
    }
  }

  function queuePrepProgressFetch(jobId) {
    return new Promise(function (resolve) {
      prepProgressQueue.push({ jobId: jobId, resolve: resolve });
      pumpPrepProgressQueue();
    });
  }

  function updatePrepProgressBar(jobId, result) {
    var refs = prepProgressBars[jobId];
    if (!refs) return;
    if (!$.contains(document.documentElement, refs.wrap[0])) {
      delete prepProgressBars[jobId]; // card's gone (rebuilt or filtered away) - stop tracking it
      return;
    }
    if (!result) {
      refs.wrap.hide();
      return;
    }
    refs.fill.css({
      width: result.pct + '%',
      background: result.pct >= 100 ? '#4caf50' : '#4a90d9'
    });
    refs.text.text(result.scanned + ' / ' + result.ordered + ' (' + result.pct + '%)');
    refs.wrap.show();
  }

  function loadPrepProgress(jobId) {
    queuePrepProgressFetch(jobId).then(function (result) {
      updatePrepProgressBar(jobId, result);
    });
  }

  // Re-fetches every bar currently tracked (one per distinct job shown
  // on screen right now), so progress made on a scanning terminal shows
  // up on the board without needing a full board refresh.
  function refreshAllPrepProgressBars() {
    Object.keys(prepProgressBars).forEach(function (jobId) {
      var refs = prepProgressBars[jobId];
      if (!refs || !$.contains(document.documentElement, refs.wrap[0])) {
        delete prepProgressBars[jobId];
        return;
      }
      loadPrepProgress(jobId);
    });
  }

  // Adds the bar itself, directly under the title, on OUTGOING ordinary
  // job cards only (TYPE 3 - same restriction as addPrepJobLink;
  // subcontractor/PO rows don't have a Prep job pass). Starts hidden
  // (and empty) until its fetch resolves - same "nothing to show yet"
  // convention as the note line above.
  function addPrepProgressBar(div, data) {
    if (data.TYPE !== 3) return;
    var mainCell = div.find('td.warehouse_event_maincell').first();
    if (!mainCell.length || mainCell.find('.wh_prep_progress_bar').length) return; // already added

    var wrap = $('<div>', { class: 'wh_prep_progress_bar' })
      .css({ display: 'none', margin: '3px auto 0 auto', width: '80%', 'box-sizing': 'border-box' })
      .appendTo(mainCell);
    var head = $('<div>', {
      style: 'display:flex; justify-content:space-between; align-items:baseline;' +
        'font-size:0.78em; color:#555; margin-bottom:1px;'
    }).appendTo(wrap);
    $('<span>', { text: 'Prep Progress', style: 'font-weight:bold;' }).appendTo(head);
    var text = $('<span>', { class: 'wh_prep_progress_text' }).appendTo(head);
    var track = $('<div>', {
      style: 'height:5px; border-radius:3px; background:#e4e4e4; overflow:hidden;'
    }).appendTo(wrap);
    var fill = $('<div>', {
      class: 'wh_prep_progress_fill',
      style: 'height:100%; width:0%; border-radius:3px; background:#4a90d9;' +
        'transition:width .3s ease, background .3s ease;'
    }).appendTo(track);

    prepProgressBars[data.ID] = { wrap: wrap, fill: fill, text: text };
    loadPrepProgress(data.ID);
  }

  function addIndicators(div, data) {
    if (!div || !data) return div;

    fixTitleEmphasis(div, data); // Outgoing and Incoming both

    if (!isOutgoingRow(data)) return div; // stripe/notes/Prep-job-link/Prep-Progress stay Outgoing-only

    addPrepProgressBar(div, data); // first, so it sits directly under the title

    var custom = data.CUSTOM_FIELDS || (data.JOB_DATA && data.JOB_DATA.CUSTOM_FIELDS);
    if (custom) {
      var prep = custom[PREP_COLOUR_FIELD];
      if (prep && prep.value && String(prep.value).toUpperCase() !== '#FFFFFF') {
        addPrepColourStripe(div, prep.value);
      }

      var notes = custom[WAREHOUSE_NOTES_FIELD];
      var noteText = notes && notes.value ? String(notes.value) : '';
      if (noteText) {
        addNoteLine(div, noteText);
      }
    }

    addPrepJobLink(div, data);

    return div;
  }

  function patchInstance(instance) {
    if (!instance || instance.__wh_notes_prep_plugin) return;
    instance.__wh_notes_prep_plugin = true;

    if (instance.add_job_event) {
      var origAddJobEvent = instance.add_job_event;
      instance.add_job_event = function (data) {
        var div = origAddJobEvent.apply(this, arguments);
        return addIndicators(div, data);
      };
    }

    if (instance.add_subcontractor_event) {
      var origAddSubEvent = instance.add_subcontractor_event;
      instance.add_subcontractor_event = function (data) {
        var div = origAddSubEvent.apply(this, arguments);
        return addIndicators(div, data);
      };
    }

    // Cards already on screen before the plugin loaded won't have gone
    // through the wrapped methods yet - force one refresh so they do.
    // Cheap: the widget already refreshes itself every 5 minutes anyway.
    if (instance.refresh) instance.refresh(false);

    // The board only rebuilds cards from scratch every 5 minutes (or on
    // a filter/depot/period change), which is too slow for Prep
    // Progress to feel live - refresh already-shown bars in place on a
    // much shorter timer (see PREP_PROGRESS_REFRESH_MS and
    // refreshAllPrepProgressBars).
    setInterval(refreshAllPrepProgressBars, PREP_PROGRESS_REFRESH_MS);
  }

  function findAndPatch() {
    var el = document.querySelector('.hh_warehouse');
    var instance = el && $(el).data('customWarehouse');
    if (instance) {
      patchInstance(instance);
      return true;
    }
    return false;
  }

  var waited = 0;
  var poll = setInterval(function () {
    if (findAndPatch() || (waited += POLL_INTERVAL_MS) >= POLL_TIMEOUT_MS) {
      clearInterval(poll);
    }
  }, POLL_INTERVAL_MS);
})();
