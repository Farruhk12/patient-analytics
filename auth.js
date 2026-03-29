// ============================================================
// MedAnalytics — Модуль аутентификации
// Учётные данные администратора берутся из config.js (APP_CONFIG)
// ============================================================

var Auth = (function() {

  // ── Конфигурация ───────────────────────────────────────────
  var SESSION_KEY   = 'med_session';
  var PATIENTS_KEY  = 'med_patients_cache';
  var ATTEMPTS_KEY  = 'med_login_attempts';
  var MAX_ATTEMPTS  = 5;   // блокировка после N неверных попыток
  var LOCKOUT_MS    = 15 * 60 * 1000; // 15 минут

  // ── Счётчик неверных попыток (rate-limiting) ───────────────
  function getAttempts() {
    try {
      var raw = sessionStorage.getItem(ATTEMPTS_KEY);
      return raw ? JSON.parse(raw) : { count: 0, since: Date.now() };
    } catch(e) { return { count: 0, since: Date.now() }; }
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

  // ── Учётные данные администратора из config.js ─────────────
  function getAdminCredentials() {
    var cfg = window.APP_CONFIG || {};
    return {
      login:    cfg.ADMIN_LOGIN    || 'admin',
      password: cfg.ADMIN_PASSWORD || ''
    };
  }

  // ── Сессия ─────────────────────────────────────────────────
  function getSession() {
    try {
      var raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      var s = JSON.parse(raw);
      // Проверяем срок сессии (8 часов)
      if (!s._ts || Date.now() - s._ts > 8 * 3600 * 1000) {
        clearSession();
        return null;
      }
      return s;
    } catch(e) { return null; }
  }

  function setSession(data) {
    data._ts = Date.now();
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(data));
  }

  function clearSession() {
    sessionStorage.removeItem(SESSION_KEY);
  }

  // ── Кэш пользователей ──────────────────────────────────────
  function getPatientsAuth() {
    try {
      var raw = sessionStorage.getItem(PATIENTS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch(e) { return []; }
  }

  function setPatientsAuth(list) {
    sessionStorage.setItem(PATIENTS_KEY, JSON.stringify(list));
  }

  // ── Вход ───────────────────────────────────────────────────
  function login(loginVal, password) {
    if (isLockedOut()) {
      return { ok: false, locked: true, minutes: lockoutRemaining() };
    }

    // Санитизация входных данных
    loginVal = String(loginVal || '').trim().slice(0, 64);
    password = String(password || '').slice(0, 128);

    if (!loginVal || !password) {
      return { ok: false };
    }

    var admin = getAdminCredentials();

    // Проверяем администратора
    if (loginVal === admin.login && password === admin.password) {
      clearAttempts();
      setSession({ role: 'admin', name: 'Администратор', login: loginVal });
      return { ok: true, role: 'admin' };
    }

    // Проверяем пользователей
    var users = getPatientsAuth();
    for (var i = 0; i < users.length; i++) {
      var p = users[i];
      if (p.login && p.login === loginVal && p.password && p.password === password) {
        clearAttempts();
        setSession({
          role: 'user',
          name: p.name,
          login: loginVal,
          accessList: p.accessList || []
        });
        return { ok: true, role: 'user' };
      }
    }

    recordFailedAttempt();
    var a = getAttempts();
    var remaining = MAX_ATTEMPTS - a.count;
    return { ok: false, attemptsLeft: remaining > 0 ? remaining : 0 };
  }

  // ── Выход ──────────────────────────────────────────────────
  function logout() {
    clearSession();
    window.location.href = 'login.html';
  }

  // ── Контроль доступа ───────────────────────────────────────
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

  // ── Управление доступом (только для админа) ────────────────
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
