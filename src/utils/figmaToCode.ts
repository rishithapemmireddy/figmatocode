export type FigmaPaint = {
  type?: string;
  imageRef?: string;
  src?: string;
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

export type DetectedPageJson = Omit<FigmaNode, "type"> & {
  type: "SCREEN";
  sourceType: string;
};

export type CodeFormat = "html" | "react" | "flutter";

interface GenerateOptions {
  format: CodeFormat;
  componentName?: string;
}

export function generateCodeFromFigmaJson(file: FigmaFile, options: GenerateOptions) {
  const pages = collectPages(file.document);
  const roots = pages.length > 0 ? [getRenderablePageNode(pages[0])] : file.document?.children?.slice(0, 1) ?? [];
  const title = file.name || "FigmaExport";

  if (options.format === "react") {
    return generateReact(roots, toComponentName(options.componentName || title));
  }

  if (options.format === "flutter") {
    return generateFlutter(roots, toComponentName(options.componentName || title));
  }

  return generateHtmlCss(roots, title);
}

export function generateCodeForPage(node: FigmaNode, options: GenerateOptions) {
  const title = node.name || "FigmaExport";
  const roots = [getRenderablePageNode(node)];

  if (options.format === "react") {
    return generateReact(roots, toComponentName(options.componentName || title));
  }

  if (options.format === "flutter") {
    return generateFlutter(roots, toComponentName(options.componentName || title));
  }

  return generateHtmlCss(roots, title);
}

export function collectPages(node?: FigmaNode): FigmaNode[] {
  if (!node) return [];

  if (node.type === "DOCUMENT") {
    return (node.children ?? []).filter((child) => child.type === "CANVAS").flatMap(collectPages);
  }

  if (node.type === "CANVAS") {
    return (node.children ?? []).filter((child) => child.type === "FRAME");
  }

  return node.type === "FRAME" ? [node] : [];
}

export function getPageRenderRoots(page: FigmaNode): FigmaNode[] {
  if (hasRenderableBox(page)) return [page];

  const directRenderableChildren = (page.children ?? []).filter(hasRenderableBox);
  if (directRenderableChildren.length > 0) return directRenderableChildren;

  return page.children ?? [page];
}

export function getRenderablePageNode(page: FigmaNode): FigmaNode {
  if (hasRenderableBox(page)) return page;

  const roots = getPageRenderRoots(page);
  const bounds = getCombinedBounds(roots);

  return {
    id: page.id,
    name: page.name,
    type: page.type,
    children: roots,
    absoluteBoundingBox: {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height
    },
    fills: page.fills
  };
}

export function createPageLevelJson(page: FigmaNode): DetectedPageJson {
  return {
    ...page,
    type: "SCREEN",
    sourceType: page.type,
    children: page.children ?? []
  };
}

export function getCombinedBounds(nodes: FigmaNode[]) {
  const boxes = nodes
    .map((node) => node.absoluteBoundingBox)
    .filter((box): box is NonNullable<FigmaNode["absoluteBoundingBox"]> => Boolean(box));
  if (!boxes.length) return { x: 0, y: 0, width: 360, height: 640 };

  const minX = Math.min(...boxes.map((box) => box.x));
  const minY = Math.min(...boxes.map((box) => box.y));
  const maxX = Math.max(...boxes.map((box) => box.x + box.width));
  const maxY = Math.max(...boxes.map((box) => box.y + box.height));

  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY)
  };
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

function generateFlutter(roots: FigmaNode[], componentName: string) {
  const dart = roots.map((node, index) => renderFlutterNode(node, undefined, `screen${index + 1}`)).join("\n");

  return `import 'package:flutter/material.dart';

class ${componentName} extends StatelessWidget {
  const ${componentName}({Key? key}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xfff4f4f5),
      body: SingleChildScrollView(
        child: Padding(
          padding: const EdgeInsets.all(24.0),
          child: Wrap(
            spacing: 24,
            runSpacing: 24,
            alignment: WrapAlignment.start,
${indent(dart, 12)}
          ),
        ),
      ),
    );
  }
}`;
}

