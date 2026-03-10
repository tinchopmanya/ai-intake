import Image from "next/image";

type AdvisorAvatarItemProps = {
  name: string;
  role?: string;
  avatarSrc: string;
  size?: 56 | 64;
  align?: "left" | "center";
  tone?: "dark" | "light";
  onClick?: () => void;
};

export function AdvisorAvatarItem({
  name,
  role,
  avatarSrc,
  size = 64,
  align = "left",
  tone = "dark",
  onClick,
}: AdvisorAvatarItemProps) {
  const sizeClass = size === 64 ? "h-16 w-16" : "h-14 w-14";
  const textAlignClass = align === "center" ? "text-center" : "text-left";
  const wrapperClass =
    align === "center"
      ? "flex flex-col items-center gap-2"
      : "flex items-center gap-3";

  const nameClass = tone === "light" ? "text-sm font-semibold text-gray-100" : "text-sm font-semibold text-gray-800";
  const roleClass = tone === "light" ? "text-xs text-gray-200" : "text-xs text-gray-600";

  const content = (
    <div className={wrapperClass}>
      <Image
        src={avatarSrc}
        alt={name}
        width={size}
        height={size}
        className={`${sizeClass} rounded-lg border object-cover ${
          tone === "light" ? "border-gray-600" : "border-gray-200"
        }`.trim()}
      />
      <div className={textAlignClass}>
        <p className={nameClass}>{name}</p>
        {role ? <p className={roleClass}>{role}</p> : null}
      </div>
    </div>
  );

  if (!onClick) return content;

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left rounded-lg transition hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-gray-400/30"
      aria-label={`Abrir perfil de ${name}`}
    >
      {content}
    </button>
  );
}
