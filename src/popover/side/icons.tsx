// Íconos de la barra lateral y de los recursos (heredan el color del texto)
type P = { size?: number };

const svg = (size: number, children: React.ReactNode) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {children}
  </svg>
);

// Hoja principal
export const IconSheet = ({ size = 20 }: P) =>
  svg(size, (
    <>
      <path d="M6 3h9l3 3v15H6z" />
      <path d="M15 3v3h3M9 10h6M9 14h6M9 18h4" />
    </>
  ));

// Dotes: silueta humana
export const IconFeats = ({ size = 20 }: P) =>
  svg(size, (
    <>
      <circle cx="12" cy="6.5" r="3" />
      <path d="M6 21v-5.5a6 6 0 0 1 12 0V21" />
      <path d="M9.5 13.5 12 16l2.5-2.5" />
    </>
  ));

// Inventario: mochila
export const IconBag = ({ size = 20 }: P) =>
  svg(size, (
    <>
      <path d="M9 6V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V6" />
      <rect x="5" y="6" width="14" height="15" rx="3.5" />
      <path d="M8.5 13h7v4.5h-7z" />
      <path d="M12 13v1.5" />
    </>
  ));

// Magia: libro
export const IconBook = ({ size = 20 }: P) =>
  svg(size, (
    <>
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z" />
      <path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5" />
      <path d="m12 7 .9 2.1L15 10l-2.1.9L12 13l-.9-2.1L9 10l2.1-.9z" />
    </>
  ));

// Recetas: matraz
export const IconFlask = ({ size = 20 }: P) =>
  svg(size, (
    <>
      <path d="M9.5 3h5M10.5 3v6L5 19a1.5 1.5 0 0 0 1.3 2.2h11.4A1.5 1.5 0 0 0 19 19l-5.5-10V3" />
      <path d="M7.5 15h9" />
    </>
  ));

// Mascota: lobo minimalista
export const IconWolf = ({ size = 20 }: P) =>
  svg(size, (
    <>
      <path d="M5 3.5 8 8h8l3-4.5L20 11l-3 4-2 5.5h-6L7 15l-3-4z" />
      <path d="M9.5 11.5h.01M14.5 11.5h.01" strokeWidth={2.6} />
      <path d="m11 15.5 1 1 1-1" />
    </>
  ));

// Punto de foco: llama
export const IconFlame = ({ size = 18 }: P) =>
  svg(size, <path d="M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5.3 1.5 1 2.5 2 3 0-3 0-6 1-8.5z" />);

// Espacio de conjuro: chispa
export const IconSpark = ({ size = 18 }: P) =>
  svg(size, <path d="m12 2.5 2 6.5 6.5 2.5-6.5 2.5-2 7-2-7-6.5-2.5L10 9z" />);
