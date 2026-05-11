// 事件类型固定四种，emoji 不让用户自选。
// color 是配合 emoji 用的小圆点颜色（仅在事件列表里出现）。

const TYPES = {
  date:        { label: '约会',   emoji: '🍿',     color: '#E89B9F' },
  anniversary: { label: '纪念日', emoji: '💍',     color: '#C7AED4' },
  birthday:    { label: '生日',   emoji: '🎂',     color: '#E8C57E' },
  trip:        { label: '出行',   emoji: '🚶‍♀️', color: '#9DBFAA' }
};

const TYPE_LIST = ['date', 'anniversary', 'birthday', 'trip'];

module.exports = { TYPES, TYPE_LIST };
