/**
 * Herix 统一登录模块
 * 三端共用（preview / merchant / admin）
 *
 * 用法：
 *   <script src="/shared/auth.js"></script>
 *   // 1. 渲染表单
 *   document.getElementById('app').innerHTML = Auth.loginForm({ mode: 'login' });
 *   // 2. 初始化
 *   Auth.init({ onLogin: function(user){ ... }, onError: function(msg){ ... } });
 *
 * 设计原则：
 *   - 职责单一：只做登录/注册表单和凭据管理
 *   - 开放/封闭：提供默认实现，通过 options 可定制行为
 *   - 测试友好：纯函数，不依赖全局 DOM 状态
 */

var Auth = (function() {
  var API = window.AUTH_API || '/api/auth';
  var defaults = {
    mode: 'login',         // 'login' | 'both'
    emailId: 'email',
    passwordId: 'password',
    nicknameId: 'nickname',
    errorId: 'auth-error',
    formId: 'auth-form',
    emailPlaceholder: 'your@email.com',
    passwordPlaceholder: '至少6位',
    title: '欢迎回来',
    subtitle: '登录你的账号',
    submitText: '登录',
    registerTitle: '加入赫使',
    registerSubtitle: '成为品牌与社区的桥梁',
    registerSubmitText: '注册',
    autoComplete: true,
    showRoleToggle: false,
    roleToggleLabel: '我是赫使',
    registerLink: null  // href for register link in login-only mode
  };

  /**
   * 生成登录/注册表单 HTML
   * 各端只需在自己的 loginHTML / loginPage 中调用此函数
   */
  function loginForm(opts) {
    var o = extend({}, defaults, opts || {});
    var l = o.mode === 'login';
    var h = '';
    h += '<form id="' + o.formId + '"' + (o.autoComplete ? ' autocomplete="on"' : '') + ' onsubmit="event.preventDefault();Auth.submit(\'' + o.formId + '\',\'' + o.emailId + '\',\'' + o.passwordId + '\',\'' + (l ? '' : o.nicknameId) + '\')">';
    h += '<div class="' + (o.titleClass || 'modal-title') + '">' + (l ? o.title : o.registerTitle) + '</div>';
    if (o.subtitle) h += '<div class="' + (o.subtitleClass || 'modal-sub') + '">' + (l ? o.subtitle : o.registerSubtitle) + '</div>';
    h += '<div id="' + o.formId + '-err"></div>';
    h += '<div class="' + (o.fieldClass || 'ig') + '"><label>' + (o.emailLabel || '邮箱') + '</label><input id="' + o.emailId + '" name="email" type="email"' + (o.autoComplete ? ' autocomplete="username"' : '') + ' placeholder="' + o.emailPlaceholder + '"></div>';
    if (!l && o.nicknameLabel) {
      h += '<div class="' + (o.fieldClass || 'ig') + '"><label>' + o.nicknameLabel + '</label><input id="' + o.nicknameId + '" name="nickname" placeholder="' + (o.nicknamePlaceholder || '') + '"></div>';
    }
    h += '<div class="' + (o.fieldClass || 'ig') + '"><label>' + (o.passwordLabel || '密码') + '</label><input id="' + o.passwordId + '" name="password" type="password"' + (o.autoComplete ? ' autocomplete="' + (l ? 'current-password' : 'new-password') + '"' : '') + ' placeholder="' + o.passwordPlaceholder + '"></div>';

    if (!l && o.showRoleToggle) {
      h += '<div class="' + (o.roleToggleClass || 'role-toggle') + '">';
      h += '<div class="' + (o.roleBtnClass || 'role-btn') + ' active" onclick="' + o.roleToggleScript + '">' + (o.roleToggleLabel || '我是赫使') + '</div>';
      h += '<div class="' + (o.roleBtnClass || 'role-btn') + '" onclick="' + o.otherRoleScript + '">' + (o.otherRoleLabel || '我是商家') + '</div></div>';
    }

    h += '<button class="btn btn-primary ' + (o.submitBtnClass || '') + '" type="submit"' + (o.submitStyle ? ' style="' + o.submitStyle + '"' : '') + '>' + (l ? o.submitText : o.registerSubmitText) + '</button>';
    h += '</form>';

    return h;
  }

  /**
   * 提交登录/注册
   * 由表单 onsubmit 触发，也可手动调用
   */
  function submit(formId, emailId, passwordId, nicknameId) {
    if (window.log) log('Auth.submit: form='+formId);
    var email = document.getElementById(emailId);
    var password = document.getElementById(passwordId);
    if (!email || !password) { if(window.log) log('Auth.submit ERR: inputs not found'); return; }
    var e = email.value.trim();
    var p = password.value;
    if (!e || !p) { showError(formId, '请填写邮箱和密码'); return; }

    // 判断登录还是注册：有 nickname input 就是注册
    var isRegister = nicknameId && document.getElementById(nicknameId);
    if (isRegister) {
      var nk = (document.getElementById(nicknameId) || {}).value || '';
      register(e, p, nk, formId);
    } else {
      login(e, p, formId);
    }
  }

  function login(email, password, formId) {
    var api = window.AUTH_API || '/api/auth';
    var xhr = new XMLHttpRequest();
    xhr.open('POST', api + '/login', true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.onload = function() {
      try {
        var d = JSON.parse(xhr.responseText);
        if (d.error) { if(window.log) log('Auth.login ERR: '+d.error); showError(formId, d.error); return; }
        if(window.log) log('Auth.login OK');
        saveCredential(email, password);
        if (window._authOnLogin) window._authOnLogin(d);
      } catch(e) { if(window.log) log('Auth.login EXCEPTION: '+e.message); showError(formId, '登录失败'); }
    };
    xhr.onerror = function() { if(window.log) log('Auth.login network error'); showError(formId, '网络错误'); };
    xhr.send(JSON.stringify({account: email, password: password}));
  }

  function register(email, password, nickname, formId) {
    var role = window._regRole || window._r || 'HERALD';
    var api = window.AUTH_API || '/api/auth';
    var xhr = new XMLHttpRequest();
    xhr.open('POST', api + '/register', true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.onload = function() {
      try {
        var d = JSON.parse(xhr.responseText);
        if (d.error) { showError(formId, d.error); return; }
        saveCredential(email, password);
        if (window._authOnRegister) window._authOnRegister(d);
      } catch(e) { showError(formId, '注册失败'); }
    };
    xhr.onerror = function() { showError(formId, '网络错误'); };
    xhr.send(JSON.stringify({email: email, password: password, nickname: nickname, role: role}));
  }

  function saveCredential(email, password) {
    try {
      if (window.PasswordCredential) {
        var cred = new PasswordCredential({id: email, password: password});
        navigator.credentials.store(cred);
      }
    } catch(e) {}
  }

  function showError(formId, msg) {
    var errId = formId + '-err';
    var el = document.getElementById(errId);
    if (el) { el.innerHTML = '<div style="color:#dc2626;font-size:12px;padding:8px 0">' + msg + '</div>'; return; }
    // 如果没找到专用错误容器，再看 auth-form 下的 error 区域
    var form = document.getElementById(formId);
    if (form) {
      var err = form.querySelector('.auth-error-inline');
      if (err) { err.innerHTML = msg; return; }
    }
    alert(msg);
  }

  /**
   * 配置回调
   *   Auth.init({ onLogin: fn, onRegister: fn, onError: fn })
   */
  function init(opts) {
    if (opts.onLogin) window._authOnLogin = opts.onLogin;
    if (opts.onRegister) window._authOnRegister = opts.onRegister;
    if (opts.onError) window._authOnError = opts.onError;
    if (opts.api) window.AUTH_API = opts.api;
  }

  function extend(target) {
    for (var i = 1; i < arguments.length; i++) {
      var src = arguments[i];
      if (!src) continue;
      for (var key in src) {
        if (src.hasOwnProperty(key)) target[key] = src[key];
      }
    }
    return target;
  }

  return {
    loginForm: loginForm,
    login: login,
    register: register,
    submit: submit,
    init: init,
    saveCredential: saveCredential,
    extend: extend
  };
})();
