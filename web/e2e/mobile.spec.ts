import { expect, test } from '@playwright/test';
import { login } from './helpers';

test('on a phone the menu opens from the hamburger', async ({ page }) => {
  await login(page);
  const nav = page.getByRole('navigation', { name: 'Sadaļas' });
  await expect(nav).not.toBeInViewport();
  await page.getByRole('button', { name: 'Izvēlne' }).click();
  await expect(nav).toBeInViewport();
  await nav.getByRole('link', { name: /Noliktava/ }).click();
  await expect(page).toHaveURL(/\/noliktava/);
  await expect(nav).not.toBeInViewport();
});
