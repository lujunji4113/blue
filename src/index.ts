import puppeteerVanilla, { Browser } from "puppeteer";
import { addExtra } from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { load } from "cheerio";
import { MeiliSearch, TaskStatus } from "meilisearch";
import { join } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath as fromFileUrl } from "node:url";
import { steps } from "./utils";

const puppeteer = addExtra(puppeteerVanilla).use(StealthPlugin());

const dataDir = fromFileUrl(new URL("../data", import.meta.url));

interface Weekly {
  title: string;
  url: string;
  currentNumber: number;
  indexUid: string;
  uidPrefix?: string;
}

interface WeeklyItem {
  title: string;
  link: string;
  numberStr: string;
}

interface WeeklyDocument {
  id: string;
  number: string;
  title: string;
  url: string;
  publishDate: string;
  publishTimestamp: number;
}

interface Config {
  weeklies: Weekly[];
}

class ConfigProvider {
  static readonly configFilePath = join(dataDir, "config.json");

  private cacheConfig: Config | null = null;

  async read(): Promise<Config | null> {
    if (this.cacheConfig !== null) {
      return this.cacheConfig;
    }

    const content = await readFile(ConfigProvider.configFilePath, {
      encoding: "utf-8",
    });

    try {
      this.cacheConfig = JSON.parse(content);

      return this.cacheConfig;
    } catch {
      console.warn("Failed to parse config file.");

      return null;
    }
  }

  async write(config: Config): Promise<void> {
    await writeFile(
      ConfigProvider.configFilePath,
      JSON.stringify(config, null, 2),
      "utf-8"
    );
  }

  async weeklies(): Promise<Weekly[]> {
    const config = await this.read();

    return config?.weeklies ?? [];
  }

  async updateWeeklies(weeklies: Weekly[]): Promise<void> {
    const config = await this.read();

    await this.write({ ...config, weeklies });
  }
}

const parseWeeklyItem = async (
  browser: Browser,
  item: WeeklyItem
): Promise<WeeklyDocument[]> => {
  const page = await browser.newPage();
  await page.goto(item.link);

  await page.waitForSelector("#activity-name", {
    timeout: 3000,
  });

  await page.waitForFunction(
    () => {
      return document.querySelector("#publish_time")?.textContent !== "";
    },
    {
      timeout: 3000,
    }
  );

  const html = await page.evaluate(() => document.body.innerHTML);

  const $ = load(html);

  const documents: WeeklyDocument[] = [];

  const publishDate = $("#publish_time").text();
  const publishTimestamp = new Date(
    publishDate.replace(/年|月/g, "-").replace(/日 /g, "T")
  ).getTime();

  for (const section of $("#js_content section")) {
    const $section = $(section);

    if (
      $section.prev().is("p") &&
      $section.children().first().is("section") &&
      $section.children().first().children().last().is("p")
    ) {
      const title = $section.prev().text().trim();
      const url = $section.children().first().children().last().text().trim();

      const parseId = (prefix: string, url: string) => {
        const urlInstance = new URL(url);

        let baseId = urlInstance.pathname
          .split("/")
          .filter((component) => component !== "")
          .join("-");

        if (baseId === "") {
          baseId = urlInstance.hostname.split(".")[0];
        }

        const rawId = [prefix, baseId].join("-");

        return rawId.replace(/[^a-zA-Z0-9-_]/g, "");
      };

      if (title.length > 0 && url.startsWith("https://")) {
        documents.push({
          id: parseId(item.numberStr, url),
          number: item.numberStr,
          title,
          url,
          publishDate,
          publishTimestamp,
        });
      }
    }
  }

  await page.close();

  return documents;
};

