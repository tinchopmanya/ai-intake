export type AdvisorProfile = {
  id: string;
  name: string;
  age: number;
  role: string;
  avatar64: string;
  avatar128: string;
  avatar256: string;
  description: string;
};

export const ADVISOR_NOTICE =
  "Este avatar no representa una persona real. Es una perspectiva del sistema diseñada para ayudarte a pensar respuestas con un estilo determinado.";

export const ADVISOR_PROFILES: AdvisorProfile[] = [
  {
    id: "laura",
    name: "Laura",
    age: 34,
    role: "Perspectiva empatica",
    avatar64: "/advisors/laura_64.png",
    avatar128: "/advisors/laura_128.png",
    avatar256: "/advisors/laura_256.png",
    description:
      "Laura representa una mirada sensible y calmada. Puede ayudarte a ordenar emociones y elegir palabras que reduzcan tension.",
  },
  {
    id: "robert",
    name: "Robert",
    age: 41,
    role: "Perspectiva estrategica",
    avatar64: "/advisors/robert_64.png",
    avatar128: "/advisors/robert_128.png",
    avatar256: "/advisors/robert_256.png",
    description:
      "Robert representa una mirada estructurada y firme. Puede ayudarte a comunicar limites con claridad sin escalar el conflicto.",
  },
  {
    id: "lidia",
    name: "Lidia",
    age: 29,
    role: "Perspectiva directa",
    avatar64: "/advisors/lidia_64.png",
    avatar128: "/advisors/lidia_128.png",
    avatar256: "/advisors/lidia_256.png",
    description:
      "Lidia representa una mirada practica y concreta. Puede ayudarte a responder breve, con foco en acciones y acuerdos posibles.",
  },
];

export const advisorProfileById: Record<string, AdvisorProfile> = Object.fromEntries(
  ADVISOR_PROFILES.map((advisor) => [advisor.id, advisor]),
);
