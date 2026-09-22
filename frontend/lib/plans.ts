export const ADMIN_EMAIL = "ashit.tiwary07@gmail.com";

export type AccountPlan = "admin-pro" | "free";

export function isAdminEmail(email?: string | null): boolean {
  return (email || "").trim().toLowerCase() === ADMIN_EMAIL;
}

export function getAccountPlan(email?: string | null): AccountPlan {
  return isAdminEmail(email) ? "admin-pro" : "free";
}

export const PLAN_DETAILS = {
  free: {
    name: "Free",
    description: "Core chat access with fair-use limits from the configured model providers.",
    features: [
      "Standard text chat and model selection",
      "Penumbra and Umbra reasoning",
      "Limited file and image-generation usage",
      "Standard routing priority",
    ],
  },
  adminPro: {
    name: "Administrator Pro",
    description: "Full VOID feature access for the administrator account.",
    features: [
      "Penumbra, Umbra, and Tenebrae reasoning",
      "Full image, file, and voice features",
      "Highest application routing priority",
      "No application-level message cap",
    ],
  },
} as const;
