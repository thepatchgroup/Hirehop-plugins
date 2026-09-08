/*
 HireHop Warehouse schedule plugin — Job Prep Colour + Warehouse Notes indicators.

 What it does
 ------------
 On the Warehouse module's schedule view, adds two indicators to each
 OUTGOING job card only (Incoming is left untouched, per request):

 1) A bold coloured stripe down the left edge of the card, reflecting the
    job's "Job Prep Colour" custom field (field name: Job_Prep_Colour — a
    select field whose value is a hex colour, e.g. "#FF0000"), labelled
    "PREP COLOUR" in small vertical text. Text colour (dark/light) is
    picked automatically from the stripe colour's luminance, so it stays
    legible on every option configured on this account's Custom Fields
    screen (NONE, Red, Pink, Yellow, Grey, Brown, Green, Blue, Orange,
    Purple, Cyan) and on any colour added later. Only the stripe itself is
    coloured — the rest of the card keeps its normal background. Skipped
    entirely when the field is blank or "#FFFFFF" (the field's "NONE"
    option) — no stripe.

 2) The job's "Warehouse Notes" custom field (field name: warehouse_notes),
    shown directly on the tile as a small single-line note pill (no click
    needed to see it) — only added when the field is non-empty. Clicking it
    opens the full text in HireHop's own popup_message() dialog, useful if
    the note is longer than the pill's width.

 Adding the note line does make cards with a note a little taller than
 cards without one; that's a deliberate trade-off the user asked for
 (wanted it "automatically in the job tile", not hidden behind a click).
 The prep-colour stripe adds no height at all — it's a left column, not an
 extra line.

 Where the data comes from
 --------------------------
 This page's own list.php AJAX call already returns CUSTOM_FIELDS on every
 row it loads — confirmed live via the widget instance's `.data.rows`. So
 this plugin needs no extra network requests: it just reads the field off
 the same `data` object HireHop already attaches to each card via
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
 to decide which cards to touch, so it stays correct for both row kinds.

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

  function addIndicators(div, data) {
    if (!div || !data) return div;
    if (!isOutgoingRow(data)) return div; // Incoming cards are left untouched

    var custom = data.CUSTOM_FIELDS || (data.JOB_DATA && data.JOB_DATA.CUSTOM_FIELDS);
    if (!custom) return div;

    var prep = custom[PREP_COLOUR_FIELD];
    if (prep && prep.value && String(prep.value).toUpperCase() !== '#FFFFFF') {
      addPrepColourStripe(div, prep.value);
    }

    var notes = custom[WAREHOUSE_NOTES_FIELD];
    var noteText = notes && notes.value ? String(notes.value) : '';
    if (noteText) {
      addNoteLine(div, noteText);
    }

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
