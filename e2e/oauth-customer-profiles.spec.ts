import { expect, test } from "@playwright/test";

test("saved Enterprise OAuth customer profile survives reload and stays deleted", async ({
  page,
}) => {
  const customerName = "Acme Enterprise";
  const enterpriseUrl = "https://acme.stackenterprise.co";
  const oauthClientId = "acme-browser-client";
  let oauthStartRequests = 0;

  await page.route("**/api/oauth/pkce/start", async (route) => {
    oauthStartRequests += 1;
    await route.abort("failed");
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Credentials", exact: true }).click();
  await page.getByLabel("Instance type").selectOption("enterprise");

  const savedCustomer = page.getByLabel("Saved customer");
  await expect(savedCustomer).toBeEnabled();
  await page.getByLabel("Customer name").fill(customerName);
  await page.getByLabel("Instance URL").fill(enterpriseUrl);
  await page.getByLabel("OAuth Client ID").fill(oauthClientId);
  await page.getByLabel("Request non-expiring token").check();
  await page.getByRole("button", { name: "Save customer" }).click();

  await expect(savedCustomer.locator("option:checked")).toHaveText(customerName);
  await expect(page.getByRole("button", { name: "Delete customer" })).toBeEnabled();
  expect(oauthStartRequests).toBe(0);

  await page.reload();
  await page.getByRole("button", { name: "Credentials", exact: true }).click();

  await expect(page.getByLabel("Instance type")).toHaveValue("enterprise");
  await expect(savedCustomer.locator("option:checked")).toHaveText(customerName);
  await expect(page.getByLabel("Customer name")).toHaveValue(customerName);
  await expect(page.getByLabel("Instance URL")).toHaveValue(enterpriseUrl);
  await expect(page.getByLabel("OAuth Client ID")).toHaveValue(oauthClientId);
  await expect(page.getByLabel("Request non-expiring token")).toBeChecked();
  expect(oauthStartRequests).toBe(0);

  page.once("dialog", async (dialog) => {
    expect(dialog.type()).toBe("confirm");
    expect(dialog.message()).toContain("Delete this saved customer profile?");
    await dialog.accept();
  });
  await page.getByRole("button", { name: "Delete customer" }).click();

  await expect(savedCustomer).toHaveValue("");
  await expect(savedCustomer.locator("option")).toHaveCount(1);
  await expect(page.getByLabel("Customer name")).toHaveValue("");
  await expect(page.getByLabel("Instance URL")).toHaveValue("");
  await expect(page.getByLabel("OAuth Client ID")).toHaveValue("");
  await expect(page.getByLabel("Request non-expiring token")).not.toBeChecked();

  await page.reload();
  await page.getByRole("button", { name: "Credentials", exact: true }).click();
  await page.getByLabel("Instance type").selectOption("enterprise");

  await expect(savedCustomer).toBeEnabled();
  await expect(savedCustomer).toHaveValue("");
  await expect(savedCustomer.locator("option")).toHaveCount(1);
  await expect(savedCustomer.locator("option")).toHaveText("New customer");
  await expect(page.getByLabel("Customer name")).toHaveValue("");
  await expect(page.getByLabel("Instance URL")).toHaveValue("");
  await expect(page.getByLabel("OAuth Client ID")).toHaveValue("");
  await expect(page.getByLabel("Request non-expiring token")).not.toBeChecked();
  expect(oauthStartRequests).toBe(0);
});
