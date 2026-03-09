export type SystemAdvisor = {
  id: string;
  name: string;
  role: string;
  description: string;
  image: string;
};

export const SYSTEM_ADVISORS: SystemAdvisor[] = [
  {
    id: "laura",
    name: "Laura",
    role: "Perspectiva empatica",
    description: "Te ayuda a entender emociones y desescalar conflictos.",
    image: "/advisors/laura.png",
  },
  {
    id: "robert",
    name: "Robert",
    role: "Perspectiva estrategica",
    description: "Analiza intereses, negociacion y limites claros.",
    image: "/advisors/robert.png",
  },
  {
    id: "lidia",
    name: "Lidia",
    role: "Perspectiva directa",
    description: "Enfocada en accion y claridad.",
    image: "/advisors/lidia.png",
  },
];

export const systemAdvisorById: Record<string, SystemAdvisor> = Object.fromEntries(
  SYSTEM_ADVISORS.map((advisor) => [advisor.id, advisor]),
);
