/**
 * Herix 通用侧边栏组件
 * admin.html / merchant.html 共用，保证 badge 和选中态样式一致
 *
 * 用法:
 *   <script src="/shared/sidebar.js"></script>
 *   var items = Sidebar.navItems(navArray, { activeId: 'dashboard', onclick: "go('%s')" });
 */

var Sidebar = (function() {

  /**
   * 渲染一组导航项
   * @param {Array} nav - [{id, icon, label, badge}]
   * @param {Object} opts - { activeId: 当前页面id, onclick: "go('%s')"  → %s 会被替换为 id }
   * @returns {string} HTML
   */
  function navItems(nav, opts) {
    var activeId = opts.activeId || '';
    var onClickTmpl = opts.onclick || "go('%s')";
    return nav.map(function(n) {
      var badge = (n.badge || 0) > 0
        ? '<span class="sb-badge">' + n.badge + '</span>'
        : '';
      var cls = 'sb-item' + (activeId === n.id ? ' active' : '');
      var click = onClickTmpl.replace('%s', n.id);
      return '<div class="' + cls + '" onclick="' + click + '">'
        + (n.icon ? '<span class="sb-icon">' + n.icon + '</span>' : '')
        + n.label + badge + '</div>';
    }).join('');
  }

  return { navItems: navItems };
})();
