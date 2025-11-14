interface Window {
  env?: Record<string, string | undefined>;
}

declare module '*.svg' {
  const content: string;
  export default content;
}
