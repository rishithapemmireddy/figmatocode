export type FigmaPaint = {
  type?: string;
  color?: {
    r: number;
    g: number;
    b: number;
    a?: number;
  };
  opacity?: number;
};

export type FigmaNode = {
  id: string;
  name: string;
  type: string;
  characters?: string;
  children?: FigmaNode[];
  absoluteBoundingBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  fills?: FigmaPaint[];
  strokes?: FigmaPaint[];
  strokeWeight?: number;
  cornerRadius?: number;
  style?: {
    fontSize?: number;
    fontFamily?: string;
    fontWeight?: number;
    lineHeightPx?: number;
    textAlignHorizontal?: string;
  };
};

export type FigmaFile = {
  name?: string;
  document?: FigmaNode;
};

export type CodeFormat = "html" | "react";

interface GenerateOptions {
  format: CodeFormat;
  componentName?: string;
}

export function generateCodeFromFigmaJson(file: FigmaFile, options: GenerateOptions) {
  const frames = collectFrames(file.document).slice(0, 3);
  const roots = frames.length > 0 ? frames : file.document?.children?.slice(0, 1) ?? [];
  const title = file.name || "FigmaExport";

  if (options.format === "react") {
    return generateReact(roots, toComponentName(options.componentName || title));
  }

  return generateHtmlCss(roots, title);
}

export function generateCodeForFrame(node: FigmaNode, options: GenerateOptions) {
  const title = node.name || "FigmaExport";
  const roots = [node];

  if (options.format === "react") {
    return generateReact(roots, toComponentName(options.componentName || title));
  }

  return generateHtmlCss(roots, title);
}

export function collectFrames(node?: FigmaNode): FigmaNode[] {
  if (!node) return [];
  const matches = ["FRAME", "COMPONENT", "INSTANCE", "SECTION"].includes(node.type) ? [node] : [];
  return [...matches, ...(node.children ?? []).flatMap(collectFrames)];
}

function generateHtmlCss(roots: FigmaNode[], title: string) {
  const cssRules: string[] = [
    "* { box-sizing: border-box; }",
    "body { margin: 0; min-height: 100vh; font-family: Inter, Arial, sans-serif; background: #f4f4f5; }",
    ".figma-export { display: flex; flex-wrap: wrap; gap: 24px; align-items: flex-start; padding: 24px; }",
    ".figma-node { position: absolute; overflow: hidden; }",
    ".figma-text { margin: 0; white-space: pre-wrap; }"
  ];

  const html = roots
    .map((node, index) => renderHtmlNode(node, undefined, `screen-${index + 1}`, cssRules))
    .join("\n");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)}</title>
    <style>
${cssRules.map((rule) => `      ${rule}`).join("\n")}
    </style>
  </head>
  <body>
    <main class="figma-export">
${indent(html, 6)}
    </main>
  </body>
</html>`;
}

function generateReact(roots: FigmaNode[], componentName: string) {
  const jsx = roots.map((node, index) => renderReactNode(node, undefined, `screen-${index + 1}`)).join("\n");

  return `export function ${componentName}() {
  return (
    <main style={{
      display: "flex",
      flexWrap: "wrap",
      gap: 24,
      alignItems: "flex-start",
      padding: 24,
      minHeight: "100vh",
      background: "#f4f4f5",
      fontFamily: "Inter, Arial, sans-serif"
    }}>
${indent(jsx, 6)}
    </main>
  );
}`;
}

function renderHtmlNode(
  node: FigmaNode,
  parent: FigmaNode | undefined,
  className: string,
  cssRules: string[]
): string {
  cssRules.push(`.${className} { ${toCssDeclaration(node, parent)} }`);

  if (node.type === "TEXT") {
    return `<p class="figma-node figma-text ${className}">${escapeHtml(node.characters ?? node.name)}</p>`;
  }

  const children = (node.children ?? [])
    .filter(hasRenderableBox)
    .map((child, index) => renderHtmlNode(child, node, `${className}-${index + 1}`, cssRules))
    .join("\n");

  if (!children) {
    return `<div class="figma-node ${className}" aria-label="${escapeHtml(node.name)}"></div>`;
  }

  return `<section class="figma-node ${className}" aria-label="${escapeHtml(node.name)}">
