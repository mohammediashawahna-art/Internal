/**
 * Internal Medicine 63-Day Study Planner
 * Vanilla JS · LocalStorage · PWA · Offline-first
 */
(function () {
  'use strict';

  // ─── Constants ───────────────────────────────────────────
  const STORAGE_KEY = 'internalMedicinePlanner_v1';
  const START_DATE = '2026-09-27';
  const TOTAL_DAYS = 63;
  const DEFAULT_TASKS = [
    { id: 'amboss', title: 'AMBOSS Study', type: 'core', descKey: 'ambossFocus' },
    { id: 'questions', title: 'AMBOSS Questions', type: 'core', descKey: 'targetQuestions' },
    { id: 'clinical', title: 'Clinical Recall', type: 'core', descKey: 'clinicalFocus' },
    { id: 'mistakes', title: 'Review Mistakes', type: 'core', descKey: null }
  ];

  // ─── State ───────────────────────────────────────────────
  let studyPlan = [];
  let data = null;
  let currentDay = 1;
  let currentPage = 'today';
  let timerInterval = null;
  let notesDebounce = null;

  // ─── Storage ─────────────────────────────────────────────
  function defaultData() {
    return {
      version: 1,
      startDate: START_DATE,
      progress: {},       // { "1": { tasks: { amboss: true }, completedAt: null } }
      notes: {},          // { "1": "text" }
      customTasks: {},    // { "1": [{ id, title, done }] }
      deletedCore: {},    // { "1": ["amboss"] }
      mistakes: [],       // [{ id, topic, system, question, wrong, correct, date, day }]
      studySessions: [],  // [{ id, date, day, topic, task, start, end, duration, mode }]
      activeTimer: null,
      settings: {
        theme: 'light',
        focusMin: 50,
        shortBreakMin: 10,
        longBreakMin: 30,
        longBreakAfter: 3,
        sound: true,
        notifications: false,
        autoStartBreak: false,
        autoStartFocus: false,
        pomodoro: true
      }
    };
  }

  function loadData() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultData();
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return defaultData();
      // Merge with defaults for missing keys
      const def = defaultData();
      return {
        ...def,
        ...parsed,
        settings: { ...def.settings, ...(parsed.settings || {}) },
        progress: parsed.progress || {},
        notes: parsed.notes || {},
        customTasks: parsed.customTasks || {},
        deletedCore: parsed.deletedCore || {},
        mistakes: Array.isArray(parsed.mistakes) ? parsed.mistakes : [],
        studySessions: Array.isArray(parsed.studySessions) ? parsed.studySessions : [],
        activeTimer: parsed.activeTimer || null
      };
    } catch (e) {
      console.error('Load error', e);
      return defaultData();
    }
  }

  function saveData() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.error('Save error', e);
      showToast('Storage full — try exporting backup');
    }
  }

  // ─── Helpers ─────────────────────────────────────────────
  function todayStr() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function parseDate(str) {
    const [y, m, d] = str.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  function daysBetween(a, b) {
    const ms = parseDate(b) - parseDate(a);
    return Math.floor(ms / 86400000);
  }

  function getPlanDayNumber() {
    const today = todayStr();
    return daysBetween(START_DATE, today) + 1;
  }

  function getDayData(dayNum) {
    return studyPlan.find((d) => d.day === dayNum) || null;
  }

  function formatDuration(sec) {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function formatHoursMinutes(sec) {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function showToast(msg, ms = 2500) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('show'), ms);
  }

  function systemEmoji(sys) {
    const map = {
      Cardiology: '❤️',
      Respiratory: '🫁',
      Gastroenterology: '🍽️',
      Renal: '🫘',
      Endocrinology: '🦋',
      Hematology: '🩸',
      'Infectious Disease': '🦠',
      Rheumatology: '🦴',
      Neurology: '🧠',
      'Emergency/ICU': '🚨',
      'Infectious/Rheumatology': '🦠',
      'Neurology/Emergency': '🧠',
      'Mixed Revision': '📚',
      'Final Revision': '🎯',
      REST: '💤'
    };
    return map[sys] || '📖';
  }

  // ─── Day Status ──────────────────────────────────────────
  function getTasksForDay(dayNum) {
    const plan = getDayData(dayNum);
    if (!plan) return [];
    if (plan.isRest) {
      const custom = data.customTasks[dayNum] || [];
      return custom.map((t) => ({ ...t, type: 'custom' }));
    }
    const deleted = data.deletedCore[dayNum] || [];
    const core = DEFAULT_TASKS.filter((t) => !deleted.includes(t.id)).map((t) => {
      let desc = '';
      if (t.id === 'amboss') desc = plan.ambossFocus || 'Study the assigned topic.';
      else if (t.id === 'questions') desc = `Target: ${plan.targetQuestions || '—'} questions`;
      else if (t.id === 'clinical') desc = plan.clinicalFocus || '';
      else if (t.id === 'mistakes') desc = 'What did I get wrong today?';
      return { id: t.id, title: t.title, type: 'core', desc, done: !!(data.progress[dayNum]?.tasks?.[t.id]) };
    });
    const custom = (data.customTasks[dayNum] || []).map((t) => ({
      ...t,
      type: 'custom',
      done: !!t.done
    }));
    return [...core, ...custom];
  }

  function getDayStatus(dayNum) {
    const plan = getDayData(dayNum);
    if (!plan) return 'none';
    if (plan.isRest) return 'rest';
    const tasks = getTasksForDay(dayNum);
    if (tasks.length === 0) return 'none';
    const done = tasks.filter((t) => t.done).length;
    if (done === 0) {
      const today = getPlanDayNumber();
      if (dayNum < today) return 'missed';
      return 'none';
    }
    if (done >= tasks.length) return 'completed';
    return 'progress';
  }

  function isStudyDay(dayNum) {
    const tasks = getTasksForDay(dayNum);
    return tasks.some((t) => t.done);
  }

  // ─── Streak ──────────────────────────────────────────────
  function calcStreak() {
    const today = getPlanDayNumber();
    let streak = 0;
    for (let d = Math.min(today, TOTAL_DAYS); d >= 1; d--) {
      const plan = getDayData(d);
      if (plan && plan.isRest) continue;
      if (isStudyDay(d)) streak++;
      else break;
    }
    return streak;
  }

  // ─── Theme ───────────────────────────────────────────────
  function applyTheme() {
    document.documentElement.setAttribute('data-theme', data.settings.theme);
  }

  function toggleTheme() {
    data.settings.theme = data.settings.theme === 'dark' ? 'light' : 'dark';
    saveData();
    applyTheme();
    if (currentPage === 'settings') renderSettings();
  }

  // ─── Timer (timestamp-based) ─────────────────────────────
  function getTimerRemaining() {
    const t = data.activeTimer;
    if (!t) return 0;
    if (!t.isRunning) return t.remainingSeconds || 0;
    if (t.mode === 'free') {
      const elapsed = Math.floor((Date.now() - t.startTimestamp) / 1000);
      return elapsed; // free counts up
    }
    const elapsed = Math.floor((Date.now() - t.startTimestamp) / 1000);
    return Math.max(0, (t.duration || 0) - elapsed);
  }

  function isTimerRunning() {
    return data.activeTimer && data.activeTimer.isRunning;
  }

  function startTimer(mode, taskId, taskTitle) {
    const s = data.settings;
    let duration = 0;
    if (mode === 'focus') duration = s.focusMin * 60;
    else if (mode === 'short') duration = s.shortBreakMin * 60;
    else if (mode === 'long') duration = s.longBreakMin * 60;
    // free: duration 0, counts up

    const plan = getDayData(currentDay);
    data.activeTimer = {
      mode,
      taskId: taskId || null,
      taskTitle: taskTitle || '',
      topic: plan ? plan.topic : '',
      day: currentDay,
      startTimestamp: Date.now(),
      duration,
      remainingSeconds: duration,
      isRunning: true,
      focusCount: data.activeTimer?.focusCount || 0,
      sessionStart: Date.now()
    };
    if (mode === 'focus') data.activeTimer.focusCount = (data.activeTimer.focusCount || 0) + 1;
    saveData();
    startTimerTick();
    updateFloatingTimer();
    if (currentPage === 'today') renderToday();
  }

  function pauseTimer() {
    if (!data.activeTimer || !data.activeTimer.isRunning) return;
    const rem = getTimerRemaining();
    data.activeTimer.isRunning = false;
    data.activeTimer.remainingSeconds = data.activeTimer.mode === 'free' ? rem : rem;
    data.activeTimer.pausedAt = Date.now();
    // For free mode store elapsed
    if (data.activeTimer.mode === 'free') {
      data.activeTimer.elapsedFree = rem;
    }
    saveData();
    stopTimerTick();
    updateFloatingTimer();
    if (currentPage === 'today') renderToday();
  }

  function resumeTimer() {
    if (!data.activeTimer || data.activeTimer.isRunning) return;
    if (data.activeTimer.mode === 'free') {
      data.activeTimer.startTimestamp = Date.now() - (data.activeTimer.elapsedFree || 0) * 1000;
    } else {
      data.activeTimer.startTimestamp = Date.now() - (data.activeTimer.duration - data.activeTimer.remainingSeconds) * 1000;
    }
    data.activeTimer.isRunning = true;
    data.activeTimer.pausedAt = null;
    saveData();
    startTimerTick();
    updateFloatingTimer();
    if (currentPage === 'today') renderToday();
  }

  function resetTimer() {
    stopTimerTick();
    data.activeTimer = null;
    saveData();
    updateFloatingTimer();
    if (currentPage === 'today') renderToday();
  }

  function finishTimerSession(completed) {
    const t = data.activeTimer;
    if (!t) return;
    let durationSec = 0;
    if (t.mode === 'free') {
      durationSec = t.isRunning
        ? Math.floor((Date.now() - t.startTimestamp) / 1000)
        : (t.elapsedFree || 0);
    } else {
      durationSec = t.isRunning
        ? Math.min(t.duration, Math.floor((Date.now() - t.startTimestamp) / 1000))
        : (t.duration - (t.remainingSeconds || 0));
    }
    if (durationSec >= 30) {
      // only log sessions >= 30s
      data.studySessions.push({
        id: uid(),
        date: todayStr(),
        day: t.day,
        topic: t.topic,
        task: t.taskTitle || t.taskId || 'Study',
        start: t.sessionStart || t.startTimestamp,
        end: Date.now(),
        duration: durationSec,
        mode: t.mode
      });
      saveData();
    }

    const wasFocus = t.mode === 'focus';
    const focusCount = t.focusCount || 0;
    stopTimerTick();
    data.activeTimer = null;
    saveData();
    updateFloatingTimer();

    if (completed && wasFocus) {
      playSound();
      notify('Focus session complete 🎉');
      showSessionComplete(durationSec, focusCount);
    } else if (completed && (t.mode === 'short' || t.mode === 'long')) {
      playSound();
      notify('Break complete');
      showToast('Break finished — ready to focus?');
      if (data.settings.autoStartFocus) {
        startTimer('focus', null, '');
      }
    }
    if (currentPage === 'today') renderToday();
    if (currentPage === 'progress') renderProgress();
  }

  function showSessionComplete(durationSec, focusCount) {
    const s = data.settings;
    let nextMode = 'short';
    let nextLabel = 'Start Short Break';
    if (s.pomodoro && focusCount > 0 && focusCount % s.longBreakAfter === 0) {
      nextMode = 'long';
      nextLabel = 'Start Long Break';
    }
    openModal('🎉 Focus Complete', `
      <p style="text-align:center;margin-bottom:16px;">
        Great work! You completed <strong>${formatHoursMinutes(durationSec)}</strong> of focused study.
      </p>
      <button class="btn btn-primary btn-block" id="btnStartBreak">${nextLabel}</button>
      <button class="btn btn-secondary btn-block mt-8" id="btnFinishSession">Finish Session</button>
    `);
    document.getElementById('btnStartBreak').onclick = () => {
      closeModal();
      startTimer(nextMode, null, 'Break');
    };
    document.getElementById('btnFinishSession').onclick = () => closeModal();
  }

  function startTimerTick() {
    stopTimerTick();
    timerInterval = setInterval(() => {
      if (!data.activeTimer) { stopTimerTick(); return; }
      const rem = getTimerRemaining();
      updateTimerUI(rem);
      updateFloatingTimer();
      if (data.activeTimer.mode !== 'free' && rem <= 0 && data.activeTimer.isRunning) {
        finishTimerSession(true);
      }
    }, 250);
  }

  function stopTimerTick() {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
  }

  function updateTimerUI(rem) {
    const display = document.getElementById('timerDisplay');
    if (display) {
      if (data.activeTimer?.mode === 'free') {
        display.textContent = formatDuration(rem);
      } else {
        display.textContent = formatDuration(rem);
      }
    }
    const ring = document.getElementById('timerRingFg');
    if (ring && data.activeTimer && data.activeTimer.mode !== 'free' && data.activeTimer.duration) {
      const pct = rem / data.activeTimer.duration;
      const circ = 2 * Math.PI * 70;
      ring.style.strokeDasharray = circ;
      ring.style.strokeDashoffset = circ * (1 - pct);
    }
  }

  function updateFloatingTimer() {
    const el = document.getElementById('floatingTimer');
    if (!data.activeTimer || currentPage === 'today') {
      el.classList.add('hidden');
      return;
    }
    el.classList.remove('hidden');
    const rem = getTimerRemaining();
    document.getElementById('floatTime').textContent = formatDuration(rem);
    document.getElementById('floatLabel').textContent = data.activeTimer.topic || data.activeTimer.mode;
  }

  function playSound() {
    if (!data.settings.sound) return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 660;
      gain.gain.value = 0.15;
      osc.start();
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
      osc.stop(ctx.currentTime + 0.5);
    } catch (e) { /* ignore */ }
  }

  function notify(title) {
    if (!data.settings.notifications || !('Notification' in window)) return;
    if (Notification.permission === 'granted') {
      new Notification(title, { icon: 'icons/icon-192.png' });
    }
  }

  // ─── Task actions ────────────────────────────────────────
  function toggleTask(dayNum, taskId, isCustom) {
    if (isCustom) {
      const list = data.customTasks[dayNum] || [];
      const t = list.find((x) => x.id === taskId);
      if (t) t.done = !t.done;
      data.customTasks[dayNum] = list;
    } else {
      if (!data.progress[dayNum]) data.progress[dayNum] = { tasks: {} };
      data.progress[dayNum].tasks[taskId] = !data.progress[dayNum].tasks[taskId];
      const tasks = getTasksForDay(dayNum);
      if (tasks.every((t) => t.done)) {
        data.progress[dayNum].completedAt = Date.now();
        showToast('🎉 Day completed! Great work.');
      }
    }
    saveData();
    updateHeader();
    renderToday();
  }

  function addCustomTask(dayNum, title) {
    if (!title.trim()) return;
    if (!data.customTasks[dayNum]) data.customTasks[dayNum] = [];
    data.customTasks[dayNum].push({ id: uid(), title: title.trim(), done: false });
    saveData();
    renderToday();
  }

  function deleteTask(dayNum, taskId, isCustom) {
    if (isCustom) {
      data.customTasks[dayNum] = (data.customTasks[dayNum] || []).filter((t) => t.id !== taskId);
    } else {
      if (!data.deletedCore[dayNum]) data.deletedCore[dayNum] = [];
      if (!data.deletedCore[dayNum].includes(taskId)) data.deletedCore[dayNum].push(taskId);
    }
    saveData();
    renderToday();
  }

  function editTask(dayNum, taskId, isCustom, newTitle) {
    if (!newTitle.trim()) return;
    if (isCustom) {
      const t = (data.customTasks[dayNum] || []).find((x) => x.id === taskId);
      if (t) t.title = newTitle.trim();
    }
    // core tasks titles are fixed
    saveData();
    renderToday();
  }

  // ─── Notes ───────────────────────────────────────────────
  function saveNote(dayNum, text) {
    data.notes[dayNum] = text;
    saveData();
  }

  // ─── Mistakes ────────────────────────────────────────────
  function addMistake(m) {
    data.mistakes.unshift({ id: uid(), ...m, date: todayStr() });
    saveData();
  }

  function deleteMistake(id) {
    data.mistakes = data.mistakes.filter((m) => m.id !== id);
    saveData();
  }

  // ─── Render: Today ───────────────────────────────────────
  function renderToday() {
    const container = document.getElementById('todayContent');
    const planDay = getPlanDayNumber();

    // Outside plan range
    if (planDay < 1) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="icon">📅</div>
          <h2>Plan starts soon</h2>
          <p>Your study plan starts on <strong>September 27, 2026</strong>.</p>
          <button class="btn btn-primary mt-12" onclick="App.goToDay(1)">Preview Day 1</button>
        </div>`;
      return;
    }
    if (planDay > TOTAL_DAYS && currentDay > TOTAL_DAYS) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="icon">🎉</div>
          <h2>Congratulations!</h2>
          <p>You completed the 63-day plan.</p>
          <button class="btn btn-primary mt-12" onclick="App.goToDay(63)">Review Day 63</button>
        </div>`;
      return;
    }

    const dayNum = currentDay;
    const plan = getDayData(dayNum);
    if (!plan) {
      container.innerHTML = '<div class="empty-state">Day not found</div>';
      return;
    }

    const tasks = getTasksForDay(dayNum);
    const doneCount = tasks.filter((t) => t.done).length;
    const totalTasks = tasks.length;
    const pct = totalTasks ? Math.round((doneCount / totalTasks) * 100) : 0;
    const status = getDayStatus(dayNum);

    // Catch-up
    let catchupHtml = '';
    if (dayNum === planDay || dayNum === Math.min(planDay, TOTAL_DAYS)) {
      const unfinished = [];
      for (let d = 1; d < planDay && d <= TOTAL_DAYS; d++) {
        const st = getDayStatus(d);
        if (st === 'missed' || st === 'progress') unfinished.push(d);
      }
      if (unfinished.length > 0) {
        catchupHtml = `<div class="catchup-banner" onclick="App.showCatchUp()">
          You have ${unfinished.length} unfinished study day${unfinished.length > 1 ? 's' : ''}. Tap to catch up →
        </div>`;
      }
    }

    // Day nav
    const dayNav = `
      <div class="day-nav">
        <button class="day-nav-btn" ${dayNum <= 1 ? 'disabled' : ''} onclick="App.goToDay(${dayNum - 1})">← Prev</button>
        <button class="day-nav-center" onclick="App.goToDay(${Math.min(Math.max(1, planDay), TOTAL_DAYS)})">Today</button>
        <button class="day-nav-btn" ${dayNum >= TOTAL_DAYS ? 'disabled' : ''} onclick="App.goToDay(${dayNum + 1})">Next →</button>
      </div>`;

    // Progress
    const progressHtml = plan.isRest ? '' : `
      <div class="card">
        <div class="progress-text">
          <span>Today's Progress</span>
          <span>${doneCount} / ${totalTasks} tasks · ${pct}%</span>
        </div>
        <div class="progress-bar-track">
          <div class="progress-bar-fill" style="width:${pct}%"></div>
        </div>
      </div>`;

    // Completed banner
    let completedBanner = '';
    if (status === 'completed' && !plan.isRest) {
      completedBanner = `<div class="completed-banner">🎉 Day completed! Great work. See you tomorrow.</div>`;
    }

    // Day header
    const headerClass = plan.isRest ? 'day-header-card rest-day-card' : 'day-header-card';
    let dayHeader = `
      <div class="${headerClass}">
        <div class="system">${systemEmoji(plan.system)} ${plan.system}${plan.isRest ? '' : ' · Day ' + dayNum}</div>
        <div class="topic">${plan.topic}</div>`;
    if (plan.isRest) {
      dayHeader += `
        <p style="opacity:0.9;font-size:0.9rem;">Today is your scheduled rest day.<br>No study required — recharge 💤</p>
        <div class="day-meta" style="margin-top:10px;">
          <span class="day-meta-item">${plan.dayName} · ${plan.date}</span>
        </div>`;
    } else {
      dayHeader += `
        <div class="day-meta">
          <span class="day-meta-item">⏱ ${plan.studyDuration} hours</span>
          <span class="day-meta-item">❓ ${plan.targetQuestions} Qs</span>
          <span class="day-meta-item">${plan.dayName}</span>
        </div>
        <div class="action-links">
          <a class="action-link" href="https://www.amboss.com/" target="_blank" rel="noopener">Open AMBOSS</a>
          <a class="action-link" href="https://www.amboss.com/" target="_blank" rel="noopener">Questions</a>
        </div>`;
      if (plan.clinicalFocus) {
        dayHeader += `<div class="clinical-box" style="background:rgba(255,255,255,0.15);border-color:rgba(255,255,255,0.4);color:white;margin-top:12px;">
          <strong>Clinical Focus</strong><br>${plan.clinicalFocus}
        </div>`;
      }
    }
    dayHeader += '</div>';

    // Tasks
    let tasksHtml = `
      <div class="card">
        <div class="card-title">✅ Today's Tasks</div>`;
    if (tasks.length === 0 && plan.isRest) {
      tasksHtml += `<p style="color:var(--text-muted);font-size:0.9rem;">No required tasks. Add personal ones if you like.</p>`;
    }
    tasks.forEach((t) => {
      const checked = t.done ? 'checked' : '';
      const doneClass = t.done ? 'done' : '';
      tasksHtml += `
        <div class="task-item ${doneClass}">
          <div class="task-check ${checked}" onclick="App.toggleTask(${dayNum},'${t.id}',${t.type === 'custom'})" role="checkbox" aria-checked="${t.done}">
            ${t.done ? '✓' : ''}
          </div>
          <div class="task-body">
            <div class="task-title">${esc(t.title)}</div>
            ${t.desc ? `<div class="task-desc">${esc(t.desc)}</div>` : ''}
          </div>
          <div class="task-actions">
            ${t.type === 'custom' ? `<button class="task-btn" onclick="App.editTaskPrompt(${dayNum},'${t.id}')" title="Edit">✏️</button>` : ''}
            <button class="task-btn" onclick="App.deleteTaskConfirm(${dayNum},'${t.id}',${t.type === 'custom'})" title="Delete">🗑</button>
          </div>
        </div>`;
    });
    tasksHtml += `
        <button class="add-task-btn" onclick="App.showAddTask(${dayNum})">+ Add task</button>
      </div>`;

    // Timer
    const timerHtml = renderTimerCard(plan);

    // Notes
    const noteVal = data.notes[dayNum] || '';
    const notesHtml = `
      <div class="card">
        <div class="card-title">📝 My Notes</div>
        <textarea class="form-textarea" id="dayNotes" placeholder="Important points, key facts, reminders…"
          oninput="App.onNoteInput(${dayNum}, this.value)">${esc(noteVal)}</textarea>
      </div>`;

    // Mistakes quick entry for the day
    const mistakesHtml = plan.isRest ? '' : `
      <div class="card">
        <div class="card-title">❌ Review Mistakes</div>
        <p style="font-size:0.85rem;color:var(--text-secondary);margin-bottom:10px;">Log what you got wrong today.</p>
        <button class="btn btn-secondary btn-block" onclick="App.showAddMistake(${dayNum})">+ Add Mistake</button>
      </div>`;

    container.innerHTML = catchupHtml + dayNav + progressHtml + completedBanner + dayHeader + tasksHtml + timerHtml + notesHtml + mistakesHtml;

    // Restore timer UI state
    if (data.activeTimer) {
      updateTimerUI(getTimerRemaining());
      if (data.activeTimer.isRunning) startTimerTick();
    }
  }

  function renderTimerCard(plan) {
    const t = data.activeTimer;
    const s = data.settings;
    let mode = t ? t.mode : 'focus';
    let display = '00:00';
    let isRunning = false;
    let topicLabel = '';

    if (t) {
      const rem = getTimerRemaining();
      display = formatDuration(rem);
      isRunning = t.isRunning;
      topicLabel = t.topic ? `Studying: ${t.topic}` : '';
      if (t.taskTitle) topicLabel += t.topic ? ` · ${t.taskTitle}` : t.taskTitle;
    } else {
      display = formatDuration(s.focusMin * 60);
    }

    const circ = 2 * Math.PI * 70;
    let offset = circ;
    if (t && t.mode !== 'free' && t.duration) {
      const rem = getTimerRemaining();
      offset = circ * (1 - rem / t.duration);
    }

    return `
      <div class="card timer-card">
        <div class="card-title" style="justify-content:center;">⏱️ Study Timer</div>
        <div class="timer-modes">
          <button class="timer-mode-btn ${mode === 'focus' ? 'active' : ''}" onclick="App.setTimerMode('focus')">Focus</button>
          <button class="timer-mode-btn ${mode === 'short' ? 'active' : ''}" onclick="App.setTimerMode('short')">Short Break</button>
          <button class="timer-mode-btn ${mode === 'long' ? 'active' : ''}" onclick="App.setTimerMode('long')">Long Break</button>
          <button class="timer-mode-btn ${mode === 'free' ? 'active' : ''}" onclick="App.setTimerMode('free')">Free</button>
        </div>
        <div class="timer-ring-wrap">
          <svg viewBox="0 0 160 160">
            <circle class="timer-ring-bg" cx="80" cy="80" r="70"/>
            <circle class="timer-ring-fg" id="timerRingFg" cx="80" cy="80" r="70"
              stroke-dasharray="${circ}" stroke-dashoffset="${offset}"/>
          </svg>
          <div class="timer-inner">
            <div class="timer-mode-label">${mode === 'free' ? 'FREE' : mode.toUpperCase()}</div>
            <div class="timer-display" id="timerDisplay">${display}</div>
          </div>
        </div>
        ${topicLabel ? `<div class="timer-topic">${esc(topicLabel)}</div>` : ''}
        <div class="timer-controls">
          ${!t || !isRunning
            ? `<button class="timer-btn timer-btn-primary" onclick="App.timerStart()" title="Start">▶</button>`
            : `<button class="timer-btn timer-btn-primary" onclick="App.timerPause()" title="Pause">⏸</button>`}
          <button class="timer-btn timer-btn-secondary" onclick="App.timerReset()" title="Reset">↻</button>
        </div>
        <button class="btn btn-secondary btn-sm mt-12" onclick="App.quickStartFocus()">⚡ Start Focus (auto-pick task)</button>
      </div>`;
  }

  // ─── Render: Calendar ────────────────────────────────────
  function renderCalendar() {
    const grid = document.getElementById('calendarGrid');
    const planDay = getPlanDayNumber();
    let html = '';
    studyPlan.forEach((d) => {
      const st = getDayStatus(d.day);
      let statusLabel = '⚪ Not Started';
      let statusClass = 'status-none';
      if (st === 'completed') { statusLabel = '🟢 Done'; statusClass = 'status-completed'; }
      else if (st === 'progress') { statusLabel = '🟡 In Progress'; statusClass = 'status-progress'; }
      else if (st === 'missed') { statusLabel = '🔴 Missed'; statusClass = 'status-missed'; }
      else if (st === 'rest') { statusLabel = '💤 Rest'; statusClass = 'status-rest'; }
      const isToday = d.day === planDay;
      html += `
        <div class="cal-day ${isToday ? 'today' : ''}" onclick="App.goToDay(${d.day});App.navigate('today')">
          <div class="cal-num">Day ${d.day}</div>
          <div class="cal-topic">${esc(d.topic)}</div>
          <div class="cal-status ${statusClass}">${statusLabel}</div>
        </div>`;
    });
    grid.innerHTML = html;
  }

  // ─── Render: Progress ────────────────────────────────────
  function renderProgress() {
    const container = document.getElementById('progressContent');
    let completedDays = 0, studyDays = 0, totalTasksDone = 0, totalTasksPossible = 0;
    for (let d = 1; d <= TOTAL_DAYS; d++) {
      const plan = getDayData(d);
      if (!plan || plan.isRest) continue;
      const tasks = getTasksForDay(d);
      totalTasksPossible += tasks.length;
      const done = tasks.filter((t) => t.done).length;
      totalTasksDone += done;
      if (done > 0) studyDays++;
      if (done >= tasks.length && tasks.length > 0) completedDays++;
    }

    // Study time stats
    const sessions = data.studySessions || [];
    const totalSec = sessions.reduce((s, x) => s + (x.duration || 0), 0);
    const today = todayStr();
    const todaySec = sessions.filter((x) => x.date === today).reduce((s, x) => s + x.duration, 0);
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const weekSec = sessions.filter((x) => parseDate(x.date) >= weekAgo).reduce((s, x) => s + x.duration, 0);
    const avgSession = sessions.length ? Math.round(totalSec / sessions.length) : 0;
    const longest = sessions.reduce((m, x) => Math.max(m, x.duration || 0), 0);

    // Chart last 7 days
    const chartDays = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const ds = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      const sec = sessions.filter((x) => x.date === ds).reduce((s, x) => s + x.duration, 0);
      const label = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()];
      chartDays.push({ label, sec, ds });
    }
    const maxSec = Math.max(...chartDays.map((c) => c.sec), 1);

    let chartHtml = '<div class="chart-bars">';
    chartDays.forEach((c) => {
      const w = Math.round((c.sec / maxSec) * 100);
      chartHtml += `
        <div class="chart-row">
          <div class="chart-label">${c.label}</div>
          <div class="chart-bar-track"><div class="chart-bar-fill" style="width:${w}%"></div></div>
          <div class="chart-value">${c.sec ? formatHoursMinutes(c.sec) : '—'}</div>
        </div>`;
    });
    chartHtml += '</div>';

    // Recent sessions
    const recent = [...sessions].reverse().slice(0, 10);
    let sessionsHtml = recent.length === 0
      ? '<p style="color:var(--text-muted);font-size:0.85rem;">No sessions yet. Start the timer!</p>'
      : recent.map((s) => `
        <div class="session-item">
          <div>
            <div style="font-weight:500;">${esc(s.topic || 'Study')}</div>
            <div style="font-size:0.75rem;color:var(--text-muted);">${s.date} · ${esc(s.task)} · ${s.mode}</div>
          </div>
          <div class="session-dur">${formatHoursMinutes(s.duration)}</div>
        </div>`).join('');

    const overallPct = Math.round((completedDays / (TOTAL_DAYS - 9)) * 100) || 0; // ~9 rest days

    container.innerHTML = `
      <div class="card">
        <div class="card-title">📊 Overall Progress</div>
        <div class="progress-text">
          <span>${completedDays} / ${TOTAL_DAYS} days completed</span>
          <span>${overallPct}%</span>
        </div>
        <div class="progress-bar-track">
          <div class="progress-bar-fill" style="width:${Math.min(100, (completedDays / TOTAL_DAYS) * 100)}%"></div>
        </div>
      </div>

      <div class="stats-grid">
        <div class="stat-card"><div class="stat-value">${totalTasksDone}</div><div class="stat-label">Tasks Done</div></div>
        <div class="stat-card"><div class="stat-value">${studyDays}</div><div class="stat-label">Study Days</div></div>
        <div class="stat-card"><div class="stat-value">${completedDays}</div><div class="stat-label">Completed Topics</div></div>
        <div class="stat-card"><div class="stat-value">${calcStreak()}</div><div class="stat-label">🔥 Streak</div></div>
      </div>

      <div class="card">
        <div class="card-title">📚 Study Statistics</div>
        <div class="stats-grid">
          <div class="stat-card"><div class="stat-value">${formatHoursMinutes(totalSec)}</div><div class="stat-label">Total Study</div></div>
          <div class="stat-card"><div class="stat-value">${formatHoursMinutes(todaySec)}</div><div class="stat-label">Today</div></div>
          <div class="stat-card"><div class="stat-value">${formatHoursMinutes(weekSec)}</div><div class="stat-label">This Week</div></div>
          <div class="stat-card"><div class="stat-value">${sessions.length}</div><div class="stat-label">Sessions</div></div>
          <div class="stat-card"><div class="stat-value">${formatHoursMinutes(avgSession)}</div><div class="stat-label">Avg Session</div></div>
          <div class="stat-card"><div class="stat-value">${formatHoursMinutes(longest)}</div><div class="stat-label">Longest</div></div>
        </div>
      </div>

      <div class="card">
        <div class="card-title">📈 Study Time (Last 7 Days)</div>
        ${chartHtml}
      </div>

      <div class="card">
        <div class="card-title">🕐 Recent Sessions</div>
        ${sessionsHtml}
      </div>
    `;
  }

  // ─── Render: Mistakes ────────────────────────────────────
  function renderMistakes() {
    const container = document.getElementById('mistakesContent');
    const systems = [...new Set(studyPlan.map((d) => d.system).filter((s) => s && s !== 'REST'))];

    let html = `
      <div class="card">
        <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;">
          <input class="form-input flex-1" id="mistakeSearch" placeholder="Search mistakes…" oninput="App.filterMistakes()">
          <select class="form-select" id="mistakeFilter" onchange="App.filterMistakes()" style="width:auto;">
            <option value="">All systems</option>
            ${systems.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join('')}
          </select>
        </div>
        <button class="btn btn-primary btn-block" onclick="App.showAddMistake()">+ Add Mistake</button>
      </div>
      <div id="mistakesList"></div>
      <div class="card mt-12">
        <div class="card-title">⚡ Quick Review</div>
        <p style="font-size:0.85rem;color:var(--text-secondary);margin-bottom:10px;">
          All your mistakes & notes for rapid exam review.
        </p>
        <button class="btn btn-secondary btn-block" onclick="App.showQuickReview()">Open Quick Review</button>
      </div>`;
    container.innerHTML = html;
    renderMistakesList();
  }

  function renderMistakesList() {
    const list = document.getElementById('mistakesList');
    if (!list) return;
    const q = (document.getElementById('mistakeSearch')?.value || '').toLowerCase();
    const sys = document.getElementById('mistakeFilter')?.value || '';
    let items = data.mistakes;
    if (q) items = items.filter((m) =>
      (m.topic || '').toLowerCase().includes(q) ||
      (m.wrong || '').toLowerCase().includes(q) ||
      (m.correct || '').toLowerCase().includes(q) ||
      (m.question || '').toLowerCase().includes(q)
    );
    if (sys) items = items.filter((m) => m.system === sys);

    if (items.length === 0) {
      list.innerHTML = '<div class="empty-state"><div class="icon">📝</div><p>No mistakes logged yet.</p></div>';
      return;
    }
    list.innerHTML = items.map((m) => `
      <div class="mistake-item">
        <div class="mistake-topic">${esc(m.topic || 'General')} ${m.system ? '· ' + esc(m.system) : ''}</div>
        <div class="mistake-meta">${m.date || ''} ${m.question ? '· Q: ' + esc(m.question) : ''}</div>
        ${m.wrong ? `<div class="mistake-wrong">✗ ${esc(m.wrong)}</div>` : ''}
        ${m.correct ? `<div class="mistake-correct">✓ ${esc(m.correct)}</div>` : ''}
        <button class="btn btn-ghost btn-sm mt-8" onclick="App.deleteMistake('${m.id}')">Delete</button>
      </div>`).join('');
  }

  // ─── Render: Settings ────────────────────────────────────
  function renderSettings() {
    const container = document.getElementById('settingsContent');
    const s = data.settings;
    container.innerHTML = `
      <div class="card">
        <div class="settings-section">
          <h3>Appearance</h3>
          <div class="setting-row">
            <div>
              <div class="setting-label">${s.theme === 'dark' ? '🌙 Dark Mode' : '☀️ Light Mode'}</div>
            </div>
            <div class="toggle ${s.theme === 'dark' ? 'on' : ''}" onclick="App.toggleTheme()" role="switch" aria-checked="${s.theme === 'dark'}"></div>
          </div>
        </div>

        <div class="settings-section">
          <h3>Study Timer</h3>
          <div class="setting-row">
            <div class="setting-label">Focus (min)</div>
            <input type="number" class="number-input" value="${s.focusMin}" min="1" max="180"
              onchange="App.updateSetting('focusMin', +this.value)">
          </div>
          <div class="setting-row">
            <div class="setting-label">Short Break (min)</div>
            <input type="number" class="number-input" value="${s.shortBreakMin}" min="1" max="60"
              onchange="App.updateSetting('shortBreakMin', +this.value)">
          </div>
          <div class="setting-row">
            <div class="setting-label">Long Break (min)</div>
            <input type="number" class="number-input" value="${s.longBreakMin}" min="1" max="60"
              onchange="App.updateSetting('longBreakMin', +this.value)">
          </div>
          <div class="setting-row">
            <div class="setting-label">Long Break After (sessions)</div>
            <input type="number" class="number-input" value="${s.longBreakAfter}" min="1" max="10"
              onchange="App.updateSetting('longBreakAfter', +this.value)">
          </div>
          <div class="setting-row">
            <div>
              <div class="setting-label">Pomodoro Mode</div>
              <div class="setting-desc">Auto long break after N focus sessions</div>
            </div>
            <div class="toggle ${s.pomodoro ? 'on' : ''}" onclick="App.toggleSetting('pomodoro')"></div>
          </div>
          <div class="setting-row">
            <div class="setting-label">Sound</div>
            <div class="toggle ${s.sound ? 'on' : ''}" onclick="App.toggleSetting('sound')"></div>
          </div>
          <div class="setting-row">
            <div>
              <div class="setting-label">Notifications</div>
              <div class="setting-desc">Browser notifications when timer ends</div>
            </div>
            <div class="toggle ${s.notifications ? 'on' : ''}" onclick="App.toggleNotifications()"></div>
          </div>
          <div class="setting-row">
            <div class="setting-label">Auto-start Break</div>
            <div class="toggle ${s.autoStartBreak ? 'on' : ''}" onclick="App.toggleSetting('autoStartBreak')"></div>
          </div>
          <div class="setting-row">
            <div class="setting-label">Auto-start Focus</div>
            <div class="toggle ${s.autoStartFocus ? 'on' : ''}" onclick="App.toggleSetting('autoStartFocus')"></div>
          </div>
        </div>

        <div class="settings-section">
          <h3>Data</h3>
          <button class="btn btn-secondary btn-block mb-8" onclick="App.exportBackup()">📤 Export My Data</button>
          <button class="btn btn-secondary btn-block mb-8" onclick="App.importBackup()">📥 Import Backup</button>
          <input type="file" id="importFile" accept=".json" class="hidden" onchange="App.handleImport(event)">
          <button class="btn btn-danger btn-block" onclick="App.confirmReset()">🗑 Reset My Progress</button>
        </div>

        <div class="settings-section">
          <h3>About</h3>
          <p style="font-size:0.85rem;color:var(--text-secondary);">
            Internal Medicine 63-Day Clinical Study Planner<br>
            Offline-first PWA · LocalStorage only<br>
            Plan starts: Sep 27, 2026
          </p>
        </div>
      </div>`;
  }

  // ─── Navigation ──────────────────────────────────────────
  function navigate(page) {
    currentPage = page;
    document.querySelectorAll('.page').forEach((p) => p.classList.remove('active'));
    document.getElementById('page-' + page)?.classList.add('active');
    document.querySelectorAll('.nav-item').forEach((n) => {
      n.classList.toggle('active', n.dataset.page === page);
    });
    updateFloatingTimer();
    if (page === 'today') renderToday();
    else if (page === 'calendar') renderCalendar();
    else if (page === 'progress') renderProgress();
    else if (page === 'mistakes') renderMistakes();
    else if (page === 'settings') renderSettings();
  }

  function goToDay(n) {
    if (n < 1 || n > TOTAL_DAYS) return;
    currentDay = n;
    updateHeader();
    if (currentPage !== 'today') navigate('today');
    else renderToday();
  }

  function updateHeader() {
    document.getElementById('streakCount').textContent = calcStreak();
    document.getElementById('dayBadge').textContent = `Day ${currentDay}/63`;
  }

  // ─── Modals ──────────────────────────────────────────────
  function openModal(title, bodyHtml) {
    document.getElementById('modalTitle').textContent = title;
    document.getElementById('modalBody').innerHTML = bodyHtml;
    document.getElementById('modalOverlay').classList.add('open');
  }

  function closeModal() {
    document.getElementById('modalOverlay').classList.remove('open');
  }

  // ─── Public API (window.App) ─────────────────────────────
  window.App = {
    navigate,
    goToDay,
    toggleTask,
    toggleTheme,

    showAddTask(dayNum) {
      openModal('Add Task', `
        <div class="form-group">
          <label class="form-label">Task title</label>
          <input class="form-input" id="newTaskTitle" placeholder="e.g. Review Heart Failure drugs" autofocus>
        </div>
        <button class="btn btn-primary btn-block" id="btnSaveTask">Save</button>
      `);
      document.getElementById('btnSaveTask').onclick = () => {
        const title = document.getElementById('newTaskTitle').value;
        addCustomTask(dayNum, title);
        closeModal();
      };
      document.getElementById('newTaskTitle').onkeydown = (e) => {
        if (e.key === 'Enter') document.getElementById('btnSaveTask').click();
      };
    },

    deleteTaskConfirm(dayNum, taskId, isCustom) {
      if (!confirm('Delete this task?')) return;
      deleteTask(dayNum, taskId, isCustom);
    },

    editTaskPrompt(dayNum, taskId) {
      const list = data.customTasks[dayNum] || [];
      const t = list.find((x) => x.id === taskId);
      if (!t) return;
      openModal('Edit Task', `
        <div class="form-group">
          <label class="form-label">Task title</label>
          <input class="form-input" id="editTaskTitle" value="${esc(t.title)}">
        </div>
        <button class="btn btn-primary btn-block" id="btnEditTask">Save</button>
      `);
      document.getElementById('btnEditTask').onclick = () => {
        editTask(dayNum, taskId, true, document.getElementById('editTaskTitle').value);
        closeModal();
      };
    },

    onNoteInput(dayNum, val) {
      clearTimeout(notesDebounce);
      notesDebounce = setTimeout(() => saveNote(dayNum, val), 400);
    },

    showAddMistake(dayNum) {
      const plan = dayNum ? getDayData(dayNum) : getDayData(currentDay);
      openModal('Add Mistake', `
        <div class="form-group">
          <label class="form-label">Topic</label>
          <input class="form-input" id="mTopic" value="${esc(plan?.topic || '')}">
        </div>
        <div class="form-group">
          <label class="form-label">System</label>
          <input class="form-input" id="mSystem" value="${esc(plan?.system || '')}">
        </div>
        <div class="form-group">
          <label class="form-label">Question / Context</label>
          <input class="form-input" id="mQuestion" placeholder="Optional">
        </div>
        <div class="form-group">
          <label class="form-label">What I got wrong</label>
          <textarea class="form-textarea" id="mWrong" rows="2"></textarea>
        </div>
        <div class="form-group">
          <label class="form-label">Correct concept</label>
          <textarea class="form-textarea" id="mCorrect" rows="2"></textarea>
        </div>
        <button class="btn btn-primary btn-block" id="btnSaveMistake">Save Mistake</button>
      `);
      document.getElementById('btnSaveMistake').onclick = () => {
        addMistake({
          topic: document.getElementById('mTopic').value,
          system: document.getElementById('mSystem').value,
          question: document.getElementById('mQuestion').value,
          wrong: document.getElementById('mWrong').value,
          correct: document.getElementById('mCorrect').value,
          day: dayNum || currentDay
        });
        closeModal();
        showToast('Mistake saved');
        if (currentPage === 'mistakes') renderMistakes();
      };
    },

    deleteMistake(id) {
      if (!confirm('Delete this mistake?')) return;
      deleteMistake(id);
      renderMistakesList();
    },

    filterMistakes() { renderMistakesList(); },

    showQuickReview() {
      const mistakes = data.mistakes;
      const notesEntries = Object.entries(data.notes).filter(([, v]) => v && v.trim());
      let html = '<h3 style="margin-bottom:10px;">Mistakes</h3>';
      if (mistakes.length === 0) html += '<p style="color:var(--text-muted);">None yet.</p>';
      else {
        mistakes.forEach((m) => {
          html += `<div class="mistake-item" style="margin-bottom:8px;">
            <strong>${esc(m.topic)}</strong>
            ${m.wrong ? `<div class="mistake-wrong">✗ ${esc(m.wrong)}</div>` : ''}
            ${m.correct ? `<div class="mistake-correct">✓ ${esc(m.correct)}</div>` : ''}
          </div>`;
        });
      }
      html += '<h3 style="margin:16px 0 10px;">Notes</h3>';
      if (notesEntries.length === 0) html += '<p style="color:var(--text-muted);">None yet.</p>';
      else {
        notesEntries.forEach(([day, text]) => {
          const p = getDayData(+day);
          html += `<div class="card" style="margin-bottom:8px;padding:12px;">
            <div style="font-weight:600;font-size:0.85rem;color:var(--primary);">Day ${day}${p ? ' · ' + p.topic : ''}</div>
            <div style="font-size:0.85rem;white-space:pre-wrap;margin-top:4px;">${esc(text)}</div>
          </div>`;
        });
      }
      openModal('⚡ Quick Review', html);
    },

    showCatchUp() {
      const planDay = getPlanDayNumber();
      const unfinished = [];
      for (let d = 1; d < planDay && d <= TOTAL_DAYS; d++) {
        const st = getDayStatus(d);
        if (st === 'missed' || st === 'progress') {
          const p = getDayData(d);
          unfinished.push({ day: d, topic: p?.topic, status: st });
        }
      }
      let html = unfinished.map((u) => `
        <div class="task-item" style="cursor:pointer;" onclick="App.goToDay(${u.day});App.closeModal();">
          <div class="task-body">
            <div class="task-title">Day ${u.day} — ${esc(u.topic)}</div>
            <div class="task-desc">${u.status === 'missed' ? '🔴 Missed' : '🟡 In Progress'}</div>
          </div>
        </div>`).join('');
      openModal('Catch Up', html || '<p>All caught up!</p>');
    },

    closeModal,

    // Timer
    setTimerMode(mode) {
      if (data.activeTimer && data.activeTimer.isRunning) {
        showToast('Pause timer first to change mode');
        return;
      }
      if (data.activeTimer) {
        data.activeTimer.mode = mode;
        const s = data.settings;
        if (mode === 'focus') data.activeTimer.duration = s.focusMin * 60;
        else if (mode === 'short') data.activeTimer.duration = s.shortBreakMin * 60;
        else if (mode === 'long') data.activeTimer.duration = s.longBreakMin * 60;
        else data.activeTimer.duration = 0;
        data.activeTimer.remainingSeconds = data.activeTimer.duration;
        data.activeTimer.isRunning = false;
        saveData();
      }
      // Just re-render to show selected mode
      if (currentPage === 'today') renderToday();
    },

    timerStart() {
      if (data.activeTimer && !data.activeTimer.isRunning) {
        resumeTimer();
        return;
      }
      // Determine mode from UI or default focus
      const modeBtns = document.querySelectorAll('.timer-mode-btn.active');
      let mode = 'focus';
      if (modeBtns.length) {
        const txt = modeBtns[0].textContent.toLowerCase();
        if (txt.includes('short')) mode = 'short';
        else if (txt.includes('long')) mode = 'long';
        else if (txt.includes('free')) mode = 'free';
      }
      const plan = getDayData(currentDay);
      const tasks = getTasksForDay(currentDay);
      const incomplete = tasks.find((t) => !t.done);
      startTimer(mode, incomplete?.id, incomplete?.title || '');
    },

    timerPause() { pauseTimer(); },
    timerReset() {
      if (data.activeTimer) finishTimerSession(false);
      else resetTimer();
      resetTimer();
    },

    quickStartFocus() {
      const tasks = getTasksForDay(currentDay);
      const incomplete = tasks.find((t) => !t.done);
      startTimer('focus', incomplete?.id || null, incomplete?.title || 'Study');
      showToast('Focus started' + (incomplete ? ': ' + incomplete.title : ''));
    },

    // Settings
    updateSetting(key, val) {
      data.settings[key] = val;
      saveData();
    },
    toggleSetting(key) {
      data.settings[key] = !data.settings[key];
      saveData();
      renderSettings();
    },
    toggleNotifications() {
      if (!data.settings.notifications && 'Notification' in window) {
        Notification.requestPermission().then((p) => {
          data.settings.notifications = p === 'granted';
          saveData();
          renderSettings();
        });
      } else {
        data.settings.notifications = !data.settings.notifications;
        saveData();
        renderSettings();
      }
    },

    exportBackup() {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'internal-medicine-backup.json';
      a.click();
      URL.revokeObjectURL(a.href);
      showToast('Backup exported');
    },

    importBackup() {
      document.getElementById('importFile').click();
    },

    handleImport(e) {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const imported = JSON.parse(reader.result);
          if (!imported || typeof imported !== 'object') throw new Error('Invalid');
          data = {
            ...defaultData(),
            ...imported,
            settings: { ...defaultData().settings, ...(imported.settings || {}) }
          };
          saveData();
          applyTheme();
          updateHeader();
          navigate(currentPage);
          showToast('Backup restored');
        } catch (err) {
          showToast('Invalid backup file');
        }
      };
      reader.readAsText(file);
      e.target.value = '';
    },

    confirmReset() {
      openModal('Reset Progress', `
        <p style="margin-bottom:16px;">Are you sure?<br>
        This will permanently delete your progress, notes, custom tasks and sessions from this device.</p>
        <p style="font-size:0.85rem;color:var(--text-muted);margin-bottom:16px;">The 63-day plan itself will not be deleted.</p>
        <button class="btn btn-danger btn-block" id="btnDoReset">Reset Everything</button>
        <button class="btn btn-secondary btn-block mt-8" onclick="App.closeModal()">Cancel</button>
      `);
      document.getElementById('btnDoReset').onclick = () => {
        const theme = data.settings.theme;
        data = defaultData();
        data.settings.theme = theme;
        saveData();
        applyTheme();
        updateHeader();
        closeModal();
        navigate('today');
        showToast('Progress reset');
      };
    }
  };

  function esc(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ─── Visibility / resume ─────────────────────────────────
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && data.activeTimer?.isRunning) {
      // Recalculate from timestamps
      const rem = getTimerRemaining();
      if (data.activeTimer.mode !== 'free' && rem <= 0) {
        finishTimerSession(true);
      } else {
        updateTimerUI(rem);
        updateFloatingTimer();
        if (!timerInterval) startTimerTick();
      }
    }
  });

  // ─── Init ────────────────────────────────────────────────
  async function init() {
    data = loadData();
    applyTheme();

    try {
      const res = await fetch('study-plan.json');
      studyPlan = await res.json();
    } catch (e) {
      console.error('Failed to load plan', e);
      document.getElementById('todayContent').innerHTML =
        '<div class="empty-state"><p>Failed to load study plan. Check offline cache.</p></div>';
      return;
    }

    // Determine current day
    const planDay = getPlanDayNumber();
    if (planDay < 1) currentDay = 1;
    else if (planDay > TOTAL_DAYS) currentDay = TOTAL_DAYS;
    else currentDay = planDay;

    updateHeader();

    // Nav clicks
    document.getElementById('bottomNav').addEventListener('click', (e) => {
      const btn = e.target.closest('.nav-item');
      if (btn) navigate(btn.dataset.page);
    });

    // Modal close
    document.getElementById('modalClose').onclick = closeModal;
    document.getElementById('modalOverlay').onclick = (e) => {
      if (e.target.id === 'modalOverlay') closeModal();
    };

    // Floating timer click
    document.getElementById('floatingTimer').onclick = () => navigate('today');

    // Restore running timer
    if (data.activeTimer?.isRunning) {
      const rem = getTimerRemaining();
      if (data.activeTimer.mode !== 'free' && rem <= 0) {
        finishTimerSession(true);
      } else {
        startTimerTick();
      }
    }

    navigate('today');

    // Register SW
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./service-worker.js').catch(() => {});
    }
  }

  init();
})();
