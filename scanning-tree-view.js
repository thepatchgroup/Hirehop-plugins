/*
 * HireHop plugin: Scanning module - default to Tree view + auto-hide
 * fully-scanned items (and their accessories).
 *
 * Install: HireHop Settings > Company Settings > Plugins, paste the
 * hosted URL of this file. Use a CDN that serves it with a real
 * JavaScript content-type (jsDelivr, below) - raw.githubusercontent.com
 * serves files as text/plain, which browsers load fine as text but
 * silently refuse to *execute* as a <script>, so it will not work.
 *
 *   https://cdn.jsdelivr.net/gh/YOUR-USERNAME/YOUR-REPO@main/scanning-tree-view.js
 *
 * jsDelivr's @main alias can lag behind GitHub for a while even after
 * calling the purge endpoint. If you need a change to show up
 * immediately, use a commit-pinned URL instead (content never changes
 * for a given commit, so there's no staleness question):
 *   https://cdn.jsdelivr.net/gh/YOUR-USERNAME/YOUR-REPO@<commit-sha>/scanning-tree-view.js
 *
 * How it works
 * ------------
 * HireHop's scanning screen ("Prep job", "Check job out", etc.) is a
 * jQuery UI widget registered as $.custom.scanning_app (see
 * /modules/scanning/scanning.js). Rather than extending the widget
 * class before it's used (HireHop's own customisation guide describes
 * that pattern, but it only works if your plugin script runs before
 * the page creates its own instance of the widget - on the scanning
 * page it doesn't: the page creates its instance right away), this
 * patches the *specific instance* already running on the page
 * directly. That works no matter when our script happens to load
 * relative to HireHop's own scripts.
 *
 * We poll for the scanning widget's instance and, once found, replace
 * three of its methods on that instance with wrapped versions that
 * call the original first (so all of HireHop's own behaviour is
 * preserved) and then run our logic:
 *
 * 1) Default view = Tree
 *    Whenever fresh scan data loads (first load, and any time you
 *    switch job/mode from the in-page panel without a full page
 *    reload), if the scan "kind" is Prep job (1) or Check job out
 *    (2), we switch the List/Grouped/Tree tab strip to the Tree tab.
 *
 * 2) Hide item + accessories once fully scanned
 *    HireHop's native "Hide completed items" checkbox only filters
 *    the flat List/Grouped grid - it does nothing in Tree view, which
 *    uses a completely separate grid (treeGrid) built from nested
 *    "children" arrays. So in Tree view, fully-scanned items and
 *    their accessories stay visible even with that checkbox ticked.
 *
 *    We add tree support ourselves: whenever the checkbox is ticked,
 *    we walk the tree data and remove any node whose entire subtree
 *    is complete (its own remain <= 0, and - recursively - every one
 *    of its children too). A node is only removed once the WHOLE
 *    unit (the item and everything nested under it) is done, so a
 *    kit/parent with some accessories still outstanding stays
 *    visible.
 *
 *    This re-runs after every scan and whenever the checkbox is
 *    toggled (instant). It ALSO re-runs on a short poll (every ~1.5s)
 *    that compares the current live scan data against what's on
 *    screen and re-syncs if they've drifted - this is a safety net
 *    for updates that don't go through the methods we hook, e.g.
 *    deleting/undoing a scan, or another terminal's changes arriving
 *    over HireHop's real-time sync, both of which we found can update
 *    the underlying data without going through apply_data_changes.
 *    The poll only touches the screen when something actually
 *    changed, so it doesn't cause visible flicker.
 *
 * 3) Warehouse Notes panel
 *    The job's "Warehouse Notes" custom field (Settings > Custom
 *    fields > Job > Warehouse Notes, field name "warehouse_notes") is
 *    shown so warehouse staff can see it without leaving the scanning
 *    screen. It's fetched by requesting the job's own page
 *    (/job.php?id=<job>) with the browser's existing session cookie
 *    and picking the value out of the "job_data" object HireHop
 *    embeds in that page - there's no dedicated JSON endpoint for
 *    this, so we parse it out of the HTML. Read-only: this doesn't
 *    let you edit the note from the scanning screen, only see it.
 *    Only shown for job-level scans (Prep job / Check job out), and
 *    only when the note isn't empty - if there's nothing to say,
 *    nothing takes up any extra space, same as before this feature
 *    existed.
 *
 *    Shown in one of two places depending on screen width, so it's
 *    visible either way rather than only on desktop:
 *      - Wide screens (>675px, the same breakpoint HireHop's own
 *        scanning.js uses to decide whether Categories/Log/Boxes fit
 *        on screen): a small panel above that accordion, which
 *        shrinks to make room for it.
 *      - Narrow/mobile screens (<=675px): HireHop already hides that
 *        whole left-hand column by default there and gives the grid
 *        the full width, so instead the note shows as a banner above
 *        the grid itself, where it can't be missed without an extra
 *        tap. left_pane and grid_pane both get shrunk vertically to
 *        make room for it.
 *    Which one is actually visible is decided purely by CSS media
 *    queries, so it stays correct across window resizes/rotation
 *    without any extra JS listeners.
 *
 * Verified against HireHop's own scanning.js (pqgrid.min.js v11.2.1b)
 * on a live scanning screen in September 2026. If HireHop changes the
 * internals of the scanning module, this may need updating.
 */
