import { WifiOff, Wifi } from "lucide-react";
import { useConnection } from "@/lib/connection";

/**
 * One line under the header when the connection is weak or gone. It says the one thing a
 * person on bad wifi needs to hear: rendering happens on the server, so nothing is lost.
 * Nothing is shown on a good connection.
 */
export function ConnectionBanner() {
  const { online, quality } = useConnection();
  if (online && quality === "good") return null;
  const Icon = online ? Wifi : WifiOff;
  return (
    <div
      role="status"
      className="border-b border-border bg-muted text-muted-foreground"
    >
      <div className="mx-auto flex max-w-[1400px] items-center gap-2 px-4 py-1.5 text-xs">
        <Icon className="h-3.5 w-3.5 shrink-0" />
        {online
          ? "Connection is weak — this page is updating less often. Your videos keep rendering on the server."
          : "You are offline — reconnecting. Videos already started keep rendering on the server."}
      </div>
    </div>
  );
}
