import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, KeyRound, Plug, Settings } from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { ProviderKeys } from "@/components/admin/ProviderKeys";
import { LongformInstruction } from "@/components/admin/LongformInstruction";
import { LongformPacing } from "@/components/admin/LongformPacing";
import { UserManagement } from "@/components/admin/UserManagement";
import { MonthlySpend } from "@/components/admin/MonthlySpend";

/**
 * MiniMax provider card — the TTS FALLBACK lane.
 *
 * Deliberately unlike the 69Labs card above in two visible ways, both of which are the point:
 *
 *  - No "Set active" button. Active selects the ONE provider a render uses for video and
 *    images; MiniMax does neither, and making it active would deactivate 69Labs and break
 *    every other lane at once. It is reached only when a render is explicitly set to it.
 *  - It takes a Group ID as well as a key. Older MiniMax accounts scope requests by group;
 *    it is not a secret, so it is shown in the clear and stored in the row's `customConfig`
 *    rather than encrypted. Blank is fine on newer accounts.
 *
 * Testing it needs a channel, because MiniMax has no free list/quota endpoint — the probe is a
 * two-word synthesis, which also proves the key can SYNTHESIZE rather than merely authenticate.
 */
function MinimaxCard() {
  const utils = trpc.useUtils();
  const { data: providers, isLoading } = trpc.provider.list.useQuery();
  const { data: channels } = trpc.channelConfig.list.useQuery();
  const [apiKey, setApiKey] = useState("");
  const [groupId, setGroupId] = useState("");
  const [testChannel, setTestChannel] = useState("");

  const row = providers?.find(p => p.providerType === "minimax");

  const saveMutation = trpc.provider.saveMinimax.useMutation({
    onSuccess: () => {
      toast.success("MiniMax credentials saved");
      setApiKey("");
      utils.provider.list.invalidate();
    },
    onError: err => toast.error(err.message),
  });
  const testMutation = trpc.provider.testMinimax.useMutation({
    onSuccess: res => {
      if (res.success) toast.success("MiniMax connection OK");
      else toast.error(`Connection failed: ${res.message}`);
      utils.provider.list.invalidate();
    },
    onError: err => toast.error(err.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Plug className="h-4 w-4" />
          MiniMax (TTS fallback)
          <Badge variant={row ? "default" : "secondary"} className="ml-2">
            {row ? "Configured" : "Not configured"}
          </Badge>
          {row && (
            <Badge
              variant={
                row.connectionStatus === "connected" ? "default" : "secondary"
              }
            >
              {row.connectionStatus}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              A second voice lane, offered on the generate form when 69Labs
              can&rsquo;t deliver. Never used unless a render is set to it — and
              each channel needs its own MiniMax voice id under Channels, since
              a 69Labs voice will not resolve here.
            </p>
            <div className="space-y-1.5">
              <Label className="text-xs">
                API key{" "}
                {row?.apiKeyMasked ? (
                  <span className="text-muted-foreground">
                    (current: {row.apiKeyMasked})
                  </span>
                ) : (
                  <span className="text-warning">(not set)</span>
                )}
              </Label>
              <Input
                type="password"
                placeholder="MiniMax API key"
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                className="max-w-md"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">
                Group ID{" "}
                <span className="text-muted-foreground">
                  (optional — older accounts only)
                </span>
              </Label>
              <Input
                placeholder="19123456789..."
                value={groupId}
                onChange={e => setGroupId(e.target.value)}
                className="max-w-md"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={(!apiKey && !groupId) || saveMutation.isPending}
                onClick={() =>
                  saveMutation.mutate({
                    apiKey: apiKey || undefined,
                    groupId: groupId || undefined,
                  })
                }
              >
                {saveMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <KeyRound className="mr-1.5 h-3.5 w-3.5" />
                )}
                Save
              </Button>
              {row && (
                <>
                  <select
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                    value={testChannel}
                    onChange={e => setTestChannel(e.target.value)}
                  >
                    <option value="">Test with channel…</option>
                    {(channels ?? [])
                      // Only channels that actually have a MiniMax voice can be probed — the
                      // test synthesizes, and synthesis needs a voice id.
                      .filter(c => c.minimaxVoiceId)
                      .map(c => (
                        <option key={c.channelKey} value={c.channelKey}>
                          {c.displayName ?? c.channelKey}
                        </option>
                      ))}
                  </select>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!testChannel || testMutation.isPending}
                    onClick={() =>
                      testMutation.mutate({ channelKey: testChannel })
                    }
                  >
                    {testMutation.isPending && (
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    )}
                    Test connection
                  </Button>
                </>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * 69Labs provider card — the video/image/TTS lane. One provider row lives in
 * the DB; its key is entered here (stored encrypted) and it must be Active for
 * generation to run.
 */
function SixtyNineLabsCard() {
  const utils = trpc.useUtils();
  const { data: providers, isLoading } = trpc.provider.list.useQuery();
  const [apiKey, setApiKey] = useState("");

  const row = providers?.find(p => p.providerType === "sixtynine_labs");

  const saveMutation = trpc.provider.save.useMutation({
    onSuccess: () => {
      toast.success("69Labs provider saved");
      setApiKey("");
      utils.provider.list.invalidate();
      utils.provider.getStatus.invalidate();
    },
    onError: err => toast.error(err.message),
  });
  const testMutation = trpc.provider.testConnection.useMutation({
    onSuccess: res => {
      if (res.success) toast.success("69Labs connection OK");
      else toast.error(`Connection failed: ${res.message ?? "unknown error"}`);
      utils.provider.list.invalidate();
      utils.provider.getStatus.invalidate();
    },
    onError: err => toast.error(err.message),
  });
  const setActiveMutation = trpc.provider.setActive.useMutation({
    onSuccess: () => {
      toast.success("69Labs set as active provider");
      utils.provider.list.invalidate();
      utils.provider.getStatus.invalidate();
    },
    onError: err => toast.error(err.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Plug className="h-4 w-4" />
          69Labs (video · image · TTS)
          {row && (
            <Badge
              variant={row.isActive ? "default" : "secondary"}
              className="ml-2"
            >
              {row.isActive ? "Active" : "Inactive"}
            </Badge>
          )}
          {row && (
            <Badge
              variant={
                row.connectionStatus === "connected" ? "default" : "secondary"
              }
            >
              {row.connectionStatus}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : (
          <>
            <div className="space-y-1.5">
              <Label className="text-xs">
                API key{" "}
                {row?.apiKeyMasked ? (
                  <span className="text-muted-foreground">
                    (current: {row.apiKeyMasked})
                  </span>
                ) : (
                  <span className="text-warning">(not set)</span>
                )}
              </Label>
              <div className="flex gap-2">
                <Input
                  type="password"
                  placeholder="vk_..."
                  value={apiKey}
                  onChange={e => setApiKey(e.target.value)}
                  className="max-w-md"
                />
                <Button
                  size="sm"
                  disabled={!apiKey || saveMutation.isPending}
                  onClick={() =>
                    saveMutation.mutate({
                      id: row?.id,
                      providerType: "sixtynine_labs",
                      displayName: "69Labs",
                      apiKey,
                      isActive: true,
                    })
                  }
                >
                  {saveMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <KeyRound className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  Save
                </Button>
              </div>
            </div>
            {row && (
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={testMutation.isPending}
                  onClick={() => testMutation.mutate({ id: row.id })}
                >
                  {testMutation.isPending && (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  )}
                  Test connection
                </Button>
                {!row.isActive && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={setActiveMutation.isPending}
                    onClick={() => setActiveMutation.mutate({ id: row.id })}
                  >
                    Set active
                  </Button>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Admin — two audiences, one page.
 *
 * An admin gets everything. A operations manager gets the directing instruction and pacing but
 * never the provider keys or the account list, so those tabs are not rendered at all rather
 * than rendered-and-disabled: a key field they cannot use is an invitation to ask why. The
 * procedures behind each tab are gated to match (`adminProcedure` vs `managerProcedure`), so
 * hiding is the courtesy and the server is the lock.
 */
export default function AdminPage() {
  const { canManageKeys } = useAuth();

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Settings}
        title="Admin"
        description={
          canManageKeys
            ? "Provider keys, accounts, provider spend and the directing instruction. Per-channel settings live under Channels."
            : "The directing instruction and pacing — set once, rarely touched. Per-channel settings live under Channels."
        }
      />
      <Tabs
        defaultValue={canManageKeys ? "keys" : "instruction"}
        className="gap-4"
      >
        <TabsList>
          {canManageKeys && (
            <TabsTrigger value="keys">Provider keys</TabsTrigger>
          )}
          <TabsTrigger value="instruction">Longform instruction</TabsTrigger>
          <TabsTrigger value="pacing">Longform pacing</TabsTrigger>
          {canManageKeys && <TabsTrigger value="spend">Spend</TabsTrigger>}
          {canManageKeys && <TabsTrigger value="users">Users</TabsTrigger>}
        </TabsList>
        {canManageKeys && (
          <TabsContent value="keys" className="space-y-4">
            <SixtyNineLabsCard />
            <MinimaxCard />
            <ProviderKeys />
          </TabsContent>
        )}
        <TabsContent value="instruction">
          <LongformInstruction />
        </TabsContent>
        <TabsContent value="pacing">
          <LongformPacing />
        </TabsContent>
        {canManageKeys && (
          <TabsContent value="spend">
            <MonthlySpend />
          </TabsContent>
        )}
        {canManageKeys && (
          <TabsContent value="users">
            <UserManagement />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