const updateWeeklyIndexes = async (
  browser: Browser,
  client: MeiliSearch,
  weekly: Weekly
): Promise<Weekly> => {
  const page = await browser.newPage();

  await page.goto(weekly.url);

  await page.waitForSelector(".album__list", {
    timeout: 3000,
  });

  const newestNumber = await page.evaluate(() => {
    const albumList = document.querySelector(".album__list");
    const title = albumList?.firstElementChild
      ?.querySelector(".weui-mask-ellipsis__text")
      ?.textContent?.trim();
    const [, numberStr] = /^([0-9]+)\./.exec(title ?? "") ?? [];

    if (numberStr == undefined) {
      return 0;
    }

    const number = parseInt(numberStr, 10);

    if (Number.isNaN(number)) {
      return 0;
    }

    return number;
  });

  const isDescending = weekly.currentNumber / newestNumber > 0.5;

  if (!isDescending) {
    await page.click(".js_positive_order");
    await page.waitForFunction(
      () => {
        const albumList = document.querySelector(".album__list");
        const firstListItem = albumList?.firstElementChild;
        if (!firstListItem) {
          return false;
        }

        const title = firstListItem
          .querySelector(".weui-mask-ellipsis__text")
          ?.textContent?.trim();
        const [, numberStr] = /^([0-9]+)\./.exec(title ?? "") ?? [];

        return numberStr === "1";
      },
      {
        polling: "mutation",
        timeout: 3000,
      }
    );
  }

  const waitForLoad = async (
    start: number,
    end: number,
    isDescending: boolean
  ) => {
    await page.waitForFunction(
      (start, end, isDescending) => {
        const albumList = document.querySelector(".album__list");
        const lastListItem = albumList?.lastElementChild;
        if (!lastListItem) {
          return false;
        }
        const title = lastListItem
          .querySelector(".weui-mask-ellipsis__text")
          ?.textContent?.trim();
        const [, numberStr] = /^([0-9]+)\./.exec(title ?? "") ?? [];
        if (numberStr == undefined) {
          return false;
        }
        const currentNumber = window.parseInt(numberStr, 10);
        if (Number.isNaN(currentNumber)) {
          return false;
        }
        if (isDescending ? currentNumber > start : currentNumber < end) {
          lastListItem.scrollIntoView({ behavior: "smooth" });

          return false;
        }
        return true;
      },
      {
        polling: "mutation",
        timeout: 3000,
      },
      start,
      end,
      isDescending
    );
  };

  for await (const [start, end] of steps(
    weekly.currentNumber,
    newestNumber,
    10,
    {
      reverse: isDescending,
    }
  )) {
    await waitForLoad(start, end, isDescending);
  }

  const items = await page.evaluate(
    (start, end) => {
      const albumList = document.querySelector(".album__list");
      if (!albumList) {
        return [];
      }

      const listItems = Array.from(albumList.children).slice(start, end);

      const parseNumberStr = (listItem: Element) => {
        const title = listItem
          .querySelector(".weui-mask-ellipsis__text")
          ?.textContent?.trim();
        const [, numberStr] = /^([0-9]+)\./.exec(title ?? "") ?? [];
        if (numberStr == undefined) {
          return "0";
        }
        return numberStr;
      };

      return listItems.map((listItem) => ({
        title: listItem.getAttribute("data-title") ?? "",
        link: listItem.getAttribute("data-link") ?? "",
        numberStr: parseNumberStr(listItem),
      }));
    },
    isDescending ? 0 : weekly.currentNumber,
    isDescending ? newestNumber - weekly.currentNumber : newestNumber
  );

  let count = 0;

  for await (const item of items) {
    const documents = await parseWeeklyItem(browser, item);

    try {
      const enqueuedTask = await client
        .index(weekly.indexUid)
        .addDocuments(documents);

      const task = await client.waitForTask(enqueuedTask.taskUid);

      if (task.status === TaskStatus.TASK_FAILED) {
        console.warn(task.error);
      }
    } catch (error) {
      console.error(error);

      console.log(item);

      console.log(documents);
    }

    count++;
    console.log(
      `${weekly.title} Progress: ${((count / items.length) * 100).toFixed(2)}%`
    );
  }

  await page.close();

  return { ...weekly, currentNumber: newestNumber };
};

const main = async () => {
  const cmdArgs = process.argv.slice(2);

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: "/usr/bin/chromium",
  });

  const configProvider = new ConfigProvider();
  const weeklies = await configProvider.weeklies();

  const { MEILI_HOST, MEILI_API_KEY } = process.env;

  if (!MEILI_HOST || !MEILI_API_KEY) {
    throw new Error("We need meilisearch.");
  }

  const client = new MeiliSearch({
    host: MEILI_HOST,
    apiKey: MEILI_API_KEY,
  });

  if (cmdArgs.includes("--update-documents")) {
    const updatedWeeklies: Weekly[] = [];
    for await (const weekly of weeklies) {
      const updatedWeekly = await updateWeeklyIndexes(browser, client, weekly);
      updatedWeeklies.push(updatedWeekly);
    }

    await configProvider.updateWeeklies(updatedWeeklies);
  } else if (cmdArgs.includes("--update-settings")) {
    await Promise.all(
      weeklies.map(async (weekly) => {
        await client
          .index(weekly.indexUid)
          .updateDisplayedAttributes(["number", "title", "url", "publishDate"]);
        await client
          .index(weekly.indexUid)
          .updateSearchableAttributes(["title"]);
        await client
          .index(weekly.indexUid)
          .updateSortableAttributes(["publishTimestamp"]);
        await client
          .index(weekly.indexUid)
          .updateRankingRules(["publishTimestamp:desc"]);
      })
    );
  }

  await browser.close();
};

main();