(function ($) {
  'use strict';

  // Scan "kind" values (from the mode dropdown on the scanning screen)
  // that should default to Tree view. Add/remove values here if you
  // want this to apply to other modes too, e.g. 3 = "Check job in".
  var TREE_DEFAULT_KINDS = [1, 2]; // 1 = Prep job, 2 = Check job out

  // Scan "kind" values that should show the Warehouse Notes panel.
  // Job-level scans only - "main_id" is a job id for these, which is
  // what the panel needs to look up the note. Project-level kinds
  // (20-23) aren't included since main_id there is a project id, not
  // a job id.
  var WAREHOUSE_NOTES_KINDS = [1, 2]; // 1 = Prep job, 2 = Check job out

  // Field name of the custom field to show, as set up in Settings >
  // Custom fields > Job.
  var WAREHOUSE_NOTES_FIELD = 'warehouse_notes';

  // How often (ms) to re-check that the tree view matches the live
  // scan data, as a safety net for updates that bypass our hooks.
  var SYNC_POLL_INTERVAL_MS = 1500;

  // Tree node TYPE values that aren't real scannable items and have no
  // meaningful "remain" of their own (both default to remain:0 / no
  // children, which used to make isBranchComplete treat them as
  // trivially "complete" and prune them immediately - even while the
  // real items they label/annotate were still outstanding):
  //   5   = section heading ("Mains", "Subs", "Fills", "Amps", ...) -
  //         a flat marker sitting *before* the run of item siblings it
  //         groups, not a true parent with a children array.
  //   100 = inline comment/note row (see HireHop's own scanning.js,
  //         render_title_cell - it special-cases TYPE 100).
  var HEADING_TYPE = 5;
  var COMMENT_TYPE = 100;

  function isHeadingNode(node) { return node.TYPE === HEADING_TYPE; }
  function isCommentNode(node) { return node.TYPE === COMMENT_TYPE; }

  // A node counts as "fully scanned" if it has no children and its
  // own remaining count is 0 or less, OR - if it does have children
  // (e.g. a kit, or an item with accessories nested under it) - every
  // one of those children is itself fully scanned.
  function isBranchComplete(node) {
    if (node.children && node.children.length) {
      for (var i = 0; i < node.children.length; i++) {
        if (!isBranchComplete(node.children[i])) return false;
      }
      return true;
    }
    return (node.remain || 0) <= 0;
  }

  // pqGrid stamps its own bookkeeping fields (pq_ri, pq_level, pq_hidden,
  // pq_render, pq_ht, parentId, ...) directly onto each row object the
  // first time it renders the tree - these encode row *position* (pq_ri
  // is effectively "this was row N of the original, un-pruned list").
  // If we feed a shallow-copied, pruned array back in while those fields
  // are still attached, pqGrid treats the still-present rows as
  // unchanged (same pq_ri as before) and never notices anything was
  // removed, so refreshDataAndView silently does nothing - the exact bug
  // that let fully-scanned items (and complete kits, e.g. a whole "Mixed
  // Cart" once every item inside it is done) stay on screen instead of
  // disappearing. Stripping these fields forces pqGrid to treat every
  // node as fresh and rebuild its row indices from scratch.
  function stripPqGridFields(node) {
    var copy = {};
    for (var key in node) {
      if (node.hasOwnProperty(key) && key !== 'children' && key !== 'parentId' && key.indexOf('pq_') !== 0) {
        copy[key] = node[key];
      }
    }
    return copy;
  }

  // Full, unpruned clone of a flat sibling list (top-level tree or any
  // node's .children), with pqGrid's bookkeeping fields stripped from
  // every node - used for the "show everything" (checkbox unticked)
  // state. Feeding pqGrid the *live* sourceTree object references
  // directly caused two problems: it let pqGrid stamp its pq_* fields
  // straight onto the plugin's own copy of the live scan data, and once
  // stamped, toggling the checkbox back and forth fed pqGrid those same
  // objects carrying stale pq_ri values left over from an earlier
  // render at a different row count (e.g. the pruned view) - which was
  // confusing pqGrid's diffing badly enough to hide every row instead
  // of restoring them, rather than just failing to remove rows like the
  // pruned-view bug above. Cloning + stripping here the same way
  // pruneCompleteBranches already does means every checkbox toggle
  // always hands pqGrid fully fresh objects and forces a clean rebuild
  // either way.
  function cloneTreeStripped(nodes) {
    var out = [];
    for (var i = 0; i < nodes.length; i++) {
      var copy = stripPqGridFields(nodes[i]);
      if (nodes[i].children && nodes[i].children.length) {
        copy.children = cloneTreeStripped(nodes[i].children);
      }
      out.push(copy);
    }
    return out;
  }

  // True if every "real" item in this flat sibling list is itself
  // fully complete - headings and comments don't count either way, so
  // a segment made up of only a heading/comments with no real items at
  // all reads as complete (nothing left to show there).
  function segmentIsComplete(list) {
    for (var i = 0; i < list.length; i++) {
      var n = list[i];
      if (isHeadingNode(n) || isCommentNode(n)) continue;
      if (!isBranchComplete(n)) return false;
    }
    return true;
  }

  // Appends the pruned contents of one segment (a heading's group, or
  // the leading run of nodes before any heading) onto `kept`. Comments
  // always ride along untouched; real items are removed individually
  // once complete, recursing into their own children exactly as
  // before, so items keep disappearing one at a time as they're
  // scanned even while the segment as a whole stays open.
  function appendPrunedSegment(kept, segment) {
    for (var i = 0; i < segment.length; i++) {
      var node = segment[i];
      if (isCommentNode(node)) {
        kept.push(stripPqGridFields(node));
        continue;
      }
      if (isBranchComplete(node)) continue;
      var copy = stripPqGridFields(node);
      if (node.children && node.children.length) {
        copy.children = pruneCompleteBranches(node.children);
      }
      kept.push(copy);
    }
  }

  // Returns a copy of the node list with any fully-complete subtree
  // removed. Nodes that aren't fully complete are kept, but we still
  // recurse into their children so a completed sub-branch (e.g. one
  // fully-scanned accessory group nested a couple of levels down) can
  // disappear on its own even while its parent still has other
  // outstanding items.
  //
  // Headings and inline comments are handled separately from ordinary
  // items: rather than being judged complete/incomplete on their own
  // (which used to hide them immediately, regardless of the real items
  // around them), each heading opens a "segment" running up to the
  // next heading (any comments/items before the first heading form
  // their own leading segment) - a segment, heading and all, is only
  // dropped once every real item inside it is complete.
  function pruneCompleteBranches(nodes) {
    var kept = [];
    var i = 0;
    while (i < nodes.length) {
      if (isHeadingNode(nodes[i])) {
        var heading = nodes[i];
        var j = i + 1;
        while (j < nodes.length && !isHeadingNode(nodes[j])) j++;
        var group = nodes.slice(i + 1, j);
        if (!segmentIsComplete(group)) {
          kept.push(stripPqGridFields(heading));
          appendPrunedSegment(kept, group);
        }
        i = j;
        continue;
      }

      var k = i;
      while (k < nodes.length && !isHeadingNode(nodes[k])) k++;
      var leading = nodes.slice(i, k);
      if (!segmentIsComplete(leading)) {
        appendPrunedSegment(kept, leading);
      }
      i = k;
    }
    return kept;
  }

  // Cheap fingerprint of which nodes are currently kept, so the poll
  // (and the hooked methods) can tell whether the screen needs to be
  // re-rendered rather than doing it unconditionally every tick.
  function computeSignature(nodes) {
    var ids = [];
    (function walk(list) {
      for (var i = 0; i < list.length; i++) {
        ids.push(list[i].item_index || list[i].ID);
        if (list[i].children) walk(list[i].children);
      }
    })(nodes);
    return ids.length + ':' + ids.join(',');
  }

  // Rebuilds the tree grid's data from the live scan data, either
  // pruned (checkbox on) or as-is (checkbox off), and repaints it -
  // but only if it actually differs from what's currently shown.
  function applyTreeHideCompleted(instance) {
    if (!instance.treeGrid || !instance.hideComplete) return;
    var sourceTree = (instance.data && instance.data.tree) || [];
    var target = instance.hideComplete[0].checked
      ? pruneCompleteBranches(sourceTree)
      : cloneTreeStripped(sourceTree);
    var sig = computeSignature(target);

    // Compare against what pqGrid is ACTUALLY showing right now, not a
    // cached memory of what we last told it to show. Earlier this kept
    // a separate instance.__tree_hide_plugin_sig and skipped repainting
    // once that matched - but HireHop's own code can reset
    // dataModel.data back to the full, unpruned list without going
    // through any method we hook (seen right after the automatic
    // List/Grouped/Tree tab switch on page load: our code runs once,
    // correctly, but something native resets the grid a moment later).
    // Our cached signature had no way to notice that - it still
    // "remembered" being correct, so the poll below kept skipping a
    // repaint forever even though the screen had silently reverted.
    // Reading pqGrid's own live data model instead of trusting our
    // memory catches this: whatever reset it, we always know to
    // repaint when the live model doesn't match what it should be.
    var current = instance.treeGrid.pqGrid('option', 'dataModel.data') || [];
    if (computeSignature(current) === sig) return; // screen already matches

    try {
      // A single dataModel.data set + refreshDataAndView is enough when
      // it runs off a real user click (e.g. ticking the checkbox by
      // hand), but NOT when it runs automatically - from the initial
      // page load, a live scan coming in, or the safety-net poll below.
      // In those cases pqGrid can silently keep showing the previous
      // rows even though its own data model now holds the correct,
      // pruned set. Clearing to an empty array first forces pqGrid to
      // fully tear down its current rows before repainting with the
      // real target, which reliably fixes it regardless of what
      // triggered the update.
      instance.treeGrid
        .pqGrid('option', 'dataModel.data', [])
        .pqGrid('refreshDataAndView');
      instance.treeGrid
        .pqGrid('option', 'dataModel.data', target)
        .pqGrid('refreshDataAndView');
    } catch (e) {
      console.warn('[scanning-tree-view plugin] could not refresh tree view', e);
    }
  }

  // Pulls the "job_data" JS object out of a fetched /job.php page. It's
  // embedded as a plain (non-JSON-string) assignment, e.g.
  // "...,job_id=2944,job_data={...},..." - so we find the "{" after
  // "job_data=" and walk forward counting brace depth (skipping over
  // braces inside quoted strings) until it balances back to zero, then
  // JSON.parse just that slice.
  function extractJobData(html) {
    var marker = 'job_data=';
    var markerIdx = html.indexOf(marker);
    if (markerIdx === -1) return null;
    var start = html.indexOf('{', markerIdx);
    if (start === -1) return null;
    var i = start, depth = 0, inStr = false, strChar = '', esc = false;
    for (; i < html.length; i++) {
      var ch = html[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === strChar) inStr = false;
      } else {
        if (ch === '"' || ch === "'") { inStr = true; strChar = ch; }
        else if (ch === '{') depth++;
        else if (ch === '}') { depth--; if (depth === 0) { i++; break; } }
      }
    }
    try {
      return JSON.parse(html.slice(start, i));
    } catch (e) {
      return null;
    }
  }

  // Fetches the warehouse note text for a job id, using the browser's
  // existing session cookie (same-origin request - no API token
  // needed, same way the scanning screen's own get_*.php calls work).
  function fetchWarehouseNote(jobId) {
    return fetch('/job.php?id=' + encodeURIComponent(jobId), { credentials: 'same-origin' })
      .then(function (res) { return res.text(); })
      .then(function (html) {
        var jobData = extractJobData(html);
        var field = jobData && jobData.CUSTOM_FIELDS && jobData.CUSTOM_FIELDS[WAREHOUSE_NOTES_FIELD];
        return (field && field.value) ? String(field.value) : '';
      })
      .catch(function (e) {
        console.warn('[scanning-tree-view plugin] could not load warehouse notes', e);
        return '';
      });
  }

  // Breakpoint below which HireHop itself hides left_pane and gives
  // the grid the full screen width (see scanning.js's own resize()).
  // We reuse the same number so our layout switches at exactly the
  // same point HireHop's own does.
  var MOBILE_BREAKPOINT_PX = 675;

  // Injected once: which of the two note elements (see below) is
  // actually visible is driven by these media queries rather than JS,
  // so it responds to window resizes/orientation changes for free.
  // Both elements still get shown/hidden together based on whether
  // there's a note at all - this only decides which ONE of the two
  // is used to display it at the current width.
  function ensureNotesStyles() {
    if (document.getElementById('wh_notes_plugin_style')) return;
    $('<style>', {
      id: 'wh_notes_plugin_style',
      text:
        '@media (max-width:' + MOBILE_BREAKPOINT_PX + 'px){' +
        '.wh_notes_panel{display:none !important;}' +
        '}' +
        '@media (min-width:' + (MOBILE_BREAKPOINT_PX + 1) + 'px){' +
        '.wh_notes_banner{display:none !important;}' +
        '}'
    }).appendTo('head');
  }

  // Desktop/tablet: a small panel prepended above the Categories/Log/
  // Boxes accordion inside left_pane (this is what shrinks that
  // accordion to make room, per adjustLeftPaneLayout below).
  function ensureNotesPanel(instance) {
    if (instance.__wh_notes_panel) return instance.__wh_notes_panel;
    ensureNotesStyles();
    var panel = $('<div>', { class: 'wh_notes_panel' })
      .css({
        display: 'none',
        margin: '0 0 6px 0',
        padding: '6px 8px',
        background: '#fff8dd',
        border: '1px solid #e0c975',
        borderRadius: '4px',
        fontSize: '12px',
        lineHeight: '1.4',
        boxSizing: 'border-box',
        wordBreak: 'break-word'
      })
      .prependTo(instance.left_pane);
    $('<div>', { text: 'Warehouse Notes' })
      .css({ fontWeight: 'bold', marginBottom: '3px', color: '#8a6d1a' })
      .appendTo(panel);
    $('<div>', { class: 'wh_notes_panel_body' }).appendTo(panel);
    instance.__wh_notes_panel = panel;
    return panel;
  }

  // Mobile: HireHop hides left_pane below the breakpoint and gives
  // the grid the full screen, so the desktop panel above would never
  // be seen without an extra tap. Instead, on narrow screens, show
  // the same note as a full-width banner above the grid - inserted as
  // a sibling of left_pane/grid_pane (scan_scroller is a 2-column CSS
  // grid; grid-column spans both so it lands on its own row, pushing
  // left_pane/grid_pane down rather than overlapping them).
  function ensureNotesBanner(instance) {
    if (instance.__wh_notes_banner) return instance.__wh_notes_banner;
    ensureNotesStyles();
    var banner = $('<div>', { class: 'wh_notes_banner' })
      .css({
        display: 'none',
        gridColumn: '1 / -1',
        minWidth: 0,
        margin: '0 0 6px 0',
        padding: '6px 8px',
        background: '#fff8dd',
        border: '1px solid #e0c975',
        borderRadius: '4px',
        fontSize: '12px',
        lineHeight: '1.4',
        boxSizing: 'border-box',
        wordBreak: 'break-word'
      })
      .insertBefore(instance.left_pane);
    $('<div>', { text: 'Warehouse Notes' })
      .css({ fontWeight: 'bold', marginBottom: '3px', color: '#8a6d1a' })
      .appendTo(banner);
    $('<div>', { class: 'wh_notes_banner_body' }).appendTo(banner);
    instance.__wh_notes_banner = banner;
    return banner;
  }

  // Recomputes the accordion's (and its panels') height from
  // left_pane's CURRENT innerHeight, same formula HireHop's own
  // resize_left_pane uses, minus the desktop notes panel's height if
  // it's the one currently showing. Called after left_pane's own
  // outer height is finalised (see adjustLeftPaneLayout), so this
  // always reflects any shrink already applied for the mobile banner
  // too, whether or not that's the branch actually in play.
  function recomputeAccordionHeight(instance) {
    if (!instance.accordion || !instance.left_pane_buttons) return;
    var base = instance.left_pane.innerHeight() - instance.left_pane_buttons.outerHeight() - 2;
    var panel = instance.__wh_notes_panel;
    if (panel && panel.length && panel.is(':visible')) {
      base -= (panel.outerHeight(true) || 0);
    }
    if (base < 40) base = 40;
    instance.accordion.height(base);
    var panelHeight = instance.accordion.innerHeight() - instance.accordion.find('h3').length * 40;
    instance.accordion.find('div.accordion_panel').height(panelHeight);
  }

  // If the mobile banner is the one currently showing, it's sitting
  // above left_pane/grid_pane as an extra row, so both need to shrink
  // by its height or the bottom of the grid runs past the visible
  // area (HireHop sizes both with fixed pixel heights, so this has to
  // be done explicitly - CSS grid alone won't reflow that for us).
  function shrinkForMobileBanner(instance) {
    var banner = instance.__wh_notes_banner;
    if (!banner || !banner.length || !banner.is(':visible')) return;
    var extra = banner.outerHeight(true) || 0;
    if (!extra) return;
    var newHeight = Math.max(instance.left_pane.height() - extra, 200);
    instance.left_pane.height(newHeight);
    if (instance.grid_pane) instance.grid_pane.height(newHeight);
  }

  // Runs after every resize_left_pane call (HireHop's own, which
  // always resets left_pane's height to the full - notes-unaware -
  // value first). Order matters: shrink left_pane's outer height for
  // the mobile banner first, then recompute the accordion from
  // whatever's left, so the two adjustments compose correctly however
  // both are visible.
  function adjustLeftPaneLayout(instance) {
    shrinkForMobileBanner(instance);
    recomputeAccordionHeight(instance);
  }

  // Loads and displays (or hides) the warehouse notes panel/banner
  // for whatever job is currently on screen. Skips the fetch if we
  // already loaded this job's note (tracked via __wh_notes_main_id),
  // and bails out cleanly if the user has switched jobs again before
  // a slow fetch comes back.
  function applyWarehouseNote(instance, kind, mainId) {
    if (!instance.left_pane) return;
    if (WAREHOUSE_NOTES_KINDS.indexOf(kind) === -1) {
      if (instance.__wh_notes_panel) instance.__wh_notes_panel.hide();
      if (instance.__wh_notes_banner) instance.__wh_notes_banner.hide();
      return;
    }
    if (instance.__wh_notes_main_id === mainId && instance.__wh_notes_panel) return;
    instance.__wh_notes_main_id = mainId;
    fetchWarehouseNote(mainId).then(function (note) {
      if (instance.__wh_notes_main_id !== mainId) return; // job changed again meanwhile
      var panel = ensureNotesPanel(instance);
      var banner = ensureNotesBanner(instance);
      if (note) {
        panel.find('.wh_notes_panel_body').text(note);
        banner.find('.wh_notes_banner_body').text(note);
        panel.show();
        banner.show();
      } else {
        panel.hide();
        banner.hide();
      }
      if (instance.resize_left_pane) instance.resize_left_pane();
    });
  }

  function defaultToTreeIfApplicable(instance) {
    try {
      if (
        instance.gridTabs &&
        TREE_DEFAULT_KINDS.indexOf(instance.options.kind) !== -1
      ) {
        instance.gridTabs.tabs('option', 'active', 2); // 2 = Tree tab
      }
    } catch (e) {
      console.warn('[scanning-tree-view plugin] could not default to Tree view', e);
    }
  }

  // Patches a live scanning_app widget instance in place. Safe to
  // call repeatedly - it only patches an instance once.
  function patchInstance(instance) {
    if (instance.__patch_tree_hide_plugin) return;
    instance.__patch_tree_hide_plugin = true;

    var origInitialDataLoaded = instance.initial_data_loaded;
    instance.initial_data_loaded = function (data) {
      var result = origInitialDataLoaded.apply(this, arguments);
      defaultToTreeIfApplicable(this);
      applyTreeHideCompleted(this);
      applyWarehouseNote(this, this.options.kind, this.options.main_id);
      return result;
    };

    var origShowHideCompleted = instance.show_hide_completed;
    instance.show_hide_completed = function () {
      var result = origShowHideCompleted.apply(this, arguments);
      applyTreeHideCompleted(this);
      return result;
    };

    var origApplyDataChanges = instance.apply_data_changes;
    instance.apply_data_changes = function (data_changes) {
      var result = origApplyDataChanges.apply(this, arguments);
      applyTreeHideCompleted(this);
      return result;
    };

    // Wrap resize_left_pane so that whenever HireHop (re)computes the
    // Categories/Log/Boxes accordion's height - window resize, panel
    // toggled open, etc. - we get a chance to shrink it further to
    // make room for the notes panel, if it's showing.
    if (instance.resize_left_pane) {
      var origResizeLeftPane = instance.resize_left_pane;
      instance.resize_left_pane = function () {
        var result = origResizeLeftPane.apply(this, arguments);
        adjustLeftPaneLayout(this);
        return result;
      };
    }

    // This plugin may have loaded after the page already created and
    // populated this instance (initial_data_loaded already fired once
    // before we could wrap it), so replay the effect now for whatever
    // state the screen is already in.
    defaultToTreeIfApplicable(instance);
    applyTreeHideCompleted(instance);
    applyWarehouseNote(instance, instance.options.kind, instance.options.main_id);

    // Safety net: some updates (deleting/undoing a scan, another
    // terminal's changes arriving over HireHop's real-time sync) turn
    // out not to go through apply_data_changes, so they'd otherwise
    // leave the tree view stuck showing a stale, over-hidden state.
    // Poll and self-correct if the live data has moved on without us.
    setInterval(function () {
      applyTreeHideCompleted(instance);
    }, SYNC_POLL_INTERVAL_MS);
  }

  function findAndPatch() {
    var el = document.querySelector('.hh_scanning_app');
    if (!el) return;
    var instance = $(el).data('customScanning_app');
    if (!instance) return;
    patchInstance(instance);
  }

  // Poll rather than hook a specific load event: this plugin script
  // can end up running before or after HireHop creates its scanning
  // widget instance depending on page load order, and polling handles
  // both cases (and re-patches if the page ever creates a fresh
  // instance later, e.g. navigating to a different scan screen).
  findAndPatch();
  setInterval(findAndPatch, 500);
})(jQuery);
