import { expect, type Page } from '@playwright/test';
import { E2E_ADMIN } from '../playwright.config';

export async function login(page: Page, username = E2E_ADMIN.username, password = E2E_ADMIN.password) {
  await page.goto('/login');
  await page.getByLabel('Lietotājvārds').fill(username);
  await page.getByLabel('Parole').fill(password);
  await page.getByRole('button', { name: 'Pieteikties' }).click();
  await expect(page).not.toHaveURL(/\/login/);
}