${indent(children, 2)}
</section>`;
}

function renderReactNode(node: FigmaNode, parent: FigmaNode | undefined, key: string): string {
  const style = toReactStyle(node, parent);

  if (node.type === "TEXT") {
    return `<p key="${key}" style=${style}>{${JSON.stringify(node.characters ?? node.name)}}</p>`;
  }

  const children = (node.children ?? [])
    .filter(hasRenderableBox)
    .map((child, index) => renderReactNode(child, node, `${key}-${index + 1}`))
    .join("\n");

  if (!children) {
    return `<div key="${key}" aria-label=${JSON.stringify(node.name)} style=${style} />`;
  }

  return `<section key="${key}" aria-label=${JSON.stringify(node.name)} style=${style}>
${indent(children, 2)}
</section>`;
}

function hasRenderableBox(node: FigmaNode) {
  return Boolean(node.absoluteBoundingBox && node.absoluteBoundingBox.width > 0 && node.absoluteBoundingBox.height > 0);
}

function toCssDeclaration(node: FigmaNode, parent?: FigmaNode) {
  const styles = toStyleMap(node, parent);
  return Object.entries(styles)
    .map(([key, value]) => `${toKebabCase(key)}: ${value};`)
    .join(" ");
}

function toReactStyle(node: FigmaNode, parent?: FigmaNode) {
  const styles = toStyleMap(node, parent);
  const entries = Object.entries(styles)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    .join(", ");

  return `{{ ${entries} }}`;
}

export function toStyleMap(node: FigmaNode, parent?: FigmaNode) {
  const box = node.absoluteBoundingBox;
  const parentBox = parent?.absoluteBoundingBox;
  const isRoot = !parentBox;
  const styles: Record<string, string> = {
    position: isRoot ? "relative" : "absolute",
    overflow: "hidden"
  };

  if (box) {
    styles.width = `${Math.round(box.width)}px`;
    styles.height = `${Math.round(box.height)}px`;

    if (!isRoot) {
      styles.left = `${Math.round(box.x - parentBox.x)}px`;
      styles.top = `${Math.round(box.y - parentBox.y)}px`;
    }
  }

  const background = firstSolidPaint(node.fills);
  if (background) styles.background = background;

  const border = firstSolidPaint(node.strokes);
  if (border) styles.border = `${node.strokeWeight ?? 1}px solid ${border}`;

  if (typeof node.cornerRadius === "number") styles.borderRadius = `${node.cornerRadius}px`;

  if (node.type === "TEXT") {
    styles.margin = "0";
    styles.whiteSpace = "pre-wrap";
    if (node.style?.fontSize) styles.fontSize = `${node.style.fontSize}px`;
    if (node.style?.fontFamily) styles.fontFamily = `${node.style.fontFamily}, Inter, Arial, sans-serif`;
    if (node.style?.fontWeight) styles.fontWeight = String(node.style.fontWeight);
    if (node.style?.lineHeightPx) styles.lineHeight = `${node.style.lineHeightPx}px`;
    if (node.style?.textAlignHorizontal) styles.textAlign = node.style.textAlignHorizontal.toLowerCase();

    const color = firstSolidPaint(node.fills);
    if (color) {
      delete styles.background;
      styles.color = color;
    }
  }

  return styles;
}

export function firstSolidPaint(paints?: FigmaPaint[]) {
  const paint = paints?.find((item) => item.type === "SOLID" && item.color);
  if (!paint?.color) return undefined;

  const alpha = (paint.color.a ?? 1) * (paint.opacity ?? 1);
  const r = Math.round(paint.color.r * 255);
  const g = Math.round(paint.color.g * 255);
  const b = Math.round(paint.color.b * 255);

  return alpha >= 0.99 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
}

function toComponentName(value: string) {
  const name = value
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .split(" ")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");

  return name && /^[A-Z]/.test(name) ? name : "FigmaExport";
}

function toKebabCase(value: string) {
  return value.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function indent(value: string, spaces: number) {
  const padding = " ".repeat(spaces);
  return value
    .split("\n")
    .map((line) => (line ? `${padding}${line}` : line))
    .join("\n");
}
