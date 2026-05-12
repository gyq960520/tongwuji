const { getCategories, createCategory, updateCategory, deleteCategory } = require('../../utils/store.js');
const { MAX_CUSTOM_CATEGORIES, PRESET_EMOJI_GROUPS } = require('../../utils/config.js');

Page({
  data: {
    categories: [],
    canAddCustom: true,
    // sheet 状态
    presetEmojiGroups: PRESET_EMOJI_GROUPS,
    showSheet: false,
    editingId: '',
    newCategoryName: '',
    newCategoryEmoji: '',
    canConfirmSheet: false
  },

  async onShow() {
    await this._refresh();
  },

  async _refresh() {
    const categories = await getCategories();
    this.setData({
      categories,
      canAddCustom: categories.length < MAX_CUSTOM_CATEGORIES
    });
  },

  onAddCustom() {
    if (!this.data.canAddCustom) {
      wx.showToast({ title: `最多 ${MAX_CUSTOM_CATEGORIES} 个`, icon: 'none' });
      return;
    }
    this.setData({
      showSheet: true,
      editingId: '',
      newCategoryName: '',
      newCategoryEmoji: '',
      canConfirmSheet: false
    });
  },

  onEditCategory(e) {
    const id = e.currentTarget.dataset.id;
    const cat = this.data.categories.find(c => c._id === id);
    if (!cat) return;
    this.setData({
      showSheet: true,
      editingId: id,
      newCategoryName: cat.name,
      newCategoryEmoji: cat.emoji,
      canConfirmSheet: true   // 编辑入口的初始值已经合法
    });
  },

  async onDeleteCategory(e) {
    const id = e.currentTarget.dataset.id;
    try {
      const result = await deleteCategory(id);
      if (result.cancelled) return;
      await this._refresh();
      const affected = result.affectedEvents || 0;
      wx.showToast({
        title: affected > 0 ? `已删除，${affected} 个事件归入提醒` : '已删除',
        icon: 'success'
      });
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '删除失败', icon: 'none' });
    }
  },

  // ----- sheet 共用 handler -----
  onCloseSheet() { this.setData({ showSheet: false }); },
  // catchtap 必须挂真方法名，空字符串在部分基础库版本下不会拦截，会导致 sheet 内 tap 冒泡到 mask 关掉 sheet
  onSheetCatchTouchMove() {},
  onSheetCatchTap() {},

  onSheetNameInput(e) {
    const newCategoryName = e.detail.value;
    this.setData({
      newCategoryName,
      canConfirmSheet: this._validateSheet(newCategoryName, this.data.newCategoryEmoji)
    });
  },

  onSheetEmojiInput(e) {
    const newCategoryEmoji = e.detail.value;
    this.setData({
      newCategoryEmoji,
      canConfirmSheet: this._validateSheet(this.data.newCategoryName, newCategoryEmoji)
    });
  },

  onSelectPresetEmoji(e) {
    const newCategoryEmoji = e.currentTarget.dataset.emoji;
    this.setData({
      newCategoryEmoji,
      canConfirmSheet: this._validateSheet(this.data.newCategoryName, newCategoryEmoji)
    });
  },

  // 名字长度只在提交时校验，避免输入过程中反复反馈打扰用户。
  // 这里 canConfirmSheet 仅看 emoji 是否选过（emoji 是二值状态，反馈不烦）。
  _validateSheet(name, emoji) {
    return !!emoji && emoji.length > 0;
  },

  async onConfirmSheet() {
    if (!this.data.canConfirmSheet) return;
    const trimmed = this.data.newCategoryName.trim();
    if (trimmed.length < 2 || trimmed.length > 6) {
      wx.showToast({ title: '分类名需要 2-6 个字', icon: 'none' });
      return;
    }
    const isEdit = !!this.data.editingId;
    try {
      wx.showLoading({ title: isEdit ? '更新中' : '创建中', mask: true });
      if (isEdit) {
        await updateCategory({
          id: this.data.editingId,
          name: this.data.newCategoryName.trim(),
          emoji: this.data.newCategoryEmoji
        });
      } else {
        await createCategory({
          name: this.data.newCategoryName.trim(),
          emoji: this.data.newCategoryEmoji
        });
      }
      wx.hideLoading();
      this.setData({ showSheet: false });
      await this._refresh();
      wx.showToast({ title: isEdit ? '已更新' : '已添加', icon: 'success' });
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: (e && e.message) || '保存失败', icon: 'none' });
    }
  }
});
