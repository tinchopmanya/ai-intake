import { AppShell } from "@/components/mvp/AppShell";
import { AuthGate } from "@/components/auth/AuthGate";
import { MvpEntryFlow } from "@/components/mvp/MvpEntryFlow";

/**
 * MVP route for the guided advisor wizard flow.
 */
export default function MvpPage() {
  return (
    <AppShell>
      <AuthGate>
        <MvpEntryFlow />
      </AuthGate>
    </AppShell>
  );
}

