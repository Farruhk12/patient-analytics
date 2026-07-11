// ============================================================
// MedAnalytics — Аутентификация
// Вход через /api/login (сервер). Секреты не хранятся в браузере.
// ============================================================

var Auth = (function() {

  var SESSION_KEY   = 'med_session';
  var PATIENTS_KEY  = 'med_patients_cache';
  var ATTEMPTS_KEY  = 'med_login_attempts';
  var MAX_ATTEMPTS  = 5;
  var LOCKOUT_MS    = 15 * 60 * 1000;

  function getAttempts() {
    try {
      var raw = sessionStorage.getItem(ATTEMPTS_KEY);
      return raw ? JSON.parse(raw) : { count: 0, since: Date.now() };
    } catch (e) { return { count: 0, since: Date.now() }; }
  }

  function recordFailedAttempt() {
    var a = getAttempts();
    a.count++;
    a.since = a.count === 1 ? Date.now() : a.since;
    sessionStorage.setItem(ATTEMPTS_KEY, JSON.stringify(a));
  }

  function clearAttempts() {
    sessionStorage.removeItem(ATTEMPTS_KEY);
  }

  function isLockedOut() {
    var a = getAttempts();
    if (a.count < MAX_ATTEMPTS) return false;
    var elapsed = Date.now() - a.since;
    if (elapsed > LOCKOUT_MS) { clearAttempts(); return false; }
    return true;
  }

  function lockoutRemaining() {
    var a = getAttempts();
    var elapsed = Date.now() - a.since;
    return Math.ceil((LOCKOUT_MS - elapsed) / 60000);
  }

  function getSession() {
    try {
      var raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      var s = JSON.parse(raw);
      if (!s._ts || Date.now() - s._ts > 8 * 3600 * 1000) {
        clearSession();
        return null;
      }
      if (!s.token) {
        clearSession();
        return null;
      }
      return s;
    } catch (e) { return null; }
  }

  function setSession(data) {
    data._ts = Date.now();
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(data));
  }

  function clearSession() {
    sessionStorage.removeItem(SESSION_KEY);
  }

  function getToken() {
    var s = getSession();
    return s && s.token ? s.token : '';
  }

  function authHeaders() {
    var t = getToken();
    var h = { 'Content-Type': 'application/json' };
    if (t) h.Authorization = 'Bearer ' + t;
    return h;
  }

  function getPatientsAuth() {
    try {
      var raw = sessionStorage.getItem(PATIENTS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
  }

  function setPatientsAuth(list) {
    sessionStorage.setItem(PATIENTS_KEY, JSON.stringify(list));
  }

  /**
   * Асинхронный вход через /api/login.
   * @returns {Promise<{ok:boolean, role?:string, locked?:boolean, minutes?:number, attemptsLeft?:number, error?:string}>}
   */
  function login(loginVal, password) {
    if (isLockedOut()) {
      return Promise.resolve({ ok: false, locked: true, minutes: lockoutRemaining() });
    }

    loginVal = String(loginVal || '').trim().slice(0, 64);
    password = String(password || '').trim().slice(0, 128);

    if (!loginVal || !password) {
      return Promise.resolve({ ok: false, error: 'Укажите логин и пароль' });
    }

    return fetch('/api/login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: loginVal, password: password })
    }).then(function(resp) {
      return resp.json().then(function(data) {
        return { resp: resp, data: data || {} };
      }, function() {
        return { resp: resp, data: {} };
      });
    }).then(function(r) {
      if (r.resp.status === 404) {
        return {
          ok: false,
          error: 'API входа недоступен. Запустите через Vercel (vercel dev / деплой), не через статический serve.'
        };
      }
      if (!r.resp.ok || !r.data.ok || !r.data.token) {
        recordFailedAttempt();
        var a = getAttempts();
        var remaining = MAX_ATTEMPTS - a.count;
        return {
          ok: false,
          attemptsLeft: remaining > 0 ? remaining : 0,
          error: (r.data && r.data.error) || 'Неверный логин или пароль'
        };
      }

      clearAttempts();
      var user = r.data.user || {};
      setSession({
        role: user.role || 'user',
        name: user.name || loginVal,
        login: user.login || loginVal,
        accessList: user.accessList || [],
        token: r.data.token
      });
      return { ok: true, role: user.role || 'user' };
    }).catch(function(err) {
      return {
        ok: false,
        error: 'Сеть: ' + (err.message || 'не удалось связаться с /api/login')
      };
    });
  }

  function logout() {
    var headers = authHeaders();
    fetch('/api/logout', {
      method: 'POST',
      credentials: 'include',
      headers: headers
    }).catch(function() { /* ignore */ }).then(function() {
      clearSession();
      window.location.href = 'login.html';
    });
  }

  function canViewPatient(patientName) {
    var s = getSession();
    if (!s) return false;
    if (s.role === 'admin') return true;
    if (s.role === 'user') {
      if (normNameAuth(s.name) === normNameAuth(patientName)) return true;
      var list = s.accessList || [];
      for (var i = 0; i < list.length; i++) {
        if (normNameAuth(list[i]) === normNameAuth(patientName)) return true;
      }
    }
    return false;
  }

  function normNameAuth(s) {
    return String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();
  }

  function updatePatientAccess(patientName, newAccessList) {
    var s = getSession();
    if (!s || s.role !== 'admin') return false;
    var users = getPatientsAuth();
    for (var i = 0; i < users.length; i++) {
      if (users[i].name === patientName) {
        users[i].accessList = newAccessList;
        setPatientsAuth(users);
        return true;
      }
    }
    return false;
  }

  function getAllPatientsAuth() {
    var s = getSession();
    if (!s || s.role !== 'admin') return [];
    return getPatientsAuth();
  }

  function updatePatientCredentials(patientName, login, password) {
    var s = getSession();
    if (!s || s.role !== 'admin') return false;
    var users = getPatientsAuth();
    for (var i = 0; i < users.length; i++) {
      if (users[i].name === patientName) {
        users[i].login    = String(login    || '').trim().slice(0, 64);
        users[i].password = String(password || '').slice(0, 128);
        setPatientsAuth(users);
        return true;
      }
    }
    return false;
  }

  return {
    getSession:               getSession,
    getToken:                 getToken,
    authHeaders:              authHeaders,
    login:                    login,
    logout:                   logout,
    canViewPatient:           canViewPatient,
    updatePatientAccess:      updatePatientAccess,
    getAllPatientsAuth:        getAllPatientsAuth,
    updatePatientCredentials: updatePatientCredentials,
    setPatientsAuth:          setPatientsAuth,
    getPatientsAuth:          getPatientsAuth,
    isLockedOut:              isLockedOut,
    lockoutRemaining:         lockoutRemaining
  };
})();
