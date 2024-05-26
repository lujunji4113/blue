import { fromFileUrl } from "std/path/mod.ts";
import { launch } from "npm:puppeteer@20.0.0";
import { MeiliSearch } from "npm:meilisearch@0.38.0";
import bookmarks from "../data/bookmarks.json" with { type: "json" };

const MASTER_KEY = "aSampleMasterKey";

const startMeilisearchBackend = async (): Promise<Deno.ChildProcess> => {
  const meilisearchExecPath = fromFileUrl(
    new URL("../meilisearch", import.meta.url),
  );
  const command = new Deno.Command(meilisearchExecPath, {
    args: [`--master-key=${MASTER_KEY}`],
    stdout: "piped",
    stderr: "piped",
  });

  const outFile = await Deno.open(
    fromFileUrl(new URL("../logs/meilisearch_out.txt", import.meta.url)),
    {
      read: true,
      write: true,
      create: true,
    },
  );
  const errFile = await Deno.open(
    fromFileUrl(new URL("../logs/meilisearch_err.txt", import.meta.url)),
    {
      read: true,
      write: true,
      create: true,
    },
  );

  const process = command.spawn();

  process.stdout.pipeTo(outFile.writable);

  process.stderr.pipeTo(errFile.writable);

  return process;
};

const startMeilisearchClient = (): MeiliSearch => {
  const client = new MeiliSearch({
    host: "http://localhost:7700",
    apiKey: MASTER_KEY,
  });

  return client;
};

const main = async () => {
  const browser = await launch({
    headless: true,
    executablePath: "/usr/bin/chromium",
  });

  await browser.close();

  return;

  const meilisearchBackend = await startMeilisearchBackend();

  const meilisearchClient = startMeilisearchClient();

  meilisearchClient.index("bookmarks").addDocuments(bookmarks)
    .then((res) => console.log(res));
};

main();
