import { ChannelConfigPanel } from "@/components/admin/ChannelConfigPanel";

/**
 * Channels — promoted out of the Admin tab strip to its own top-level nav item, beside
 * Long-form Video.
 *
 * It sits next to Long-form Video rather than under Admin because it is edited at the same
 * cadence as a render: a channel's host photos, voice, persona and CTA assets are what a
 * long-form job reads on every generate, so they get revisited constantly. Provider keys and
 * the directing instruction — the things left in Admin — are set once and rarely touched.
 *
 * The panel itself is unchanged, and still lives under `components/admin/` because its tRPC
 * procedures (`channelConfig.upsert` / `create` / `delete`) remain `adminProcedure`. Moving
 * the nav entry changes where you click, not who is allowed to click it.
 */
export default function ChannelsPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Channels</h1>
      <ChannelConfigPanel />
    </div>
  );
}
