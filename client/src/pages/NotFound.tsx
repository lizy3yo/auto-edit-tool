import { Button } from "@/components/ui/button";
import { FileQuestion, Home, LibraryBig } from "lucide-react";
import { Link } from "wouter";

/**
 * Rendered inside `Layout`, so the app header is already above it — the old
 * version painted its own full-screen `min-h-screen` gradient below that header,
 * on a hardcoded slate-and-blue palette borrowed from no other page in the app.
 * It reads as a page of this app now, and offers the two places worth going.
 */
export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center px-4 py-24 text-center">
      <span
        aria-hidden
        className="mb-5 flex h-14 w-14 items-center justify-center rounded-xl border border-border bg-muted"
      >
        <FileQuestion className="h-7 w-7 text-muted-foreground" />
      </span>

      <p className="text-sm font-medium tracking-wide text-muted-foreground">
        404
      </p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">
        This page doesn't exist
      </h1>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
        The link may be out of date, or the page may have moved. Your renders
        are unaffected — they're all in the library.
      </p>

      <div className="mt-7 flex flex-col gap-2 sm:flex-row">
        <Button asChild>
          <Link href="/">
            <Home className="mr-2 h-4 w-4" />
            Go to the generator
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/library">
            <LibraryBig className="mr-2 h-4 w-4" />
            Browse library
          </Link>
        </Button>
      </div>
    </div>
  );
}
