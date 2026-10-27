import { test, expect } from '@playwright/test';
test('desktop writing flow, keyboard formatting, outline, tables and discard guard', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByText('Welcome to Nivra Writer')).toBeVisible();
  await page.screenshot({ path: '/tmp/nivra-start.png' });
  await page.getByRole('button', { name: 'Blank document' }).click();
  const editor = page.getByRole('textbox', { name: 'Document content' });
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.type('A thoughtful beginning');
  await page.getByLabel('Paragraph style').selectOption('1');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.getByLabel('Paragraph style').selectOption('0');
  await page.keyboard.type('A clear space for ideas, and a better way to write.');
  await expect(page.getByRole('navigation', { name: 'Document outline' })).toContainText(
    'A thoughtful beginning',
  );
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+b');
  await expect(page.getByRole('button', { name: 'Bold · Ctrl+B', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Italic · Ctrl+I', exact: true }).click();
  await expect(editor.locator('em')).toHaveCount(2);
  await page.keyboard.press('ArrowRight');
  await page.getByRole('button', { name: 'Insert', exact: true }).click();
  await page.getByRole('button', { name: 'Table', exact: true }).click();
  await expect(editor.locator('table')).toHaveCount(1);
  await editor.locator('td').first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Add row below' }).click();
  await expect(editor.locator('tr')).toHaveCount(4);
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await expect(page.getByRole('button', { name: 'Reset zoom' })).toContainText('110%');
  await page.screenshot({ path: '/tmp/nivra-editor.png' });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Theme', { exact: true }).selectOption('dark');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({ path: '/tmp/nivra-dark.png' });
  await page.keyboard.press('Control+n');
  await expect(page.getByRole('dialog', { name: 'Save your changes?' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(editor).toContainText('A thoughtful beginning');
  await page.keyboard.press('Control+n');
  await page.getByRole('button', { name: 'Discard changes' }).click();
  await expect(editor).toBeEmpty();
  expect(errors).toEqual([]);
});

test('large document input remains responsive and counts are debounced', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Blank document' }).click();
  const editor = page.getByRole('textbox', { name: 'Document content' });
  await editor.click();
  const insertion = await page.evaluate(() => {
    const content = Array.from(
      { length: 1500 },
      (_, i) => `Paragraph ${i}: a clear sentence for a large document.`,
    ).join('\n\n');
    const data = new DataTransfer();
    data.setData('text/plain', content);
    const start = performance.now();
    document
      .querySelector('.tiptap')!
      .dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
      );
    return performance.now() - start;
  });
  await expect(editor.locator('p')).toHaveCount(1500);
  await page.keyboard.press('Control+End');
  const latency = await page.evaluate(() => {
    const durations: number[] = [];
    for (let i = 0; i < 30; i++) {
      const start = performance.now();
      document.execCommand('insertText', false, 'x');
      durations.push(performance.now() - start);
    }
    return {
      mean: durations.reduce((a, b) => a + b, 0) / durations.length,
      max: Math.max(...durations),
    };
  });
  console.log(
    `1500 paragraphs: paste ${insertion.toFixed(1)}ms; input mean ${latency.mean.toFixed(1)}ms, max ${latency.max.toFixed(1)}ms`,
  );
  // A coarse regression budget, not a hardware-independent frame-time guarantee.
  expect(latency.mean).toBeLessThan(100);
  await expect(page.getByText('13,500 words', { exact: true })).toBeVisible();
});

test('UI scale is fixed while scrolling and explicit document zoom remain available', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Blank document' }).click();
  const app = page.locator('.appbar');
  const before = await app.boundingBox();
  const results = await page.evaluate(() => {
    const modified = new WheelEvent('wheel', {
      ctrlKey: true,
      deltaY: -100,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(modified);
    const horizontal = new WheelEvent('wheel', { deltaX: 100, bubbles: true, cancelable: true });
    window.dispatchEvent(horizontal);
    const vertical = new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true });
    window.dispatchEvent(vertical);
    const gesture = new Event('gesturechange', { bubbles: true, cancelable: true });
    window.dispatchEvent(gesture);
    return {
      modified: modified.defaultPrevented,
      horizontal: horizontal.defaultPrevented,
      vertical: vertical.defaultPrevented,
      gesture: gesture.defaultPrevented,
    };
  });
  expect(results).toEqual({ modified: true, horizontal: false, vertical: false, gesture: true });
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await expect(page.getByLabel('Reset zoom')).toHaveText('110%');
  expect((await app.boundingBox())?.height).toBe(before?.height);
  await expect(page.locator('.paper')).toHaveCSS('zoom', '1.1');
  const workspace = page.locator('.workspace');
  await workspace.hover();
  await page.mouse.wheel(0, 250);
  await expect.poll(() => workspace.evaluate((e) => e.scrollTop)).toBeGreaterThan(0);
  await page.getByLabel('Document zoom').fill('200');
  await page.mouse.wheel(300, 0);
  await expect.poll(() => workspace.evaluate((e) => e.scrollLeft)).toBeGreaterThan(0);
});
