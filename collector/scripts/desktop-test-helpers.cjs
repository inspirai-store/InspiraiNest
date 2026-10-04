exports.setTheme = async (page, mode = 'toggle') => {
  const theme = mode === 'toggle' ? await page.evaluate(() => document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark') : mode;
  await page.evaluate(themeMode => window.desktopSettings.update({themeMode}),theme);
  if (theme !== 'system') await page.waitForFunction(value=>document.documentElement.dataset.theme===value,theme);
};
exports.showSettings = async (page, tab) => {
  await page.locator('[data-view=settings]').click();
  await page.locator(`[data-settings=${tab}]`).click();
};
