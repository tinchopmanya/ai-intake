import { redirect } from "next/navigation";

/**
 * Legacy route hard-blocked for validation readiness.
 */
export default function AdvisorLegacyPage() {
  redirect("/mvp");
}
