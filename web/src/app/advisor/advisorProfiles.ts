export type AdvisorVisualProfile = {
  id: string;
  name: string;
  role: string;
  description: string;
  avatar: string;
};

export const advisorProfiles: Record<string, AdvisorVisualProfile> = {
  laura: {
    id: "laura",
    name: "Laura",
    role: "Psicologa",
    description: "Empatica y enfocada en dinamicas emocionales.",
    avatar: "/advisors/laura.svg",
  },
  robert: {
    id: "robert",
    name: "Robert",
    role: "Abogado",
    description: "Directo, firme y orientado a limites claros.",
    avatar: "/advisors/robert.svg",
  },
  lidia: {
    id: "lidia",
    name: "Lidia",
    role: "Coach",
    description: "Pragmatica y orientada a accion concreta.",
    avatar: "/advisors/lidia.svg",
  },
};
