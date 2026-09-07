/*
 * HireHop plugin: Scanning module - default to Tree view + auto-hide
 * fully-scanned items (and their accessories).
 *
 * Install: HireHop Settings > Company Settings > Plugins, paste the
 * hosted URL of this file. Bump the ?v= query param on that URL every
 * time you update the file, since browsers cache plugin scripts.
 *
 * How it works
 * ------------
 * HireHop's scanning screen ("Prep job", "Check job out", etc.) is a
 * jQuery UI widget registered as $.custom.scanning_app (see
 * /modules/scanning/scanning.js). We extend it using the standard
 * jQuery UI widget-factory pattern HireHop's own customisation guide
 * documents: redefine a few of its methods and call this._super(...)
 * to keep the original behaviour, then layer our changes on top.
 *
 * 1) Default view = Tree
 *    On every data load (initial_data_loaded - this fires on first
 *    page load AND whenever you switch job/mode from the in-page
 *    panel without a full reload), if the scan "kind" is Prep job (1)
 *    or Check job out (2), we switch the List/Grouped/Tree tab strip
 *    to the Tree tab (index 2).
 *
 * 2) Hide item + accessories once fully scanned
 *    HireHop's native "Hide completed items" checkbox only filters
 *    the flat List/Grouped grid (it calls a pqGrid "filter" on the
 *    "remain" column) - it does nothing in Tree view, which uses a
 *    completely separate grid (treeGrid) built from nested
 *    "children" arrays. So in Tree view, fully-scanned items and
 *    their accessories stay visible even with that checkbox ticked.
 *
 *    We add tree support ourselves: whenever the checkbox is ticked,
 *    we walk the tree data and remove any node whose entire subtree
 *    is complete (its own remain <= 0, and - recursively - every one
 *    of its children too). A node is only removed once the WHOLE
 *    unit (the item and everything nested under it) is done, so a
 *    kit/parent with some accessories still outstanding stays
 *    visible. This re-runs after every scan (apply_data_changes) and
 *    whenever the checkbox is toggled (show_hide_completed), so
 *    items disappear live as they're completed - not just on reload.
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

  function registerPlugin() {
    if (!$.custom || !$.custom.scanning_app) {
      return false; // base widget not loaded yet
    }
    if ($.custom.scanning_app.__patch_tree_hide_plugin) {
      return true; // already patched (e.g. plugin script ran twice)
    }

    $.widget('custom.scanning_app', $.custom.scanning_app, {

      // Runs whenever fresh scan data is loaded: first page load, and
      // every time the job/mode is switched from the in-page panel.
      initial_data_loaded: function (data) {
        this._super(data);

        var that = this;
        try {
          if (
            this.gridTabs &&
            TREE_DEFAULT_KINDS.indexOf(this.options.kind) !== -1
          ) {
            this.gridTabs.tabs('option', 'active', 2); // 2 = Tree tab
          }
        } catch (e) {
          console.warn('[scanning-tree-view plugin] could not default to Tree view', e);
        }

        this._applyTreeHideCompleted();
      },

      // Runs when the "Hide completed items" checkbox is toggled.
      show_hide_completed: function () {
        this._super();
        this._applyTreeHideCompleted();
      },

      // Runs after every scan is processed (live updates).
      apply_data_changes: function (data_changes) {
        this._super(data_changes);
        this._applyTreeHideCompleted();
      },

      // --- helpers -----------------------------------------------------

      // A node counts as "fully scanned" if it has no children and its
      // own remaining count is 0 or less, OR - if it does have children
      // (e.g. a kit, or an item with accessories nested under it) -
      // every one of those children is itself fully scanned.
      _isBranchComplete: function (node) {
        if (node.children && node.children.length) {
          for (var i = 0; i < node.children.length; i++) {
            if (!this._isBranchComplete(node.children[i])) return false;
          }
          return true;
        }
        return (node.remain || 0) <= 0;
      },

      // Returns a copy of the node list with any fully-complete
      // subtree removed. Nodes that aren't fully complete are kept,
      // but we still recurse into their children so a completed
      // sub-branch (e.g. one fully-scanned accessory group nested a
      // couple of levels down) can disappear on its own even while
      // its parent still has other outstanding items.
      _pruneCompleteBranches: function (nodes) {
        var kept = [];
        for (var i = 0; i < nodes.length; i++) {
          var node = nodes[i];
          if (this._isBranchComplete(node)) continue;
          var copy = $.extend({}, node);
          if (node.children && node.children.length) {
            copy.children = this._pruneCompleteBranches(node.children);
          }
          kept.push(copy);
        }
        return kept;
      },

      // Rebuilds the tree grid's data from the live scan data, either
      // pruned (checkbox on) or as-is (checkbox off), and repaints it.
      _applyTreeHideCompleted: function () {
        if (!this.treeGrid || !this.hideComplete) return;
        var sourceTree = (this.data && this.data.tree) || [];
        var target = this.hideComplete[0].checked
          ? this._pruneCompleteBranches(sourceTree)
          : sourceTree;
        try {
          this.treeGrid
            .pqGrid('option', 'dataModel.data', target)
            .pqGrid('refreshDataAndView');
        } catch (e) {
          console.warn('[scanning-tree-view plugin] could not refresh tree view', e);
        }
      }
    });

    $.custom.scanning_app.__patch_tree_hide_plugin = true;
    return true;
  }

  // The scanning widget's own script (scanning.js) might not have run
  // yet by the time this plugin file executes, depending on load
  // order, so retry briefly instead of failing outright.
  if (!registerPlugin()) {
    var attempts = 0;
    var timer = setInterval(function () {
      attempts++;
      if (registerPlugin() || attempts > 50) { // ~10s
        clearInterval(timer);
      }
    }, 200);
  }
})(jQuery);
