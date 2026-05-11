// 数据访问层。当前是本地 storage 实现，将来接后端时只改这一个文件即可。
// 所有页面对 events / settings 的读写都走这里，不要直接调 wx.setStorageSync。

const EVENTS_KEY = 'events';
const SETTINGS_KEY = 'settings';

const cache = {
  events: null,
  settings: null
};

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function genInviteCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function pad(n) { return n < 10 ? '0' + n : '' + n; }

function ymd(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function load() {
  if (cache.events === null) {
    cache.events = wx.getStorageSync(EVENTS_KEY) || [];
  }
  if (cache.settings === null) {
    cache.settings = wx.getStorageSync(SETTINGS_KEY) || {};
  }
}

function persistEvents() { wx.setStorageSync(EVENTS_KEY, cache.events); }
function persistSettings() { wx.setStorageSync(SETTINGS_KEY, cache.settings); }

function initStore() {
  load();

  if (!wx.getStorageSync(EVENTS_KEY)) {
    const today = new Date();
    const future = new Date(today);
    future.setDate(future.getDate() + 3);
    const now = Date.now();
    cache.events = [
      {
        id: genId(),
        title: '看一部电影',
        type: 'date',
        date: ymd(today),
        time: '20:30',
        note: '百老汇 MOMA · 花样年华',
        createdAt: now,
        updatedAt: now
      },
      {
        id: genId(),
        title: '妈妈生日',
        type: 'birthday',
        date: ymd(future),
        time: '',
        note: '记得提前订蛋糕',
        createdAt: now,
        updatedAt: now
      }
    ];
    persistEvents();
  }

  if (!wx.getStorageSync(SETTINGS_KEY)) {
    cache.settings = {
      anniversaryDate: '',
      inviteCode: genInviteCode()
    };
    persistSettings();
  }
}

function getEvents() {
  load();
  return cache.events.slice();
}

function getEventById(id) {
  load();
  return cache.events.find(e => e.id === id) || null;
}

function addEvent(event) {
  load();
  const now = Date.now();
  const e = {
    id: genId(),
    title: event.title,
    type: event.type || 'date',
    date: event.date,
    time: event.time || '',
    note: event.note || '',
    createdAt: now,
    updatedAt: now
  };
  cache.events.push(e);
  persistEvents();
  return e;
}

function updateEvent(id, patch) {
  load();
  const i = cache.events.findIndex(e => e.id === id);
  if (i === -1) return null;
  cache.events[i] = Object.assign({}, cache.events[i], patch, { updatedAt: Date.now() });
  persistEvents();
  return cache.events[i];
}

function deleteEvent(id) {
  load();
  cache.events = cache.events.filter(e => e.id !== id);
  persistEvents();
}

function getEventsByDate(dateStr) {
  load();
  return cache.events.filter(e => e.date === dateStr);
}

function getEventsInRange(start, end) {
  load();
  return cache.events.filter(e => e.date >= start && e.date <= end);
}

function clearAll() {
  cache.events = [];
  cache.settings = { anniversaryDate: '', inviteCode: genInviteCode() };
  persistEvents();
  persistSettings();
}

function getSettings() {
  load();
  return Object.assign({}, cache.settings);
}

function updateSettings(patch) {
  load();
  cache.settings = Object.assign({}, cache.settings, patch);
  persistSettings();
  return Object.assign({}, cache.settings);
}

module.exports = {
  initStore,
  getEvents,
  getEventById,
  addEvent,
  updateEvent,
  deleteEvent,
  getEventsByDate,
  getEventsInRange,
  clearAll,
  getSettings,
  updateSettings
};
