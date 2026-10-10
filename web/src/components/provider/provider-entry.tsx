"use client";

import nextDynamic from "next/dynamic";

import { Screen } from "@/components/sender/screen";

/**
 * The provider page, rendered in the browser only.
 *
 * Dynamic reads `window` and wallet extensions as soon as it loads, so it must not be evaluated in
 * a server render — which is why the import lives inside the loader rather than at the top of this
 * file. The page is an app, not a document worth indexing, so nothing is lost by rendering it
 * client-side; the sender routes keep their server render and never download Dynamic at all.
 */
export const ProviderEntry = nextDynamic(
  () => import("./provider-with-dynamic").then((module) => module.ProviderWithDynamic),
  {
    ssr: false,
    loading: () => (
      <Screen>
        <p className="text-small py-12 text-ink-muted" role="status">
          Loading…
        </p>
      </Screen>
    ),
  },
);