function renderFlutterNode(node: FigmaNode, parent: FigmaNode | undefined, key: string): string {
  if (node.type === "TEXT") {
    const textColor = getFlutterTextColor(node);
    const fontSize = node.style?.fontSize ?? 14;
    const fontWeight = getFlutterFontWeight(node.style?.fontWeight);
    
    return `Text(
  '${escapeDart(node.characters ?? node.name)}',
  style: TextStyle(
    fontSize: ${fontSize},
    fontWeight: ${fontWeight},
    color: ${textColor},
  ),
)`;
  }

  const children = (node.children ?? [])
    .filter(hasRenderableBox)
    .map((child, index) => renderFlutterNode(child, node, `${key}_${index + 1}`))
    .join(",\n");

  const box = node.absoluteBoundingBox;
  const width = box ? Math.round(box.width) : 100;
  const height = box ? Math.round(box.height) : 100;
  const bgColor = getFlutterColor(node.fills);
  const borderRadius = node.cornerRadius ?? 0;
  const imageUrl = getFlutterImageUrl(node.fills);
  const borderStyle = getFlutterBorder(node);

  let decoration = `BoxDecoration(
    color: ${bgColor},
    borderRadius: BorderRadius.circular(${borderRadius}),${borderStyle}`;

  if (imageUrl) {
    decoration += `,
    image: DecorationImage(
      image: NetworkImage('${imageUrl}'),
      fit: BoxFit.cover,
    )`;
  }
  
  decoration += `
  )`;

  if (!children) {
    return `Container(
  width: ${width},
  height: ${height},
  decoration: ${decoration},
)`;
  }

  return `Container(
  width: ${width},
  height: ${height},
  decoration: ${decoration},
  child: Column(
    children: [
${indent(children, 6)}
    ],
  ),
)`;
}

function getFlutterColor(paints?: FigmaPaint[]): string {
  const paint = paints?.find((item) => item.type === "SOLID" && item.color);
  if (!paint?.color) return "Colors.white";

  const alpha = (paint.color.a ?? 1) * (paint.opacity ?? 1);
  const r = Math.round(paint.color.r * 255);
  const g = Math.round(paint.color.g * 255);
  const b = Math.round(paint.color.b * 255);
  const a = Math.round(alpha * 255);

  return `const Color(0x${a.toString(16).padStart(2, '0')}${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')})`;
}

function getFlutterImageUrl(paints?: FigmaPaint[]): string {
  const image = firstImagePaint(paints);
  return image?.src ?? "";
}

function getFlutterBorder(node: FigmaNode): string {
  const stroke = firstSolidPaint(node.strokes);
  if (!stroke) return "";
  const weight = node.strokeWeight ?? 1;
  return `,
    border: Border.all(
      color: ${getFlutterColorFromRgb(stroke)},
      width: ${weight},
    )`;
}

function getFlutterTextColor(node: FigmaNode): string {
  const color = firstSolidPaint(node.fills);
  if (color) return getFlutterColorFromRgb(color);
  return "Colors.black";
}

function getFlutterColorFromRgb(rgbString: string): string {
  const match = rgbString.match(/rgba?\((\d+),\s*(\d+),\s*(\d+),?\s*([\d.]+)?\)/);
  if (!match) return "Colors.black";

  const r = parseInt(match[1]);
  const g = parseInt(match[2]);
  const b = parseInt(match[3]);
  const a = match[4] ? Math.round(parseFloat(match[4]) * 255) : 255;

  return `const Color(0x${a.toString(16).padStart(2, '0')}${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')})`;
}

function getFlutterFontWeight(fontWeight?: number): string {
  if (!fontWeight) return "FontWeight.normal";
  if (fontWeight >= 700) return "FontWeight.bold";
  if (fontWeight >= 600) return "FontWeight.w600";
  if (fontWeight >= 500) return "FontWeight.w500";
  return "FontWeight.normal";
}

function escapeDart(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r");
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

  const image = firstImagePaint(node.fills);
  if (image?.src) {
    styles.backgroundImage = `url("${image.src}")`;
    styles.backgroundSize = "cover";
    styles.backgroundPosition = "center";
    styles.backgroundRepeat = "no-repeat";
  }

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

export function firstImagePaint(paints?: FigmaPaint[]) {
  return paints?.find((item) => item.type === "IMAGE" && item.src);
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
