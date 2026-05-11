const { initStore } = require('./utils/store.js');

App({
  onLaunch() {
    initStore();
  }
});
