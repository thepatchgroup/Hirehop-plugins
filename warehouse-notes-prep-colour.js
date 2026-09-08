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

 Adding the note line and icon labels does make Outgoing cards a little
 taller than before; that's a deliberate trade-off the user asked for
 (wanted things "automatically in the job tile", not hidden behind a
 click/hover). The prep-colour stripe adds no height at all - it's a left
 column, not an extra line.

 Where the data comes from
 --------------------------
 This page's own list.php AJAX call already returns CUSTOM_FIELDS on every
 row it loads — confirmed live via the widget instance's `.data.rows`. So
 this plugin needs no extra network requests: it just reads fields off the
 same `data` object HireHop already attaches to each card via
 `.data("data", data)`. (Contrast with the Scanning module's Warehouse
 Notes panel — a separate plugin, scanning-tree-view.js — which has to
 fetch /job.php itself because that screen's own data doesn't carry custom
 fields.)

 Outgoing vs Incoming
 ---------------------
 HireHop's own fill_container() puts a row in the Outgoing column when
 `data.TYPE === 3 || data.TYPE === 2` and Incoming otherwise (TYPE 3/4 for
 ordinary job events via add_job_event, TYPE 2/1 for subcontractor/PO rows
 via add_subcontractor_event). This plugin uses that exact same TYPE check
 to decide which cards get the stripe/note/Prep-job-link (Prep job is
 further restricted to TYPE 3 only, ordinary jobs, not subcontractor rows
 - see addPrepJobLink). The title-emphasis swap applies regardless of
 TYPE/column, since it's just fixing which field reads as the "headline"
 and isn't specific to Outgoing.

 How it's wired in
 ------------------
 Same instance-patching approach as scanning-tree-view.js: the warehouse
 widget ($.custom.warehouse) instantiates itself immediately on page load,
 before a class-level $.widget() redefinition would reliably apply. So we
 poll for the already-created instance ($(el).data('customWarehouse')),
 then wrap add_job_event and add_subcontractor_event to call the original
 and augment the div each returns. The widget already rebuilds the whole
 card list from scratch on every refresh (every 5 minutes, or whenever a
 filter/depot/period changes), so wrapping those two methods is enough —
 no extra polling/self-heal loop needed here.
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

  function addIndicators(div, data) {
    if (!div || !data) return div;

    fixTitleEmphasis(div, data); // Outgoing and Incoming both

    if (!isOutgoingRow(data)) return div; // stripe/notes/Prep-job-link stay Outgoing-only

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
