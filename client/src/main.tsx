import { trpc } from "@/lib/trpc";
import { UNAUTHED_ERR_MSG } from "@shared/const";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, TRPCClientError } from "@trpc/client";
import { createRoot } from "react-dom/client";
import superjson from "superjson";
import App from "./App";
import { measuredFetch } from "@/lib/connection";
import "./index.css";

const queryClient = new QueryClient();

// A page's code is fetched when the page is opened, and a deploy replaces those files. A tab
// left open across a deploy then asks for a file that is gone: reload once to pick up the new
// build (once per tab session, so a genuinely unreachable server cannot loop).
window.addEventListener("vite:preloadError", event => {
  const KEY = "reloaded-for-new-build";
  try {
    if (sessionStorage.getItem(KEY)) return;
    sessionStorage.setItem(KEY, "1");
  } catch {
    return;
  }
  event.preventDefault();
  window.location.reload();
});

const redirectToLoginIfUnauthorized = (error: unknown) => {
  if (!(error instanceof TRPCClientError)) return;
  if (typeof window === "undefined") return;

  const isUnauthorized = error.message === UNAUTHED_ERR_MSG;

  if (!isUnauthorized) return;

  // Reload to show login form
  window.location.href = "/";
};

queryClient.getQueryCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.query.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Query Error]", error);
  }
});

queryClient.getMutationCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.mutation.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Mutation Error]", error);
  }
});

const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      transformer: superjson,
      // Every batch goes over POST, body-encoded — never GET. `book.detectCtaBlocks` carries the
      // whole script (up to 50 KB) as its input, and `maxURLLength` alone can't save a GET: it
      // only splits a batch of several small queries apart, but one query whose OWN input already
      // exceeds the limit can't be split further — tRPC just throws ("Input is too big for a
      // single dispatch") instead of sending it. That's exactly what a long script hit. POST puts
      // the payload in the body (`express.json({ limit: "50mb" })` server-side already), which has
      // no URL-length ceiling at all — Node's 16 KB request-line limit and the 431 it used to throw
      // were both a GET-only problem. `maxURLLength` stays as a harmless no-op safety net.
      methodOverride: "POST",
      maxURLLength: 12000,
      fetch(input, init) {
        return measuredFetch(input, {
          ...(init ?? {}),
          credentials: "include",
        });
      },
    }),
  ],
});

createRoot(document.getElementById("root")!).render(
  <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </trpc.Provider>
);
