exports.setTheme = async (page, mode = 'toggle') => {
  const theme = mode === 'toggle' ? await page.evaluate(() => document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark') : mode;
  await page.evaluate(themeMode => window.desktopSettings.update({themeMode}),theme);
  if (theme !== 'system') await page.waitForFunction(value=>document.documentElement.dataset.theme===value,theme);
};
exports.showSettings = async (page, tab) => {
  await page.locator('[data-region=一级导航], .workspace-nav').waitFor();
  if (await page.locator('[data-region=一级导航]').count()) {
    await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'设置',exact:true}).click();
    const label={appearance:'通用',devices:'账号',updates:'更新'}[tab] || tab;
    await page.locator('[data-region=列表区]').getByRole('button',{name:label,exact:true}).click();
    return;
  }
  await page.locator('[data-view=settings]').click();
  await page.locator(`[data-settings=${tab}]`).click();
};
