export async function withFreshActivation(browser, callback) {
  const context = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: false });
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    return await callback(page, context);
  } finally {
    await context.close();
  }
}
