import { Video } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { HeygenTest } from "@/components/HeygenTest";

/**
 * HeyGen test — try host photos before a film pays for them. Its own nav entry beside Channels
 * (admins and operations managers, `canManageChannels`), matching `managerProcedure` on the
 * `heygenTest` router: the nav hides it, the server refuses it.
 */
export default function HeygenTestPage() {
  return (
    <div className="space-y-6">
      <PageHeader icon={Video} title="HeyGen test" />
      <HeygenTest />
    </div>
  );
}
