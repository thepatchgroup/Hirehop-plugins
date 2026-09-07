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
 * jsDelivr caches files for a while, so after editing this file on
 * GitHub, force it to pick up the change immediately by opening:
 *   https://purge.jsdelivr.net/gh/YOUR-USERNAME/YOUR-REPO@main/scanning-tree-view.js
 *
 * How it works
 * ------------
 * HireHop's scanning screen ("Prep job", "Check job out", etc.) is a
 * jQuery UI widget registered as $.custom.scanning_app (see
 * /modules/scanning/scanning.js). Rather than extending the widget
 * class before it's used (HireHop's own customisation guide describes
 * that pattern, but it only works if your plugin script runs before
 * the page creates its own instance of the widget - on the scanning
 * page it doesn't: the page creates its instance right away, before
 * there's a reliable moment to hook in first), this patches the
 * *specific instance* already running on the page directly. That
 * works no matter when our script happens to load relative to
 * HireHop's own scripts.
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
 *    visible. This re-runs after every scan and whenever the checkbox
 *    is toggled, so items disappear live as they're completed - not
 *    just on reload.
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

  // Returns a copy of the node list with any fully-complete subtree
  // removed. Nodes that aren't fully complete are kept, but we still
  // recurse into their children so a completed sub-branch (e.g. one
  // fully-scanned accessory group nested a couple of levels down) can
  // disappear on its own even while its parent still has other
  // outstanding items.
  function pruneCompleteBranches(nodes) {
    var kept = [];
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      if (isBranchComplete(node)) continue;
      var copy = $.extend({}, node);
      if (node.children && node.children.length) {
        copy.children = pruneCompleteBranches(node.children);
      }
      kept.push(copy);
    }
    return kept;
  }

  // Rebuilds the tree grid's data from the live scan data, either
  // pruned (checkbox on) or as-is (checkbox off), and repaints it.
  function applyTreeHideCompleted(instance) {
    if (!instance.treeGrid || !instance.hideComplete) return;
    var sourceTree = (instance.data && instance.data.tree) || [];
    var target = instance.hideComplete[0].checked
      ? pruneCompleteBranches(sourceTree)
      : sourceTree;
    try {
      instance.treeGrid
        .pqGrid('option', 'dataModel.data', target)
        .pqGrid('refreshDataAndView');
    } catch (e) {
      console.warn('[scanning-tree-view plugin] could not refresh tree view', e);
    }
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

    // This plugin may have loaded after the page already created and
    // populated this instance (initial_data_loaded already fired once
    // before we could wrap it), so replay the effect now for whatever
    // state the screen is already in.
    defaultToTreeIfApplicable(instance);
    applyTreeHideCompleted(instance);
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
