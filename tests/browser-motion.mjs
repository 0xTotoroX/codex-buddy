/* [INPUT]: Isolated Playwright pages and actual browser animation/media events.
 * [OUTPUT]: Bounded waits for delivered media changes and completed finite animations.
 * [POS]: Synthetic browser test support; never changes system preferences.
 * [PROTOCOL]: Keep tests/AGENTS.md in sync. */
export async function emulateMedia(page, options) {
  if (options.reducedMotion) {
    await page.evaluate((value) => {
      const query = matchMedia('(prefers-reduced-motion: reduce)');
      const expected = value === 'reduce';
      window.motionMediaDelivered = query.matches === expected;
      if (!window.motionMediaDelivered)
        query.addEventListener(
          'change',
          () => (window.motionMediaDelivered = query.matches === expected),
          { once: true },
        );
    }, options.reducedMotion);
  }
  await page.emulateMedia(options);
  if (options.reducedMotion)
    await page.waitForFunction(() => window.motionMediaDelivered, null, { timeout: 4000 });
}

export async function finishAnimations(locator) {
  await locator.evaluate(async (node) => {
    let timer;
    try {
      await Promise.race([
        Promise.allSettled(node.getAnimations({ subtree: true }).map((a) => a.finished)),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('Animations did not finish')), 4000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  });
}
