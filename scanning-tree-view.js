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
 * several of its methods on that instance with wrapped versions that
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
 *    This full-page fetch is cached in localStorage per job id for
 *    WAREHOUSE_NOTES_PERSIST_MAX_AGE_MS (10 minutes), so reloading the
 *    same job's screen repeatedly - the normal way these screens get
 *    used on a warehouse floor - doesn't re-fetch the whole job page
 *    every single time.
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
 *    Shrinking the Categories/Log/Boxes accordion to make room for
 *    the panel (recomputeAccordionHeight) uses the same fixed-share
 *    formula HireHop's own resize_left_pane does, which can give
 *    whichever panel is actually open (most often Boxes) less height
 *    than its own content needs - e.g. its two "Open box"/"Open new
 *    box" buttons sitting right at the bottom. The first fix tried
 *    here was to grow that panel to fit - but the panel's own
 *    container (the accordion) doesn't grow to match, so a grown
 *    panel just overflows past the accordion's box and overlaps
 *    whatever sits below it in left_pane (the "Charge for additional
 *    items"/"Hide completed items"/"Allow extras" checkboxes).
 *    recomputeAccordionHeight instead gives any panel whose content
 *    doesn't fit its own internal scrollbar: the panel's box stays
 *    exactly the size the fixed-share formula gave it, but its full
 *    content - those buttons included - stays reachable by scrolling
 *    within the panel, with nothing outside it ever covered.
 *
 * 4) Inline notes: stock item memo / item memo / item note
 *    Three distinct kinds of note, from two different places in
 *    HireHop, shown inline on the scan grid's item rows (all three of
 *    Tree/List/Grouped):
 *      - Stock item memo - a general note set once on the equipment's
 *        own catalogue record (e.g. "Make sure I have a threaded
 *        insert"), the same for every job that uses that piece of
 *        kit. HireHop shows this today only inside the "View details"
 *        popup (double-click an item, or the toolbar's "View details"
 *        button) - no inline indicator at all otherwise. Shown first,
 *        in red, prefaced "Reminder:". Not part of the scan data
 *        already loaded - fetched on demand from
 *        /modules/scanning/get_item_info.php (the same endpoint that
 *        popup uses; same-origin, existing session cookie, no API
 *        token needed), once per distinct item and cached in
 *        localStorage for STOCK_MEMO_PERSIST_MAX_AGE_MS (6 hours) -
 *        this is a catalogue-level value, the same across every job
 *        that uses the item, so a value learned on one job's screen
 *        is reused on every other job's too, and reloading the same
 *        screen doesn't re-fetch items it already knows about.
 *        Fetches are both capped (STOCK_MEMO_MAX_CONCURRENT) AND
 *        paced at least STOCK_MEMO_STAGGER_MS apart, so a big job with
 *        many distinct items doesn't fire them all in one burst - see
 *        the comment above STOCK_MEMO_MAX_CONCURRENT for why that
 *        actually matters (it's what was tripping myhirehop.com's
 *        rate-limiting on big jobs, with knock-on effects on every
 *        other open tab for about a minute after). A failed fetch
 *        (including a rate-limit block) is retried after a short
 *        cooldown rather than permanently remembered as "no memo".
 *        There's no bulk/multi-item variant of this endpoint to call
 *        instead (checked directly against a live job - passing
 *        several ids, in a couple of different forms, just silently
 *        resolves to one item or none), so caching this value rather
 *        than re-asking every reload is the available alternative to
 *        a one-request-per-item burst, not a second-best substitute
 *        for a batch call that could exist instead.
 *      - Item memo - a note typed once for this specific job's hire
 *        line (the MEMO field). Already in the loaded scan data, and
 *        HireHop already shows a small file-text icon for it with the
 *        text only visible as a hover tooltip. Shown second, in
 *        yellow, prefaced "Note:" - alongside that native icon, not
 *        replacing it.
 *      - Item note - this job line's own ADDITIONAL field. HireHop
 *        already renders this natively, inline in italics right after
 *        the item's title (its own stored text often already starts
 *        with the word "Note:" - that's simply what whoever built the
 *        job happened to type into the field, nothing to do with our
 *        own labelling below). The least important of the three, so
 *        rather than competing for attention on the item's main line
 *        it's moved to its own smaller line directly under the item,
 *        indented to line up under the item's own title rather than
 *        the icons/qty that lead the line, prefaced "Quote Note:" -
 *        the native inline copy is hidden so it isn't shown twice.
 *    All three show their full text, wrapping onto more lines rather
 *    than being cut off, and the stock item memo/item memo sit on the
 *    item's own line (wrapping there too if needed) with the item
 *    note on its own line below.
 *
 *    Implementation: rather than polling the DOM and bolting pills on
 *    after the fact (the approach originally tried here - see below),
 *    this hooks the scanning app's own render_title_cell method (the
 *    same one HireHop's own column postRender calls to draw each
 *    item's icons/qty/title - shared by all three views), the same
 *    "wrap the original" pattern used for every other method this
 *    plugin patches. That matters for the wrapping: content added
 *    *after* HireHop's own render finishes doesn't influence the row
 *    height pqGrid already settled on for that row, so DOM-appended
 *    wrapped text just gets cut off by that fixed-height,
 *    overflow:hidden cell - the exact same class of bug as the
 *    Boxes-panel one above, and for the same underlying reason (pqGrid
 *    positions every row below it by a fixed pixel offset, so growing
 *    one row's box without pqGrid's knowledge just overlaps the row
 *    after it). Hooking the render function itself means our content
 *    is part of what gets drawn on every render, but pqGrid's row
 *    height (`rowHt`) is a single fixed/configured value here too, not
 *    recalculated from actual rendered content (confirmed live -
 *    forcing a re-render after adding wrapped content left the row's
 *    height untouched). The one thing pqGrid *does* respect is a
 *    per-row override: setting `pq_ht` (and `pq_htfix: true`) directly
 *    on a row's own data object and refreshing. So this is necessarily
 *    a two-pass process - a row can't be measured until after it's
 *    been rendered with its notes in it: render once (wrapping via
 *    flex-wrap so the content lays out correctly even while the box is
 *    still too short to show all of it), measure the actual height
 *    needed, and if it didn't fit, record that height against the item
 *    and ask for a refresh - which re-renders with the override
 *    applied, this time at the right height, with every row below it
 *    shifted down correctly and nothing overlapping.
 *
 * 5) Prep Progress bar
 *    A thin progress bar across the very top of the scanning screen -
 *    above the Warehouse Notes banner/panel and above the
 *    left_pane/grid_pane row, so it's the first thing visible on the
 *    screen regardless of which scan "kind" is actually open. Always
 *    shows the job's PREP JOB (kind 1) completion specifically, never
 *    whatever kind the screen happens to be showing - so a Check-job-out
 *    screen still shows "is this job fully prepped yet", which is
 *    usually the more useful question at that point. Labelled "Prep
 *    Progress", with the bar itself plus "<scanned> / <ordered>
 *    (<pct>%)" text - not just a bare bar.
 *
 *    Data comes from /modules/scanning/get_prep_list.php?main_id=<job>
 *    &kind=1 - a flat (non-tree) summary of every line on the job's Prep
 *    job pass, each with `ordered`/`scanned`/`remain` counts. This is
 *    fetched independently of whatever grid data the screen's own
 *    "kind" has loaded (confirmed this returns full, correct totals even
 *    when the screen itself is open on a completely different kind).
 *    Totals are summed across every row that isn't a heading/comment
 *    (TYPE 5/100 - see HEADING_TYPE/COMMENT_TYPE), clamping any
 *    individual line's scanned count to its ordered count first so an
 *    over-scanned item can't push the overall percentage past 100%.
 *    Hidden entirely if the job has nothing on its Prep job pass
 *    (ordered totals to 0) or the fetch fails - same "nothing to show,
 *    so show nothing" convention as the Warehouse Notes panel.
 *
 *    Loaded once per job (on initial_data_loaded, and replayed if this
 *    plugin attaches to an already-loaded screen), refreshed immediately
 *    after any scan made while this screen itself is open on kind 1
 *    (Prep job), and otherwise re-polled every
 *    PREP_PROGRESS_POLL_INTERVAL_MS so it still catches prep work done
 *    on another terminal, or another kind's screen, while this one sits
 *    open. Being an always-visible, full-width row rather than something
 *    conditionally shown by breakpoint (unlike the Warehouse Notes
 *    panel/banner split), it has to shrink left_pane/grid_pane by its
 *    own height too whenever it's visible, same mechanism already used
 *    for the mobile notes banner (see shrinkForExtraRows).
 *
 * Verified against HireHop's own scanning.js (pqgrid.min.js v11.2.1b)
 * on a live scanning screen in September/October 2026. If HireHop
 * changes the internals of the scanning module, this may need
 * updating.
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

  // --- Lightweight persistent cache (localStorage-backed) ---
  // Used below by both the Warehouse Notes fetch and the stock item
  // memo fetches, to survive page reloads. These scanning screens get
  // reloaded constantly in practice (switching jobs, pulling to
  // refresh on a warehouse's handheld Android scanners) and the data
  // involved - a job's warehouse note, an item's catalogue memo -
  // rarely changes minute to minute, so re-fetching all of it fresh on
  // every single reload is wasted work: slow and battery-draining on
  // those low-powered scanners, and it's also what was tripping
  // myhirehop.com's CloudFront rate-limiting (a big job's Prep/Check-
  // out screen could fire 100+ item-memo requests on every reload -
  // see the stock-memo section below). A value fetched once is kept
  // here and reused on later loads until it goes stale, rather than
  // re-fetched every time.
  //
  // This is deliberately a cache, not a batch request - there's no way
  // to ask HireHop for several items' catalogue memos in one call to
  // fall back on instead: confirmed directly against
  // get_item_info.php on a live job that passing several ids (both
  // list_id=1,2,3 and list_id[]=1&list_id[]=2 forms) does NOT return
  // several items' data - it just silently resolves to one item (or
  // none), the same way the endpoint behaves for the single-id calls
  // this plugin already made before this change. The job-wide listing
  // endpoint that DOES return every item in one call
  // (get_prep_list.php, used by the Prep Progress bar below) doesn't
  // carry this catalogue-level memo field at all - only the
  // job-line-specific MEMO field (the separate, already-loaded yellow
  // pill). So the per-item request is the only way to get this value,
  // and caching it is what keeps that request from repeating every
  // time the screen reloads.
  //
  // Each "bucket" (one localStorage key) holds every cached entry for
  // one kind of data as a single JSON blob, rather than one
  // localStorage key per item - and is capped at PERSIST_MAX_ENTRIES,
  // oldest entries dropped first once it's exceeded. A real equipment
  // catalogue or job list is nowhere near that cap in practice (at a
  // few hundred bytes each, even the full cap is well under a
  // megabyte), but the cap exists so this cache can never grow without
  // bound and start weighing down the very low-powered devices it's
  // meant to help, no matter how long the plugin keeps running for.
  // Every call is wrapped in try/catch: some contexts (private
  // browsing, a full storage quota, a locked-down kiosk browser
  // profile) throw on any localStorage access at all, and this cache
  // is a pure optimisation on top of the in-memory one each feature
  // already keeps for the current page load - any failure here should
  // just behave as "nothing persisted", never break the page.
  var PERSIST_PREFIX = 'whplugin_cache:';
  var PERSIST_MAX_ENTRIES = 2000; // per bucket

  function loadPersistBucket(bucket) {
    try {
      var raw = localStorage.getItem(PERSIST_PREFIX + bucket);
      var obj = raw ? JSON.parse(raw) : null;
      return (obj && typeof obj === 'object') ? obj : {};
    } catch (e) {
      return {};
    }
  }

  function persistGet(bucket, key, maxAgeMs) {
    try {
      var entry = loadPersistBucket(bucket)[key];
      if (!entry || typeof entry.t !== 'number') return undefined;
      if (Date.now() - entry.t > maxAgeMs) return undefined; // stale
      return entry.v;
    } catch (e) {
      return undefined;
    }
  }

  function persistSet(bucket, key, value) {
    try {
      var entries = loadPersistBucket(bucket);
      entries[key] = { t: Date.now(), v: value };
      var keys = Object.keys(entries);
      if (keys.length > PERSIST_MAX_ENTRIES) {
        // Over the cap: drop the oldest-written entries, plus a bit
        // more headroom, so this isn't re-triggered on every single
        // write once the cache is full.
        keys.sort(function (a, b) { return entries[a].t - entries[b].t; });
        var dropCount = keys.length - PERSIST_MAX_ENTRIES + Math.ceil(PERSIST_MAX_ENTRIES / 4);
        for (var i = 0; i < dropCount; i++) delete entries[keys[i]];
      }
      localStorage.setItem(PERSIST_PREFIX + bucket, JSON.stringify(entries));
    } catch (e) {
      // Quota exceeded, storage disabled, etc. - skip persisting; the
      // in-memory cache for this page load still works fine either way.
    }
  }

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
  // 0 = category/sub-group container row in the Tree (e.g. "Wireless",
  //     "IEMS", "Cable" - a true parent node with a `children` array,
  //     distinct from the flat TYPE-5 heading marker above). Confirmed
  //     live (12 October 2026): always carries LIST_ID 0 and empty
  //     MEMO/ADDITIONAL - it's a structural grouping, not a real stock
  //     item or job line, so it never has real notes of its own.
  var CATEGORY_TYPE = 0;

  function isHeadingNode(node) { return node.TYPE === HEADING_TYPE; }
  function isCommentNode(node) { return node.TYPE === COMMENT_TYPE; }
  function isCategoryNode(node) { return node.TYPE === CATEGORY_TYPE; }

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
  // node as fresh and rebuild its row indices from scratch. (Row-height
  // overrides from the inline-notes feature below are re-applied
  // separately, after this stripping, by scheduleGridRefresh - they
  // aren't preserved here on purpose, same as every other pq_ field.)
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
  // but only if it actually differs from what we last painted, unless
  // force is true.
  //
  // We compare against instance.__tree_hide_plugin_sig - our OWN memory
  // of what we last told pqGrid to show - rather than reading pqGrid's
  // live dataModel.data back. We tried the latter (reasoning: it'd
  // self-heal no matter what reset the screen) but pqGrid's live tree
  // data model turns out not to be reliably comparable the way we were
  // reading it, so that comparison mismatched on basically every poll
  // tick and forced a clear+repaint every 1.5s - a constant visible
  // flicker, worse than the bug it was meant to fix. Back to comparing
  // our own cached signature, which only repaints when something
  // actually needs to change.
  //
  // That still leaves the original problem: HireHop's own code can
  // reset dataModel.data back to the full, unpruned list without going
  // through any method we hook (seen right after the automatic
  // List/Grouped/Tree tab switch on page load) - our cache doesn't
  // notice that since OUR source data hasn't changed. Rather than
  // detecting it generically, defaultToTreeIfApplicable calls this with
  // force=true a couple of times shortly after it switches to the Tree
  // tab, to directly catch and correct that specific reset.
  function applyTreeHideCompleted(instance, force) {
    if (!instance.treeGrid || !instance.hideComplete) return;
    var sourceTree = (instance.data && instance.data.tree) || [];
    var target = instance.hideComplete[0].checked
      ? pruneCompleteBranches(sourceTree)
      : cloneTreeStripped(sourceTree);
    var sig = computeSignature(target);
    if (!force && instance.__tree_hide_plugin_sig === sig) return; // already painted this
    instance.__tree_hide_plugin_sig = sig;

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
  // "...,job_id=2944,job_data={...},...\" - so we find the "{" after
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

  // How long a fetched warehouse note is trusted before a reload will
  // fetch it again - long enough that a job's Prep/Check-out screen
  // being reloaded repeatedly through a shift doesn't re-fetch the
  // job's entire page (see fetchWarehouseNote) each time, short enough
  // that a note edited mid-shift shows up for the next natural reload
  // soon after, without needing its own cache-busting UI.
  var WAREHOUSE_NOTES_PERSIST_MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes

  // Fetches the warehouse note text for a job id, using the browser's
  // existing session cookie (same-origin request - no API token
  // needed, same way the scanning screen's own get_*.php calls work).
  // Checks the persisted cache first - this fetch pulls the job's
  // ENTIRE page just to read one custom field out of it (no dedicated
  // JSON endpoint exists for this field), so it's one of the heavier
  // requests this plugin makes, and on a job-level scan screen it
  // used to re-run on every single reload.
  function fetchWarehouseNote(jobId) {
    var persisted = persistGet('warehouse_note', String(jobId), WAREHOUSE_NOTES_PERSIST_MAX_AGE_MS);
    if (persisted !== undefined) return Promise.resolve(persisted);
    return fetch('/job.php?id=' + encodeURIComponent(jobId), { credentials: 'same-origin' })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.text();
      })
      .then(function (html) {
        var jobData = extractJobData(html);
        var field = jobData && jobData.CUSTOM_FIELDS && jobData.CUSTOM_FIELDS[WAREHOUSE_NOTES_FIELD];
        var note = (field && field.value) ? String(field.value) : '';
        persistSet('warehouse_note', String(jobId), note);
        return note;
      })
      .catch(function (e) {
        console.warn('[scanning-tree-view plugin] could not load warehouse notes', e);
        // Deliberately not persisted - a transient failure (e.g. a
        // rate-limit block) should just be retried on the next
        // reload/poll, not remembered as "no note" for 10 minutes.
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

    // The fixed-share height above can give a panel's own content more
    // than it fits - most often Boxes, whose "Open box"/"Open new box"
    // buttons sit right at the bottom, past the panel's own bottom
    // edge once the notes panel has eaten into the space this formula
    // had to share out. Growing the panel to fit was the first fix
    // tried here, but that just overflows the panel past the
    // accordion's own box and overlaps whatever sits below left_pane's
    // accordion - the "Charge for additional items"/"Hide completed
    // items"/"Allow extras" checkboxes, in particular. A scrollbar
    // fixes the same problem without resizing anything: each panel's
    // own box stays exactly the size this formula gave it, but
    // whichever one doesn't fit gets an internal scrollbar so its full
    // content - those buttons included - stays reachable, with nothing
    // outside it ever covered.
    instance.accordion.find('div.accordion_panel').each(function () {
      this.style.overflowY = (this.scrollHeight > this.clientHeight) ? 'auto' : '';
    });
  }

  // Any full-width row we've inserted above the left_pane/grid_pane row
  // (the mobile notes banner, and now the always-visible Prep Progress
  // bar) is sitting there as extra height HireHop's own fixed-pixel
  // left_pane/grid_pane sizing knows nothing about, so both need to
  // shrink by the total of whichever of these rows are actually visible
  // right now, or the bottom of the grid runs past the visible area
  // (CSS grid alone won't reflow that for us here).
  function shrinkForExtraRows(instance) {
    var extra = 0;
    var banner = instance.__wh_notes_banner;
    if (banner && banner.length && banner.is(':visible')) {
      extra += (banner.outerHeight(true) || 0);
    }
    var progressBar = instance.__wh_prep_progress_bar;
    if (progressBar && progressBar.length && progressBar.is(':visible')) {
      extra += (progressBar.outerHeight(true) || 0);
    }
    if (!extra) return;
    var newHeight = Math.max(instance.left_pane.height() - extra, 200);
    instance.left_pane.height(newHeight);
    if (instance.grid_pane) instance.grid_pane.height(newHeight);
  }

  // Runs after every resize_left_pane call (HireHop's own, which
  // always resets left_pane's height to the full - notes/progress-bar-
  // unaware - value first). Order matters: shrink left_pane's outer
  // height for the extra rows above it first, then recompute the
  // accordion from whatever's left, so the adjustments compose
  // correctly however many of these extra rows are visible at once.
  function adjustLeftPaneLayout(instance) {
    shrinkForExtraRows(instance);
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

  // --- Prep Progress bar ---
  // (see header comment for the full design/rationale)

  var PREP_PROGRESS_KIND = 1; // always Prep job, regardless of the screen's own kind
  var PREP_PROGRESS_POLL_INTERVAL_MS = 45000;

  // Sums ordered/scanned across every non-heading/comment row of a
  // get_prep_list.php response, clamping each line's scanned count to
  // its own ordered count first so one over-scanned item can't push the
  // overall percentage past 100%. Returns null when there's nothing on
  // the Prep job pass at all (ordered totals to 0) - the caller treats
  // that the same as "no data", hiding the bar rather than showing an
  // empty/zero one.
  function computePrepProgressFromRows(rows) {
    var ordered = 0, scanned = 0;
    (rows || []).forEach(function (r) {
      if (!r || r.TYPE === HEADING_TYPE || r.TYPE === COMMENT_TYPE) return;
      if (typeof r.ordered !== 'number') return;
      var ord = r.ordered || 0;
      var scn = typeof r.scanned === 'number' ? r.scanned : 0;
      ordered += ord;
      scanned += Math.min(scn, ord);
    });
    if (ordered <= 0) return null;
    return { ordered: ordered, scanned: scanned, pct: Math.round((100 * scanned) / ordered) };
  }

  // Always fetches the Prep job (kind 1) pass for the given job, no
  // matter what kind the screen itself currently has open - this is a
  // standalone request, independent of the screen's own loaded grid
  // data, same endpoint confirmed live via the Warehouse board plugin.
  function fetchPrepProgress(jobId) {
    var url = '/modules/scanning/get_prep_list.php?main_id=' +
      encodeURIComponent(jobId) + '&kind=' + PREP_PROGRESS_KIND;
    return fetch(url, { credentials: 'same-origin' })
      .then(function (res) { return res.json(); })
      .then(function (resp) { return computePrepProgressFromRows(resp && resp.rows); })
      .catch(function (e) {
        console.warn('[scanning-tree-view plugin] could not load Prep job progress', e);
        return null;
      });
  }

  // Builds the bar once per instance: a full-width row above
  // left_pane/grid_pane (inserted the same way as the mobile notes
  // banner - see ensureNotesBanner), created BEFORE that banner/panel
  // on first load so it ends up topmost regardless of screen width.
  // Starts hidden, same "nothing to show yet" convention as the notes
  // panel/banner.
  function ensurePrepProgressBar(instance) {
    if (instance.__wh_prep_progress_bar) return instance.__wh_prep_progress_bar;
    if (!instance.left_pane) return null;
    var bar = $('<div>', { class: 'wh_prep_progress_bar' })
      .css({
        display: 'none',
        gridColumn: '1 / -1',
        minWidth: 0,
        width: '80%',
        margin: '0 auto 6px auto',
        boxSizing: 'border-box'
      })
      .insertBefore(instance.left_pane);
    var head = $('<div>', {
      style: 'display:flex; justify-content:space-between; align-items:baseline;' +
        'font-size:12px; margin-bottom:3px;'
    }).appendTo(bar);
    $('<span>', { text: 'Prep Progress', style: 'font-weight:bold; color:#555;' }).appendTo(head);
    var text = $('<span>', { class: 'wh_prep_progress_text', style: 'color:#555;' }).appendTo(head);
    var track = $('<div>', {
      style: 'height:6px; border-radius:3px; background:#e4e4e4; overflow:hidden;'
    }).appendTo(bar);
    var fill = $('<div>', {
      class: 'wh_prep_progress_fill',
      style: 'height:100%; width:0%; border-radius:3px; background:#4a90d9;' +
        'transition:width .3s ease, background .3s ease;'
    }).appendTo(track);
    instance.__wh_prep_progress_bar = bar;
    instance.__wh_prep_progress_fill = fill;
    instance.__wh_prep_progress_text = text;
    return bar;
  }

  // Shows/hides/updates the bar for a fetch result (or null - hides it).
  // Separate from applyPrepProgress/refreshPrepProgress below so both
  // the initial load and the periodic refresh render through one place.
  function updatePrepProgressDisplay(instance, result) {
    var bar = ensurePrepProgressBar(instance);
    if (!bar) return;
    if (!result) {
      bar.hide();
    } else {
      instance.__wh_prep_progress_fill.css({
        width: result.pct + '%',
        background: result.pct >= 100 ? '#4caf50' : '#4a90d9'
      });
      instance.__wh_prep_progress_text.text(result.scanned + ' / ' + result.ordered + ' (' + result.pct + '%)');
      bar.show();
    }
    if (instance.resize_left_pane) instance.resize_left_pane();
  }

  // Loads Prep Progress for whatever job is currently on screen. Skips
  // the fetch if we already loaded this job (tracked via
  // __wh_prep_progress_main_id - the periodic poll is what keeps an
  // already-loaded job's bar fresh from here), and bails out cleanly if
  // the user has switched jobs again before a slow fetch comes back.
  function applyPrepProgress(instance, mainId) {
    if (!instance.left_pane) return;
    if (instance.__wh_prep_progress_main_id === mainId && instance.__wh_prep_progress_bar) return;
    instance.__wh_prep_progress_main_id = mainId;
    fetchPrepProgress(mainId).then(function (result) {
      if (instance.__wh_prep_progress_main_id !== mainId) return; // job changed again meanwhile
      updatePrepProgressDisplay(instance, result);
    });
  }

  // Re-fetches and updates the bar for whatever job is already loaded,
  // without the "already loaded this job" short-circuit above - used by
  // the periodic poll, and right after a scan made on this screen while
  // it's open on the Prep job kind itself.
  function refreshPrepProgress(instance) {
    var mainId = instance.__wh_prep_progress_main_id;
    if (!mainId) return;
    fetchPrepProgress(mainId).then(function (result) {
      if (instance.__wh_prep_progress_main_id !== mainId) return; // job changed meanwhile
      updatePrepProgressDisplay(instance, result);
    });
  }

  // --- Inline notes: stock item memo / item memo / item note ---
  // (see header comment for the full design/rationale)

  var PILL_STYLE_RED =
    'display:inline-block; max-width:360px; white-space:normal; word-break:break-word;' +
    'vertical-align:middle; margin-left:4px; padding:1px 5px; font-size:0.85em;' +
    'font-style:italic; color:#a81c1c; background:#fdecea; border:1px solid #f1a9a0;' +
    'border-radius:3px;';
  var PILL_STYLE_YELLOW =
    'display:inline-block; max-width:360px; white-space:normal; word-break:break-word;' +
    'vertical-align:middle; margin-left:4px; padding:1px 5px; font-size:0.85em;' +
    'font-style:italic; color:#8a6d1a; background:#fff8dd; border:1px solid #e0c975;' +
    'border-radius:3px;';
  var NOTE_STYLE_SMALL =
    'display:block; flex-basis:100%; width:100%; box-sizing:border-box; white-space:normal;' +
    'word-break:break-word; margin-top:1px; font-size:0.78em; color:#777; font-style:italic;';

  // Gentle, on purpose: this plugin runs on low-powered handheld
  // Android scanners as well as desktop browsers, and a big job can
  // have 100+ distinct items each needing their own request (no bulk
  // endpoint exists). The concurrency cap alone used to be the only
  // throttle here, but these requests resolve almost instantly (small
  // JSON, same server) - without a minimum gap between dispatches too,
  // "3 at a time" collapses into a near-continuous burst.
  //
  // Confirmed live against HireHop's own published API docs
  // (hirehop.co.uk/api_documentation, 12 October 2026): HireHop
  // enforces a hard 60-requests-per-minute limit PER ACCOUNT (HTTP 429,
  // "User error: 429 Too many requests per minute" - reproduced live),
  // shared across EVERYTHING that account does - HireHop's own native
  // page traffic on the same screen AND every request this plugin
  // makes, all counted against the same budget. The docs explicitly
  // discourage looping requests and recommend a 2-second delay per
  // cycle if you must. An earlier version of this throttle (2
  // concurrent, 200ms stagger - roughly 300 requests/minute at full
  // tilt) was never going to be safe against a 60/minute account-wide
  // ceiling shared with native traffic, regardless of CloudFront's own
  // separate, cruder IP-level rate-based WAF rule (which a burst well
  // beyond even that pace also tripped, confirmed live, with the whole
  // site - not just this endpoint - 403ing for several minutes after).
  // Paced well under the documented budget, with concurrency 1 so nothing
  // doubles up within the same per-minute window - see
  // STOCK_MEMO_STAGGER_MS and dispatchStockMemoQueue below.
  var STOCK_MEMO_MAX_CONCURRENT = 1;
  var STOCK_MEMO_STAGGER_MS = 2000; // minimum gap between two dispatches starting, even with a free concurrency slot - matches HireHop's own documented "2 second delay per loop cycle" guidance, leaving roughly half the account's 60/minute budget free for HireHop's own native traffic on the same screen
  var STOCK_MEMO_RETRY_COOLDOWN_MS = 15000; // after a failed fetch, don't ask again for this item until this long has passed
  // Stock item memos live on the equipment's catalogue record, not the
  // job, so they're shared across every job that uses that item and
  // rarely change - a long persisted TTL is safe and saves the most.
  var STOCK_MEMO_PERSIST_MAX_AGE_MS = 6 * 60 * 60 * 1000; // 6 hours

  // Keyed by "<LIST_ID>:<TYPE>" - the same two values get_item_info.php
  // itself is keyed on (deliberately not scoped to a job id - this is
  // a catalogue-level memo, the same for every job that uses that
  // item). Value is the memo string once known ('' if the item
  // genuinely has none, so we don't ask again), or `true` while a
  // fetch for it is in flight OR queued. Seeded lazily from the
  // persisted cache (see getKnownStockMemo) rather than all at once on
  // load, since most pages only ever look up a fraction of the items
  // that have ever been cached.
  var stockMemoCache = {};
  var stockMemoInFlight = 0;
  var stockMemoQueue = []; // {instance, rowData, key} waiting their turn - see requestStockMemo
  var stockMemoLastDispatch = 0; // this tab's own view of the last dispatch time - see claimDispatchSlot for why this alone isn't enough once multiple tabs are involved
  var stockMemoFailedAt = {}; // key -> Date.now() of its last failure, for the retry cooldown
  var stockMemoDispatchTimer = null;

  // Confirmed live (12 October 2026): staff often have several scanning
  // tabs/windows open on the same browser at once. STOCK_MEMO_STAGGER_MS
  // alone only paces THIS tab's own requests - with N tabs each pacing
  // independently at the same rate, the combined rate across all of them
  // is N times faster, which could burn through HireHop's shared
  // 60-requests/minute account budget on its own even at a
  // per-tab-safe-looking pace. These two keep every tab/window of this
  // origin coordinated against ONE shared pace instead of each tab
  // having its own: the timestamp lives in localStorage (visible to
  // every tab), and claimDispatchSlot below uses the Web Locks API so
  // two tabs can't both read-then-write it at the same moment and
  // accidentally dispatch together.
  var STOCK_MEMO_SHARED_DISPATCH_KEY = PERSIST_PREFIX + 'stock_memo_last_dispatch';
  var STOCK_MEMO_LOCK_NAME = 'wh_plugin_stock_memo_dispatch';

  function readSharedLastDispatch() {
    try {
      var v = localStorage.getItem(STOCK_MEMO_SHARED_DISPATCH_KEY);
      return v ? (parseInt(v, 10) || 0) : 0;
    } catch (e) {
      return 0;
    }
  }

  function writeSharedLastDispatch(ts) {
    try {
      localStorage.setItem(STOCK_MEMO_SHARED_DISPATCH_KEY, String(ts));
    } catch (e) {
      // localStorage unavailable (private browsing, quota, kiosk lockdown)
      // - falls back to this tab's own in-memory-only pacing below.
    }
  }

  // Atomically checks-and-claims the next dispatch slot against the
  // shared, cross-tab last-dispatch time, calling back with how many ms
  // to wait (0 if the slot was claimed now). The Web Locks API serializes
  // this tiny synchronous check-and-write across every tab/frame of this
  // origin - the lock is held only for that instant, never for the
  // actual fetch itself, so it doesn't serialize requests beyond the
  // pacing decision. Falls back to this tab's own last dispatch only
  // (today's pre-12-October behaviour) in browsers without
  // navigator.locks (older Safari, some embedded/kiosk webviews).
  function claimDispatchSlot(cb) {
    function localFallback() {
      var waitMs = STOCK_MEMO_STAGGER_MS - (Date.now() - stockMemoLastDispatch);
      if (waitMs <= 0) stockMemoLastDispatch = Date.now();
      cb(Math.max(0, waitMs));
    }
    if (!window.navigator || !navigator.locks || !navigator.locks.request) {
      localFallback();
      return;
    }
    navigator.locks.request(STOCK_MEMO_LOCK_NAME, function () {
      var last = Math.max(readSharedLastDispatch(), stockMemoLastDispatch);
      var waitMs = STOCK_MEMO_STAGGER_MS - (Date.now() - last);
      if (waitMs <= 0) {
        var now = Date.now();
        stockMemoLastDispatch = now;
        writeSharedLastDispatch(now);
      }
      cb(Math.max(0, waitMs));
    }).catch(function () {
      // Lock request itself failed (e.g. the API exists but threw) -
      // degrade to this tab's own pacing rather than blocking fetches.
      localFallback();
    });
  }

  // Looks up whether we already know this item's memo - checking the
  // in-memory cache first, then falling back to (and seeding from) the
  // persisted one - WITHOUT queuing a fetch if we don't. Returns
  // undefined if genuinely unknown, `true` if a fetch is in
  // flight/queued, or the memo string (possibly '') once known.
  function getKnownStockMemo(key) {
    if (stockMemoCache.hasOwnProperty(key)) return stockMemoCache[key];
    var persisted = persistGet('stock_memo', key, STOCK_MEMO_PERSIST_MAX_AGE_MS);
    if (persisted !== undefined) {
      stockMemoCache[key] = persisted;
      return persisted;
    }
    return undefined;
  }

  // Queues a stock-memo fetch for this item unless it's already known,
  // in flight, queued, or still cooling down after a recent failure.
  // Queuing rather than fetching immediately (as this used to) is what
  // lets dispatchStockMemoQueue actually throttle the rate requests
  // leave the browser at, rather than just how many are open at once.
  function requestStockMemo(instance, rowData) {
    var key = rowData.LIST_ID + ':' + rowData.TYPE;
    if (getKnownStockMemo(key) !== undefined) return;
    var failedAt = stockMemoFailedAt[key];
    if (failedAt && (Date.now() - failedAt) < STOCK_MEMO_RETRY_COOLDOWN_MS) return;
    stockMemoCache[key] = true;
    stockMemoQueue.push({ instance: instance, rowData: rowData, key: key });
    dispatchStockMemoQueue();
  }

  // Drains stockMemoQueue at a throttled rate: at most
  // STOCK_MEMO_MAX_CONCURRENT requests in flight at once, AND at least
  // STOCK_MEMO_STAGGER_MS between any two requests actually starting -
  // see the header note on STOCK_MEMO_MAX_CONCURRENT above for why the
  // concurrency cap alone isn't enough on its own.
  function dispatchStockMemoQueue() {
    if (stockMemoDispatchTimer) return;
    var tick = function () {
      stockMemoDispatchTimer = null;
      if (!stockMemoQueue.length) return;
      if (stockMemoInFlight >= STOCK_MEMO_MAX_CONCURRENT) {
        stockMemoDispatchTimer = setTimeout(tick, STOCK_MEMO_STAGGER_MS);
        return;
      }
      claimDispatchSlot(function (waitMs) {
        if (waitMs > 0) {
          stockMemoDispatchTimer = setTimeout(tick, waitMs);
          return;
        }
        var job = stockMemoQueue.shift();
        fetchStockMemo(job.instance, job.rowData, job.key);
        if (stockMemoQueue.length) stockMemoDispatchTimer = setTimeout(tick, STOCK_MEMO_STAGGER_MS);
      });
    };
    tick();
  }

  function fetchStockMemo(instance, rowData, key) {
    stockMemoInFlight++;
    var url = '/modules/scanning/get_item_info.php' +
      '?job_id=' + encodeURIComponent(rowData.JOB_ID) +
      '&main_id=' + encodeURIComponent(instance.options.main_id) +
      '&kind=' + encodeURIComponent(instance.options.kind) +
      '&list_id=' + encodeURIComponent(rowData.LIST_ID) +
      '&type=' + encodeURIComponent(rowData.TYPE);
    fetch(url, { credentials: 'same-origin' })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status); // e.g. the 403 a rate-limit block returns
        return res.json();
      })
      .then(function (info) {
        // Confirmed live (12 October 2026): this endpoint intermittently
        // returns HTTP 200 with a valid-JSON {"error":<code>} body for a
        // request that, retried, succeeds normally with real data - not
        // tied to request rate/burst size, just an occasional flaky
        // response from the backend. Treating this as "no memo" (the
        // old behaviour) silently and permanently poisoned the cache
        // with a false-empty result for genuinely memo'd items. Route
        // it into the same catch/retry-after-cooldown path as a network
        // failure instead of accepting it as a real answer.
        if (info && info.error !== undefined) {
          throw new Error('API error ' + info.error);
        }
        var memo = (info && info.memo) ? String(info.memo) : '';
        stockMemoCache[key] = memo;
        delete stockMemoFailedAt[key];
        persistSet('stock_memo', key, memo);
      })
      .catch(function (e) {
        console.warn('[scanning-tree-view plugin] could not load stock item memo', e);
        // Don't cache a failure as "no memo" - that used to mean a
        // single transient error (a network blip, or exactly this
        // kind of rate-limit block) permanently blanked out an item's
        // reminder for the rest of the page's life, with no retry.
        // Drop the in-flight marker so it's eligible to be asked for
        // again, after a short cooldown so a genuinely persistent
        // error doesn't just retry in a tight loop.
        delete stockMemoCache[key];
        stockMemoFailedAt[key] = Date.now();
      })
      .then(function () {
        stockMemoInFlight--;
        // This item's row won't show its stock memo pill until it's
        // re-rendered - ask for a refresh once this batch of fetches
        // has settled (debounced below).
        scheduleGridRefresh(instance);
        if (stockMemoQueue.length) dispatchStockMemoQueue();
      });
  }

  // pqGrid lays out rows at a single configured height (option `rowHt`)
  // and doesn't re-measure it from whatever a postRender hook like
  // ours adds - confirmed live: forcing a re-render after adding
  // wrapped content left the row's own height/overflow untouched, the
  // same way growing the Boxes accordion panel didn't grow its
  // container (see header comment). The one thing pqGrid *does*
  // respect is a per-row override - `pq_ht` (+ `pq_htfix: true`) set
  // directly on that row's own data object - which, unlike a raw DOM
  // resize, correctly shifts every row below it down too. We can't
  // know a row needs this until after it's been rendered with its
  // notes in it, so it's a two-pass process: render and measure, then
  // (only if it didn't already fit) record the real height needed and
  // ask for a refresh.
  var ROW_HT_DEFAULT = 26; // native single-line row height
  var ROW_HT_PADDING = 4; // small safety margin so wrapped text isn't juuust clipped
  var rowHeightOverrides = {}; // "<LIST_ID>:<TYPE>" -> px height needed
  var gridRefreshTimer = null;

  function recordNeededRowHeight(rowData, neededPx) {
    var key = rowData.LIST_ID + ':' + rowData.TYPE;
    var target = Math.ceil(neededPx) + ROW_HT_PADDING;
    if (target <= ROW_HT_DEFAULT) return false; // fits already, nothing to override
    if (rowHeightOverrides[key] === target) return false; // already recorded, no change
    rowHeightOverrides[key] = target;
    return true;
  }

  // Applies any recorded height overrides onto a (possibly nested) list
  // of row data objects, matched by the same LIST_ID:TYPE key used to
  // cache them - works for the tree grid's nested data and the flat
  // list/grouped data alike.
  function applyRowHeightOverrides(nodes) {
    if (!nodes) return;
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      var key = n.LIST_ID + ':' + n.TYPE;
      if (rowHeightOverrides.hasOwnProperty(key)) {
        n.pq_ht = rowHeightOverrides[key];
        n.pq_htfix = true;
      }
      if (n.children) applyRowHeightOverrides(n.children);
    }
  }

  // Debounced: coalesces several rows discovering they need more
  // height, or several stock-memo fetches landing, in the same moment
  // into one refresh per grid rather than one refresh each.
  function scheduleGridRefresh(instance) {
    if (gridRefreshTimer) return;
    gridRefreshTimer = setTimeout(function () {
      gridRefreshTimer = null;
      ['treeGrid', 'listGrid', 'groupedGrid'].forEach(function (gridName) {
        var grid = instance[gridName];
        if (!grid) return;
        try {
          var data = grid.pqGrid('option', 'dataModel.data');
          applyRowHeightOverrides(data);
          grid.pqGrid('refreshDataAndView');
        } catch (e) {
          console.warn('[scanning-tree-view plugin] could not refresh ' + gridName, e);
        }
      });
    }, 150);
  }

  // The item note (see below) is shown on its own line under the item,
  // indented to line up under the item's own title rather than flush
  // with the icons/qty that lead the line - finds the title's own
  // plain <span> (it's the only child span with no class, no icon, no
  // qty "N x" padding) and returns how far in from the container's
  // left edge it starts. The container's own padding-left is
  // subtracted back out - it already applies once to every flex child
  // (title included) automatically, so using the raw measurement as
  // our note's margin-left would apply that same padding a second
  // time and overshoot the title's actual start by it.
  function findTitleIndent(container, title) {
    var containerPaddingLeft = parseFloat(getComputedStyle(container).paddingLeft) || 0;
    for (var i = 0; i < container.children.length; i++) {
      var child = container.children[i];
      if (child.tagName === 'SPAN' && !child.className && child.textContent === title) {
        var raw = child.getBoundingClientRect().left - container.getBoundingClientRect().left;
        return Math.max(0, Math.round(raw - containerPaddingLeft));
      }
    }
    return 0;
  }

  // Builds and inserts the three inline notes into a just-rendered
  // title cell, in order: stock item memo (red) and item memo (yellow)
  // on the item's own line (wrapping onto more lines there if needed),
  // then item note (small, grey) on its own line below. Hooked onto
  // the scanning app's own render_title_cell (see patchInstance) -
  // runs as part of HireHop's normal render cycle, not a separate DOM
  // poll, so it naturally re-runs (cleanly - render_title_cell rebuilds
  // the cell's content from scratch each time, confirmed live, so this
  // never ends up duplicating pills) on every refresh.
  function appendInlineNotes(instance, ui) {
    var rowData = ui.rowData;
    // Category container rows (TYPE 0, e.g. "Wireless"/"IEMS") always
    // carry LIST_ID 0 and have no real notes of their own (confirmed
    // live) - without this, every one of them queued a stock-memo fetch
    // for the degenerate "0:0" key, which permanently returns
    // {"error":3} (not a transient flake) and got retried forever on
    // the usual 15s cooldown, burning a slice of the rate-limit budget
    // on a request that could never succeed.
    if (!rowData || isHeadingNode(rowData) || isCommentNode(rowData) || isCategoryNode(rowData)) return;
    var cellEl = ui.cell && ui.cell.jquery ? ui.cell[0] : ui.cell;
    if (!cellEl) return;

    // The small grey gear icon HireHop renders next to every ordinary
    // stock item - its parent is the row's actual inline content
    // wrapper (icons/qty/title/native note), consistent across all
    // three views.
    var gearIcon = cellEl.querySelector('.ui-icon-gear');
    var container = gearIcon ? gearIcon.parentElement : cellEl.querySelector('div') || cellEl;
    if (!container) return;

    // HireHop renders the ADDITIONAL field inline, in italics, right
    // after the title - we show it as its own, smaller line below
    // instead (see header comment), so hide the native copy rather
    // than show it twice.
    var nativeNote = cellEl.querySelector('.italictext');
    if (nativeNote) nativeNote.style.display = 'none';

    // Lets our note wrap onto its own line below the main content
    // (via its flex-basis:100% in NOTE_STYLE_SMALL) instead of being
    // squeezed onto the same single line.
    container.style.flexWrap = 'wrap';

    var key = rowData.LIST_ID + ':' + rowData.TYPE;
    var stockMemo = getKnownStockMemo(key);
    if (stockMemo === undefined) {
      requestStockMemo(instance, rowData);
    } else if (stockMemo && stockMemo !== true) {
      // HireHop appears to copy the stock item's catalogue memo onto a
      // job line's own MEMO field at the moment the item is added to a
      // job (confirmed live, 12 October 2026 - a one-time snapshot, not
      // a live link). When that's happened, this pill and the yellow
      // one just below would show the exact same text twice. Comparing
      // trimmed strings (not raw equality) absorbs incidental
      // whitespace differences while still catching the real
      // duplicate-text case; a job line's own distinct note (e.g. "As
      // many as you can find") never matches, so this never hides a
      // genuinely different reminder.
      var jobLineMemoTrimmed = rowData.MEMO ? String(rowData.MEMO).trim() : '';
      if (String(stockMemo).trim() !== jobLineMemoTrimmed) {
        $('<span>', {
          'class': 'wh_stock_memo_inline',
          text: 'Reminder: ' + stockMemo,
          style: PILL_STYLE_RED
        }).appendTo(container);
      }
    }

    if (rowData.MEMO) {
      // HireHop's own file-text icon for this same field is still
      // shown (it's a useful at-a-glance marker even once you know
      // what it means), but its native hover tooltip duplicates the
      // text our pill already shows at all times - drop the tooltip
      // rather than show the same memo twice.
      var nativeMemoIcon = cellEl.querySelector('.ui-icon-file-text[title]');
      if (nativeMemoIcon) nativeMemoIcon.removeAttribute('title');

      $('<span>', {
        'class': 'wh_item_memo_inline',
        text: 'Note: ' + rowData.MEMO,
        style: PILL_STYLE_YELLOW
      }).appendTo(container);
    }

    if (rowData.ADDITIONAL) {
      var noteIndent = findTitleIndent(container, rowData.TITLE);
      $('<div>', {
        'class': 'wh_item_note_inline',
        text: 'Quote Note: ' + rowData.ADDITIONAL,
        style: NOTE_STYLE_SMALL + ' margin-left:' + noteIndent + 'px;'
      }).appendTo(container);
    }

    if (recordNeededRowHeight(rowData, container.scrollHeight)) {
      scheduleGridRefresh(instance);
    }
  }

  function defaultToTreeIfApplicable(instance) {
    try {
      if (
        instance.gridTabs &&
        TREE_DEFAULT_KINDS.indexOf(instance.options.kind) !== -1
      ) {
        instance.gridTabs.tabs('option', 'active', 2); // 2 = Tree tab

        // HireHop's own handling of this tab switch can reset the tree
        // grid's data back to the full, unpruned list a moment after
        // this call returns - our own repaint (called right after this,
        // in initial_data_loaded/patchInstance) runs first and is
        // correct, then something native quietly reverts it, which is
        // what made items need a manual untick+retick to actually stay
        // hidden. Force a couple of extra repaints shortly afterwards
        // to catch that - two, staggered, since we don't know exactly
        // when the native reset lands.
        setTimeout(function () { applyTreeHideCompleted(instance, true); }, 150);
        setTimeout(function () { applyTreeHideCompleted(instance, true); }, 600);
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
      // Prep Progress is built/inserted before the Warehouse Notes
      // panel/banner so it ends up topmost in the DOM (see
      // ensurePrepProgressBar) - order matters here.
      applyPrepProgress(this, this.options.main_id);
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
      // A scan made while this screen itself is open on the Prep job
      // kind directly changes what Prep Progress measures - refresh
      // right away rather than waiting for the next poll. Scans on any
      // other kind don't affect it, so leave those to the poll below
      // (keeps this cheap - no extra request on every ordinary scan).
      if (this.options.kind === PREP_PROGRESS_KIND) refreshPrepProgress(this);
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

    // Wrap render_title_cell (shared by Tree/List/Grouped - see header
    // comment) so our inline notes get added as part of HireHop's own
    // render of each item row, rather than patched on afterwards.
    if (instance.render_title_cell) {
      var origRenderTitleCell = instance.render_title_cell;
      instance.render_title_cell = function (ui, flag) {
        var result = origRenderTitleCell.apply(this, arguments);
        appendInlineNotes(this, ui);
        return result;
      };
    }

    // This plugin may have loaded after the page already created and
    // populated this instance (initial_data_loaded already fired once
    // before we could wrap it), so replay the effect now for whatever
    // state the screen is already in.
    defaultToTreeIfApplicable(instance);
    applyTreeHideCompleted(instance);
    applyPrepProgress(instance, instance.options.main_id);
    applyWarehouseNote(instance, instance.options.kind, instance.options.main_id);

    // Safety net: some updates (deleting/undoing a scan, another
    // terminal's changes arriving over HireHop's real-time sync) turn
    // out not to go through apply_data_changes, so they'd otherwise
    // leave the tree view stuck showing a stale, over-hidden state.
    // Poll and self-correct if the live data has moved on without us.
    setInterval(function () {
      applyTreeHideCompleted(instance);
    }, SYNC_POLL_INTERVAL_MS);

    // Prep Progress isn't necessarily affected by anything that happens
    // on THIS screen (another terminal could be doing the actual
    // prepping while this one sits open on a different kind), so poll
    // independently rather than relying only on the apply_data_changes
    // hook above.
    setInterval(function () {
      refreshPrepProgress(instance);
    }, PREP_PROGRESS_POLL_INTERVAL_MS);
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
