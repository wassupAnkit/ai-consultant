/** Markdown imported as text (`import md from "./x.md" with { type: "text" }`), as Bun loads it. */
declare module "*.md" {
  const text: string;
  export default text;
}
