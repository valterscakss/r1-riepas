import { expect, type Page } from '@playwright/test';
import { E2E_ADMIN } from '../playwright.config';

export async function login(page: Page, username = E2E_ADMIN.username, password = E2E_ADMIN.password) {
  await page.goto('/login');
  await page.getByLabel('Lietotājvārds').fill(username);
  await page.getByLabel('Parole').fill(password);
  await page.getByRole('button', { name: 'Pieteikties' }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

/** Click a sidebar entry and wait for its screen — scoped to the menu, since screens repeat the same labels as shortcuts. */
export async function nav(page: Page, label: string, url: RegExp) {
  await page.getByRole('navigation', { name: 'Sadaļas' }).getByRole('link', { name: new RegExp(label) }).click();
  await expect(page).toHaveURL(url);
}
