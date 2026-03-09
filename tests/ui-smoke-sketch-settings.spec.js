import { test, expect, devices } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:3000';
const EMAIL = 'ui-smoke@example.com';
const PASSWORD = 'Smoke123!';
test.setTimeout(90_000);

async function login(page) {
  await page.goto(`${BASE_URL}/login`);
  await expect(page.getByLabel('Email')).toBeVisible();
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Passwort').fill(PASSWORD);
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await expect(page).not.toHaveURL(/\/login$/);
}

test('Desktop smoke: settings + sketch flow', async ({ page }) => {
  await login(page);

  await page.goto(`${BASE_URL}/settings?tab=account`);
  await expect(page.getByRole('heading', { name: 'API-Konfiguration' })).toBeVisible();
  await expect(page.getByText('Mistral API-Key')).toBeVisible();
  await expect(page.getByText('Google API-Key (Gemini)')).toBeVisible();
  await expect(page.getByRole('button', { name: /Speichern|Speichert/ })).toBeVisible();

  await page.goto(`${BASE_URL}/sketch`);
  await expect(page.getByRole('heading', { name: /Lernskizze|Sketch Summary/i })).toBeVisible();

  const generateButton = page.getByRole('button', { name: 'Zusammenfassung generieren' });
  await expect(generateButton).toBeDisabled();

  const textarea = page.locator('textarea').first();
  await textarea.fill('Neuronale Netze: Eingabe, Hidden Layer, Backpropagation, Overfitting und Regularisierung.');
  await expect(generateButton).toBeEnabled();

  await generateButton.click();
  await expect(page.getByText(/Kein Google API-Key|Google API-Key ungültig|Gemini-Kontingent erreicht|Lernskizze konnte nicht erstellt werden/i)).toBeVisible({ timeout: 20000 });
});

test('Mobile smoke: navigation + sketch + settings account', async ({ browser }) => {
  const context = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await context.newPage();

  try {
    await login(page);

    await page.goto(`${BASE_URL}/sketch`);
    await expect(page.getByRole('heading', { name: /Lernskizze|Sketch Summary/i })).toBeVisible();

    const menuButton = page.getByRole('button', { name: 'Menü öffnen' });
    await expect(menuButton).toBeVisible();
    await menuButton.click();
    const sketchNavLink = page.getByRole('link', { name: /Lernskizze|Sketch Summary/i });
    await expect(sketchNavLink).toBeVisible();
    await sketchNavLink.click();

    const textarea = page.locator('textarea').first();
    await textarea.fill('Kurzer Lerninhalt für mobilen Smoke-Test.');
    await page.getByRole('button', { name: 'Zusammenfassung generieren' }).click();
    await expect(page.getByText(/Kein Google API-Key|Google API-Key ungültig|Gemini-Kontingent erreicht|Lernskizze konnte nicht erstellt werden/i)).toBeVisible({ timeout: 20000 });

    await page.goto(`${BASE_URL}/settings?tab=account`);
    await expect(page.getByRole('heading', { name: 'API-Konfiguration' })).toBeVisible();
    await expect(page.getByText('Google API-Key (Gemini)')).toBeVisible();
  } finally {
    await context.close().catch(() => {});
  }
});
