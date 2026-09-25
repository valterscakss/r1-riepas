import { expect, test } from '@playwright/test';
import { login, nav } from './helpers';

test('a wrong password is refused, the right one opens the app', async ({ page }) => {
  await page.goto('/sakums');
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel('Lietotājvārds').fill('admin');
  await page.getByLabel('Parole').fill('wrong');
  await page.getByRole('button', { name: 'Pieteikties' }).click();
  await expect(page.locator('form').getByRole('alert')).toContainText('Invalid username or password');
  await login(page);
  await expect(page.getByRole('heading', { name: 'Pārskats' })).toBeVisible();
});

test('take a set in, find it by SMS code, release it', async ({ page }) => {
  await login(page);
  await nav(page, 'Jauna glabāšana', /jauna-glabasana/);
  await page.getByLabel('Numura zīme').fill('e2e 101');
  await page.getByLabel('Numura zīme').press('Enter');
  await expect(page.getByText('Jauns klients — ievadi datus')).toBeVisible();
  await page.getByLabel('Vārds, uzvārds *').fill('Ieva Testa');
  await page.getByLabel('Izmērs (neobligāts)').fill('2254517');
  await page.getByRole('button', { name: 'Alumīnija' }).click();
  await expect(page.getByText('€26,00')).toBeVisible();
  await page.getByRole('button', { name: 'Apstiprināt pieņemšanu' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Glabāšana apstiprināta')).toBeVisible();
  const code = (await dialog.locator('.tile .mono').first().innerText()).trim();
  expect(code).toBe('R1TE2E10');
  await dialog.getByRole('button', { name: 'Pabeigt' }).click();
  await expect(page).toHaveURL(/\/sakums/);

  // The warehouse got a "store" job for it.
  await nav(page, 'Noliktava', /noliktava/);
  await expect(page.getByText('E2E101')).toBeVisible();

  await nav(page, 'Izsniegt glabāšanu', /izsniegt/);
  await page.getByLabel('SMS kods vai numura zīme').fill(code.toLowerCase());
  await page.getByLabel('SMS kods vai numura zīme').press('Enter');
  await expect(page.getByText('Ieva Testa')).toBeVisible();
  await page.getByRole('button', { name: 'Izsniegt riepas' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Izsniegt' }).click();
  // Offered to take the other season's tires in — not now.
  await page.getByRole('dialog').getByRole('button', { name: 'Vēlāk' }).click();
  await expect(page.getByText(/Nekas netika atrasts/)).toBeVisible();
});

test('the record card shows history and takes a comment', async ({ page }) => {
  await login(page);
  await page.goto('/tabula');
  await page.getByRole('row', { name: /AB1234/ }).click();
  const card = page.getByRole('dialog');
  await expect(card.getByText('Vēsture un komentāri')).toBeVisible();
  await card.getByPlaceholder('Pievienot komentāru…').fill('Skrāpējums uz diska');
  await card.getByRole('button', { name: 'Pievienot' }).click();
  await expect(card.getByText('Skrāpējums uz diska')).toBeVisible();
});

test('a warehouse order is sent and ticked off', async ({ page }) => {
  await login(page);
  await page.goto('/noliktava');
  await page.getByRole('tab', { name: 'Pasūtīt' }).click();
  await page.getByRole('button', { name: 'Montāža' }).click();
  await page.locator('textarea').fill('2× Nokian 205/55/16\nno A ceha');
  await page.locator('textarea').press('Enter');
  const job = page.locator('.card', { hasText: '2× Nokian 205/55/16' });
  await expect(job).toContainText('MONTĀŽA');
  await job.getByRole('button', { name: '✓ Gatavs' }).click();
  await expect(job).toHaveCount(0);
});

test('old ?view= links still land on the right screen', async ({ page }) => {
  await login(page);
  await page.goto('/?view=warehouse');
  await expect(page).toHaveURL(/\/noliktava/);
});

test('the floor role sees the map but not names, and cannot take sets in', async ({ page }) => {
  await login(page, 'leja', 'leja-password');
  await expect(page.getByRole('navigation', { name: 'Sadaļas' }).getByRole('link', { name: /Jauna glabāšana/ })).toHaveCount(0);
  await page.goto('/jauna-glabasana');
  await expect(page).not.toHaveURL(/jauna-glabasana/);
  await page.goto('/novietnes');
  await page.locator('.spot.taken, .spot.rims').first().click();
  const panel = page.getByRole('complementary', { name: /Vieta/ });
  await expect(panel.getByText('Klients')).toBeVisible();
  await expect(panel.getByText('Sample Person')).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Izsniegt riepas' })).toHaveCount(0);
});
