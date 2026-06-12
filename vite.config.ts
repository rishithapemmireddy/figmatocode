import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { mkdir, writeFile } from "node:fs/promises";
import { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";

type FigmaPaint = {
  type?: string;
  imageRef?: string;
  src?: string;
};

type FigmaNode = {
  fills?: FigmaPaint[];
  children?: FigmaNode[];
  [key: string]: unknown;
};

type AssetRequestBody = {
  fileKey?: string;
  token?: string;
  figmaJson?: FigmaNode;
};

export default defineConfig({
  plugins: [react(), figmaAssetExtractor()],
  server: {
    proxy: {
      "/figma-api": {
        target: "https://api.figma.com",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/figma-api/, "")
      }
    }
  }
});

function figmaAssetExtractor() {
  return {
    name: "figma-asset-extractor",
    configureServer(server) {
      server.middlewares.use("/figma-assets/extract", async (req, res) => {
        if (req.method !== "POST") {
          sendJson(res, 405, { error: "Method not allowed" });
          return;
        }

        try {
          const body = await readJsonBody<AssetRequestBody>(req);
          const fileKey = body.fileKey?.trim();
          const token = body.token?.trim();
          const figmaJson = body.figmaJson;

          if (!fileKey || !token || !figmaJson) {
            sendJson(res, 400, { error: "fileKey, token, and figmaJson are required" });
            return;
          }

          const refs = collectImageRefs(figmaJson);
          if (!refs.length) {
            sendJson(res, 200, { figmaJson, assets: [], imageRefCount: 0, missingRefs: [] });
            return;
          }

          const imageMap = await fetchImageFillMap(fileKey, token);
          const assetsDir = path.resolve(server.config.root, "public", "assets");
          await mkdir(assetsDir, { recursive: true });

          const refToPath = new Map<string, string>();
          const assets: Array<{ imageRef: string; path: string }> = [];

          for (const imageRef of refs) {
            const imageUrl = imageMap[imageRef];
            if (!imageUrl) continue;

            const downloaded = await downloadImageAsset(imageUrl);
            const extension = extensionFromContentType(downloaded.contentType);
            const filename = `figma-${sanitizeFilePart(imageRef).slice(0, 24)}.${extension}`;
            const filePath = path.join(assetsDir, filename);
            const publicPath = `/assets/${filename}`;

            await writeFile(filePath, downloaded.bytes);
            refToPath.set(imageRef, publicPath);
            assets.push({ imageRef, path: publicPath });
          }

          sendJson(res, 200, {
            figmaJson: replaceImageRefsWithSrc(figmaJson, refToPath),
            assets,
            imageRefCount: refs.length,
            missingRefs: refs.filter((imageRef) => !refToPath.has(imageRef))
          });
        } catch (error) {
          sendJson(res, 500, {
            error: error instanceof Error ? error.message : "Unable to extract Figma image assets"
          });
        }
      });
    }
  };
}

function collectImageRefs(node: FigmaNode, refs = new Set<string>()) {
  for (const fill of node.fills ?? []) {
    if (fill.type === "IMAGE" && fill.imageRef) {
      refs.add(fill.imageRef);
    }
  }

  for (const child of node.children ?? []) {
    collectImageRefs(child, refs);
  }

  return Array.from(refs);
}

async function fetchImageFillMap(fileKey: string, token: string) {
  const response = await fetch(`https://api.figma.com/v1/files/${encodeURIComponent(fileKey)}/images`, {
    headers: {
      "X-Figma-Token": token
    }
  });

  if (!response.ok) {
    throw new Error(`Figma image API returned ${response.status} ${response.statusText}: ${await response.text()}`);
  }

  const data = await response.json();
  return (data.meta?.images ?? data.images ?? {}) as Record<string, string>;
}

async function downloadImageAsset(url: string) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Unable to download image asset: ${response.status} ${response.statusText}`);
  }

  return {
    bytes: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get("content-type") ?? ""
  };
}

function replaceImageRefsWithSrc<T>(value: T, refToPath: Map<string, string>): T {
  if (Array.isArray(value)) {
    return value.map((item) => replaceImageRefsWithSrc(item, refToPath)) as T;
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const output: Record<string, unknown> = {};
  for (const [key, childValue] of Object.entries(value)) {
    if (key === "imageRef" && typeof childValue === "string") {
      // Always replace imageRef with src if we have a path, or skip imageRef entirely
      if (refToPath.has(childValue)) {
        output.src = refToPath.get(childValue);
      }
      // Skip adding imageRef to output - we only want src
      continue;
    }

    output[key] = replaceImageRefsWithSrc(childValue, refToPath);
  }

  return output as T;
}

function extensionFromContentType(contentType: string) {
  if (contentType.includes("jpeg") || contentType.includes("jpg")) return "jpg";
  if (contentType.includes("webp")) return "webp";
  if (contentType.includes("svg")) return "svg";
  return "png";
}

function sanitizeFilePart(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "");
}

function readJsonBody<T>(req: IncomingMessage) {
  return new Promise<T>((resolve, reject) => {
    const chunks: Buffer[] = [];

    req.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });

    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as T);
      } catch (error) {
        reject(error);
      }
    });

    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, data: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(data));
}
