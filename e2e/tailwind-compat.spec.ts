import { expect, test } from "@playwright/test";

test.use({ serviceWorkers: "block" });

for (const width of [390, 1366]) {
  test(`Tailwind: campos ocultos preservam espaçamento em ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.route(/https:\/\/(?:[^/]+\.supabase\.co|credmaisapp-supabase\.fcoipz\.easypanel\.host)\//,
      route => route.fulfill({ status: 200, json: [] }));
    await page.goto("/login");
    await expect(page.getByLabel(/e-?mail/i)).toBeVisible();
    const margins = await page.evaluate(() => {
      const box = document.createElement("div");
      box.className = "space-y-3";
      box.innerHTML = '<div>Primeiro</div><input type="hidden"><div>Segundo</div><div hidden>Oculto</div><div>Terceiro</div>';
      document.body.append(box);
      const values = [...box.querySelectorAll("div:not([hidden])")].map(el => {
        const style = getComputedStyle(el);
        return [style.marginTop, style.marginBottom];
      });
      box.remove();
      return values;
    });
    expect(margins).toEqual([["0px", "0px"], ["12px", "0px"], ["12px", "0px"]]);
  });

  test(`Tailwind: cor de marca local e margens horizontais em ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.route(/https:\/\/(?:[^/]+\.supabase\.co|credmaisapp-supabase\.fcoipz\.easypanel\.host)\//,
      route => route.fulfill({ status: 200, json: [] }));
    await page.goto("/login");
    await expect(page.getByLabel(/e-?mail/i)).toBeVisible();
    const styles = await page.evaluate(() => {
      const box = document.createElement("div");
      box.className = "flex sm:space-x-2";
      box.style.setProperty("--primary", "120 100% 25%");
      box.innerHTML = '<div class="bg-primary">Primeiro</div><div hidden>Oculto</div><div>Segundo</div>';
      document.body.append(box);
      const children = [...box.querySelectorAll("div:not([hidden])")];
      const result = {
        color: getComputedStyle(children[0]).backgroundColor,
        margins: children.map(el => { const style = getComputedStyle(el); return [style.marginLeft, style.marginRight]; }),
        backdrop: "",
      };
      box.remove();
      const glass = document.createElement("div");
      glass.className = "dark";
      glass.innerHTML = '<div class="app-content"><button class="rounded-xl bg-white/8">Ação</button></div>';
      document.body.append(glass);
      result.backdrop = getComputedStyle(glass.querySelector("button")!).backdropFilter;
      glass.remove();
      return result;
    });
    expect(styles.color).toBe("rgb(0, 128, 0)");
    expect(styles.backdrop).toBe(width < 768 ? "none" : "blur(16px) saturate(1.2)");
    expect(styles.margins).toEqual([["0px", "0px"], [width >= 640 ? "8px" : "0px", "0px"]]);
  });
}
