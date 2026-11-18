import { test, expect, type Page } from '@playwright/test'

/**
 * Signed-out checks for the landing page and the pages it links to.
 *
 * Every test runs signed out: no test accounts, nothing written to the
 * database, so it doesn't care what earlier specs left behind.
 */

async function expectSignInPanel(page: Page) {
  await expect(page.getByRole('heading', { name: 'Sign in to continue' })).toBeVisible({ timeout: 15000 })
  await expect(page.getByText('This page is only available to signed-in users.')).toBeVisible()
}

test.describe('Landing (signed out)', () => {
  test('/ shows the three actions with the right links', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByTestId('static-landing')).toBeVisible()

    await expect(page.getByRole('link', { name: 'Create a room' })).toHaveAttribute('href', '/create')
    await expect(page.getByRole('link', { name: 'Join a room' })).toHaveAttribute('href', '/join')
    await expect(page.getByRole('link', { name: 'Try it yourself' })).toHaveAttribute('href', '/home')
  })

  test('"Create a room" leads to the sign-in panel on /create', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('link', { name: 'Create a room' }).click()
    await expect(page).toHaveURL(/\/create$/)
    await expectSignInPanel(page)
  })

  test('"Join a room" leads to the sign-in panel on /join', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('link', { name: 'Join a room' }).click()
    await expect(page).toHaveURL(/\/join$/)
    await expectSignInPanel(page)
  })

  test('"Try it yourself" leads to the sign-in panel on /home, with no Try-it button', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('link', { name: 'Try it yourself' }).click()
    await expect(page).toHaveURL(/\/home$/)
    await expectSignInPanel(page)
    await expect(page.getByRole('button', { name: 'Try it yourself' })).toHaveCount(0)
  })
})
