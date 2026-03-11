import { AppShell } from "@/components/mvp/AppShell";
import { WizardScaffold } from "@/components/mvp/WizardScaffold";

/**
 * MVP route for the guided advisor wizard flow.
 */
export default function MvpPage() {
  return (
    <AppShell>
      <WizardScaffold />
    </AppShell>
  );
}

