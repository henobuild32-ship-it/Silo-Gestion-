import Image from "next/image";

export function ChurchLogo({ size = 48, className = "" }: { size?: number; className?: string }) {
  return (
    <Image
      src="/silo-logo.png"
      alt="Logo du Centre Évangélique Silo — CMPEC"
      width={size}
      height={size}
      className={`church-logo${className ? ` ${className}` : ""}`}
    />
  );
}
