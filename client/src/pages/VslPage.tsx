import { Megaphone } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { UpsellVsl } from "@/components/UpsellVsl";

/**
 * Upsell VSL — the host's short (≤30 s) thank-you clip for the top of the upsell page, kept per
 * channel. Its own nav entry beside "HeyGen test" (admins and operations managers,
 * `canManageChannels`), matching `managerProcedure` on the `vsl` router.
 */
export default function VslPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        icon={Megaphone}
        title="Upsell VSL"
        description="The host thanks the buyer and offers the bundle — a clip of up to 30 seconds for the top of the upsell page."
      />
      <UpsellVsl />
    </div>
  );
}
