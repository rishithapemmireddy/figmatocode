import { FormEvent, useEffect, useMemo, useState } from "react";
import { FigmaPreview } from "./components/FigmaPreview";
import { CodeFormat, collectPages, createPageLevelJson, generateCodeForPage, FigmaFile } from "./utils/figmaToCode";

const EXAMPLE_FILE_KEY = "8VV8hCa7NJjw68b6dykdXN";
const DEFAULT_GEMINI_KEY = import.meta.env.VITE_GEMINI_KEY || "";

type LoadState = "idle" | "loading" | "ready" | "error";
type TabType = "compiler" | "ai";
const FIGMA_RETRY_LIMIT = 2;

type AssetExtractionResponse = {
  figmaJson?: FigmaFile;
  assets?: Array<{ imageRef: string; path: string }>;
  imageRefCount?: number;
  missingRefs?: string[];
  error?: string;
};

export function App() {
  // Step 1 State: Extraction from API (Do not touch)
  const [figmaToken, setFigmaToken] = useState("");
  const [fileKey, setFileKey] = useState(EXAMPLE_FILE_KEY);
  const [extractedRawJson, setExtractedRawJson] = useState("");
  const [step1Status, setStep1Status] = useState<LoadState>("idle");
  const [step1Message, setStep1Message] = useState("Ready to extract");

  // Step 2 State: Pasting and code generation
  const [pastedJson, setPastedJson] = useState("");
  const [figmaJson, setFigmaJson] = useState<FigmaFile | null>(null);
  const [fileName, setFileName] = useState("");
  const [format, setFormat] = useState<CodeFormat>("html");
  const [activePageId, setActivePageId] = useState("");
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [imageAssetMessage, setImageAssetMessage] = useState("");

  // Code Inspector & AI states
  const [activeTab, setActiveTab] = useState<TabType>("compiler");
  const [compilerCode, setCompilerCode] = useState("");
  const [geminiApiKey, setGeminiApiKey] = useState(DEFAULT_GEMINI_KEY);
  const [aiCodeCache, setAiCodeCache] = useState<Record<string, string>>({});
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  // Collect full Figma pages from the active Figma JSON
  const pages = useMemo(() => {
    return figmaJson ? collectPages(figmaJson.document) : [];
  }, [figmaJson]);

  // Find the active page
  const activePage = useMemo(() => {
    if (!pages.length) return null;
    return pages.find((page) => page.id === activePageId) || pages[0];
  }, [pages, activePageId]);

  const detectedPagesDebugJson = useMemo(() => {
    return JSON.stringify(pages.map(createPageLevelJson), null, 2);
  }, [pages]);

  // Clear AI code cache when format or filename changes to ensure consistent generation
  useEffect(() => {
    setAiCodeCache({});
  }, [format, fileName]);

  // Generate standard compiler code on page/format/name change
  useEffect(() => {
    if (!activePage) {
      setCompilerCode("");
      return;
    }
    try {
      const code = generateCodeForPage(activePage, {
        format,
        componentName: fileName || activePage.name || "FigmaExport"
      });
      setCompilerCode(code);
      setJsonError(null);
    } catch (error) {
      setJsonError(error instanceof Error ? error.message : "Error compiling standard code");
      setCompilerCode("");
    }
  }, [activePage, format, fileName]);

  // Automatically trigger AI generation if user selects AI tab and cache is empty
  useEffect(() => {
    if (activeTab === "ai" && activePage && !aiCodeCache[activePage.id] && !isAiLoading) {
      generateCodeWithGemini(activePage);
    }
  }, [activeTab, activePage, aiCodeCache]);

  // Handle Step 1 API fetch (Do not touch)
  async function handleExtractSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStep1Status("loading");
    setStep1Message("Fetching from Figma API...");
    setExtractedRawJson("");

    try {
      const cleanKey = normalizeFigmaFileKey(fileKey);
      const cleanToken = figmaToken.trim();

      if (!cleanKey) {
        throw new Error("Enter a valid Figma file key or file URL");
      }
      if (!cleanToken) {
        throw new Error("Enter a Figma Personal Access Token");
      }

      const response = await fetchFigmaFileWithRetry(cleanKey, cleanToken);

      const data = await response.json();
      const stringified = JSON.stringify(data, null, 2);
      setExtractedRawJson(stringified);
      setStep1Status("ready");
      setStep1Message("Figma JSON extracted successfully!");
    } catch (error) {
      setStep1Status("error");
      setStep1Message(error instanceof Error ? error.message : "Unable to extract Figma JSON");
    }
  }

  async function fetchFigmaFileWithRetry(cleanKey: string, cleanToken: string) {
    let lastResponse: Response | null = null;

    for (let attempt = 0; attempt <= FIGMA_RETRY_LIMIT; attempt += 1) {
      const response = await fetch(`/figma-api/v1/files/${encodeURIComponent(cleanKey)}`, {
        method: "GET",
        cache: "no-store",
        headers: {
          "X-Figma-Token": cleanToken,
          "Cache-Control": "no-cache",
          "Pragma": "no-cache"
        }
      });

      if (response.ok) return response;
      lastResponse = response;

      if (response.status !== 429 || attempt === FIGMA_RETRY_LIMIT) {
        break;
      }

      const retryAfterSeconds = Number(response.headers.get("Retry-After"));
      const delayMs = Number.isFinite(retryAfterSeconds)
        ? retryAfterSeconds * 1000
        : 1200 * (attempt + 1);

      setStep1Message(`Figma rate limit hit. Retrying in ${Math.ceil(delayMs / 1000)}s...`);
      await delay(delayMs);
    }

    if (!lastResponse) {
      throw new Error("Unable to reach Figma API");
    }

    throw await createFigmaApiError(lastResponse);
  }

  async function createFigmaApiError(response: Response) {
    const retryAfter = response.headers.get("Retry-After");
    const detail = await readFigmaErrorBody(response);
    const retryText = response.status === 429 && retryAfter ? ` Try again after ${retryAfter}s.` : "";

    return new Error(`Figma API returned ${response.status} ${response.statusText}.${retryText}${detail ? ` ${detail}` : ""}`);
  }

  async function readFigmaErrorBody(response: Response) {
    try {
      const text = await response.text();
      if (!text) return "";

      try {
        const parsed = JSON.parse(text);
        return parsed?.err || parsed?.message || text.slice(0, 240);
      } catch {
        return text.slice(0, 240);
      }
    } catch {
      return "";
    }
  }

  function normalizeFigmaFileKey(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return "";

    const fileMatch = trimmed.match(/figma\.com\/(?:file|design)\/([a-zA-Z0-9]+)/);
    if (fileMatch?.[1]) return fileMatch[1];

    return trimmed.replace(/^\/+|\/+$/g, "");
  }

  function delay(ms: number) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  // Handle Step 2 pasted JSON
  async function handlePastedJsonChange(value: string) {
    setPastedJson(value);
    if (!value.trim()) {
      setFigmaJson(null);
      setCompilerCode("");
      setActivePageId("");
      setAiCodeCache({});
      setJsonError(null);
      setImageAssetMessage("");
      return;
    }

    try {
      const parsed = JSON.parse(value) as FigmaFile;
      const processed = await extractImageAssetsForFigmaJson(parsed);

      setFigmaJson(processed);
      setJsonError(null);
      if (parsed.name && !fileName) {
        setFileName(parsed.name);
      }

      const foundPages = collectPages(processed.document);
      if (foundPages.length > 0) {
        setActivePageId(foundPages[0].id);
      }
    } catch (err) {
      setFigmaJson(null);
      setCompilerCode("");
      setActivePageId("");
      setAiCodeCache({});
      setImageAssetMessage("");
      setJsonError("Invalid JSON: Please check the syntax structure.");
    }
  }

  async function extractImageAssetsForFigmaJson(parsed: FigmaFile) {
    const cleanKey = normalizeFigmaFileKey(fileKey);
    const cleanToken = figmaToken.trim();

    if (!cleanKey || !cleanToken) {
      setImageAssetMessage("Image extraction skipped: No Figma token/key provided.");
      return parsed;
    }

    setImageAssetMessage("Extracting images from Figma...");

    try {
      const response = await fetch("/figma-assets/extract", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          fileKey: cleanKey,
          token: cleanToken,
          figmaJson: parsed
        })
      });

      const data = (await response.json()) as AssetExtractionResponse;

      if (!response.ok) {
        const errorMsg = data.error || `Image extraction failed: ${response.status}`;
        setImageAssetMessage(`Error: ${errorMsg}`);
        console.error("Image extraction error:", errorMsg);
        return parsed;
      }

      if (!data.figmaJson) {
        setImageAssetMessage("Error: Invalid response from image extraction.");
        return parsed;
      }

      const count = data.assets?.length ?? 0;
      const imageRefCount = data.imageRefCount ?? 0;
      const missingCount = data.missingRefs?.length ?? 0;

      if (count > 0) {
        setImageAssetMessage(
          `✓ Downloaded ${count}/${imageRefCount} image${count === 1 ? "" : "s"} from Figma. Ready for rendering!`
        );
      } else if (imageRefCount > 0) {
        setImageAssetMessage(
          `⚠ Found ${imageRefCount} image refs but could not download. Check Figma token access and rate limits.`
        );
      } else {
        setImageAssetMessage("✓ No images found in this design.");
      }

      if (missingCount > 0 && count > 0) {
        setImageAssetMessage(
          `✓ Downloaded ${count}/${imageRefCount} images. (${missingCount} refs had no downloadable URL)`
        );
      }

      return data.figmaJson;
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unable to extract image assets.";
      setImageAssetMessage(`Error: ${msg}`);
      console.error("Image extraction exception:", error);
      return parsed;
    }
  }

  // Gemini AI code refiner fetch
  async function generateCodeWithGemini(pageNode: any) {
    if (!pageNode) return;
    setIsAiLoading(true);
    setAiError(null);

    const key = geminiApiKey.trim();
    if (!key) {
      setAiError("Please configure a valid Gemini API Key in the settings.");
      setIsAiLoading(false);
      return;
    }

    const formatLabel = format === "html" 
      ? "HTML + CSS (a complete index.html unified page with absolute/relative standard CSS inside a <style> tag)" 
      : format === "flutter"
      ? "Flutter Widget (a Dart class extending StatelessWidget with Material Design components)"
      : "React TypeScript Component (a clean .tsx functional component file utilizing inline styles or semantic Tailwind CSS)";
    const pageLevelJson = createPageLevelJson(pageNode);

    const promptText = `You are an expert frontend developer. Convert the following cleaned Figma JSON node (representing one complete UI screen) into highly polished, clean, modern ${formatLabel} code.
This node was detected using only first-level FRAME children inside a Figma CANVAS. Nested frames inside it are components/sections, not separate pages.
When an IMAGE fill contains a src field like "/assets/name.png", render the actual image using an <img> tag or CSS background-image. Do not replace image assets with placeholders.
Use modern CSS layouts (Flexbox, Grid, absolute positioning where appropriate) to match the layout and design of the full screen.
Ensure the design is responsive, semantic, visually stunning, matches the proportions/colors, and follows standard design conventions.
Only output the raw code block inside a Markdown block. Do not include extra conversational explanations.

Cleaned Figma Screen JSON:
${JSON.stringify(pageLevelJson, null, 2)}`;

    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${key}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: promptText
                }
              ]
            }
          ],
          generationConfig: {
            temperature: 0.1
          }
        })
      });

      if (!response.ok) {
        throw new Error(`Gemini API returned error: ${response.status} ${response.statusText}`);
      }

      const resData = await response.json();
      const rawText = resData?.candidates?.[0]?.content?.parts?.[0]?.text || "";
      if (!rawText) {
        throw new Error("Empty response received from Gemini API");
      }

      const cleanedCode = cleanMarkdownCode(rawText);
      setAiCodeCache((prev) => ({
        ...prev,
        [pageNode.id]: cleanedCode
      }));
    } catch (err) {
      setAiError(err instanceof Error ? err.message : "Error contacting Gemini API");
    } finally {
      setIsAiLoading(false);
    }
  }

  // Clean Markdown wrappers from AI response
  function cleanMarkdownCode(text: string) {
    let cleaned = text.trim();
    if (cleaned.startsWith("```")) {
      const firstNewline = cleaned.indexOf("\n");
      if (firstNewline !== -1) {
        cleaned = cleaned.substring(firstNewline + 1);
      }
      if (cleaned.endsWith("```")) {
        cleaned = cleaned.substring(0, cleaned.length - 3);
      }
    }
    return cleaned.trim();
  }

  // Download helper
  function downloadFile(content: string, filename: string, contentType: string) {
    const blob = new Blob([content], { type: contentType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  function handleDownloadCode() {
    const codeToDownload = activeTab === "compiler" ? compilerCode : aiCodeCache[activePageId] || "";
    if (!codeToDownload) return;
    
    const ext = format === "html" ? "html" : format === "flutter" ? "dart" : "tsx";
    const prefix = activeTab === "compiler" ? "compiler_" : "ai_";
    downloadFile(codeToDownload, `${prefix}${fileName || "FigmaExport"}.${ext}`, "text/plain");
  }

  function handleDownloadExtractedJson() {
    if (!extractedRawJson) return;
    downloadFile(extractedRawJson, `extracted_${fileKey || "figma"}.json`, "application/json");
  }

  async function copyToClipboard(text: string, successMessage: string) {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      alert(successMessage);
    } catch (err) {
      console.error("Clipboard copy failed:", err);
    }
  }

  // Determine current active code displayed
  const currentDisplayCode = activeTab === "compiler" ? compilerCode : aiCodeCache[activePageId] || "";

  return (
    <main className="min-h-screen bg-[#110f12] font-poppins text-gray-200">
      {/* Header */}
      <header className="sticky top-0 z-50 flex items-center justify-between border-b border-white/5 bg-[#171418]/80 px-6 py-4 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-tr from-[#A259FF] via-[#0ACF83] to-[#F24E1E] p-0.5 shadow-lg shadow-purple-950/20">
            <div className="flex h-full w-full items-center justify-center rounded-md bg-[#171418] text-sm font-bold text-white">
              F
            </div>
          </div>
          <div>
            <h1 className="text-sm font-semibold tracking-wide text-white">Figma Code Extractor & Live Previewer</h1>
            <p className="text-[10px] text-gray-400">Two-Step Workflow: Extract JSON from API, then paste to generate responsive code</p>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-[1600px] flex-col gap-6 p-6">
        
        {/* STEP 1: FIGMA API JSON EXTRACTOR (Do not touch) */}
        <section className="rounded-xl border border-white/5 bg-[#171418] p-5 shadow-xl">
          <div className="mb-4 flex items-center justify-between border-b border-white/5 pb-3">
            <div className="flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#A259FF] text-[10px] font-bold text-white">1</span>
              <h2 className="text-xs font-bold uppercase tracking-wider text-white">Extract Raw Figma JSON (API Link)</h2>
            </div>
            <span
              className={`text-[10px] font-semibold px-2 py-0.5 rounded ${
                step1Status === "error"
                  ? "bg-red-500/10 text-red-400"
                  : step1Status === "ready"
                    ? "bg-green-500/10 text-green-400"
                    : "bg-white/5 text-gray-400"
              }`}
            >
              {step1Message}
            </span>
          </div>

          <div className="grid gap-5 lg:grid-cols-5">
            <form onSubmit={handleExtractSubmit} className="lg:col-span-2 flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Personal Access Token</label>
                <input
                  type="password"
                  value={figmaToken}
                  onChange={(event) => setFigmaToken(event.target.value)}
                  placeholder="Paste your Figma Personal Access Token..."
                  className="h-9 rounded-lg border border-white/10 bg-[#221e24] px-3 text-xs text-white outline-none transition focus:border-[#A259FF] placeholder:text-gray-600"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Figma File Key</label>
                <input
                  type="text"
                  value={fileKey}
                  onChange={(event) => setFileKey(event.target.value)}
                  placeholder="Enter file key from Figma URL..."
                  className="h-9 rounded-lg border border-white/10 bg-[#221e24] px-3 text-xs text-white outline-none transition focus:border-[#A259FF]"
                />
              </div>

              <button
                type="submit"
                disabled={step1Status === "loading"}
                className="mt-1 flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-[#A259FF] text-xs font-semibold text-white shadow-lg shadow-purple-950/10 transition hover:bg-[#8e46eb] active:scale-[0.99] disabled:opacity-50"
              >
                {step1Status === "loading" ? "Extracting..." : "Extract Figma File"}
              </button>
            </form>

            <div className="lg:col-span-3 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Extracted Raw Output</label>
                {extractedRawJson && (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => copyToClipboard(extractedRawJson, "Extracted JSON copied to clipboard")}
                      className="rounded bg-white/5 px-2 py-1 text-[9px] text-gray-300 hover:bg-white/10"
                    >
                      Copy Output
                    </button>
                    <button
                      type="button"
                      onClick={handleDownloadExtractedJson}
                      className="rounded bg-[#A259FF] px-2 py-1 text-[9px] text-white hover:bg-[#8e46eb]"
                    >
                      Download JSON
                    </button>
                  </div>
                )}
              </div>
              <textarea
                readOnly
                value={extractedRawJson}
                placeholder="Raw Figma JSON extracted from API will appear here. Copy or download it to use in Step 2 below."
                className="h-36 w-full resize-none rounded-lg border border-white/10 bg-[#110f12] p-3 font-mono text-[10px] text-gray-400 outline-none"
              />
            </div>
          </div>
        </section>

        {/* STEP 2: CODE GENERATOR & PREVIEWER */}
        <section className="rounded-xl border border-white/5 bg-[#171418] p-5 shadow-xl">
          <div className="mb-4 flex items-center justify-between border-b border-white/5 pb-3">
            <div className="flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#0ACF83] text-[10px] font-bold text-white">2</span>
              <h2 className="text-xs font-bold uppercase tracking-wider text-white">Paste Figma JSON & Generate Code (Page by Page)</h2>
            </div>
            {jsonError && (
              <span className="text-[10px] bg-red-500/10 border border-red-500/20 text-red-400 px-2 py-0.5 rounded font-medium">
                {jsonError}
              </span>
            )}
          </div>

          <div className="grid gap-5 lg:grid-cols-5">
            {/* Input area for manual paste */}
            <div className="lg:col-span-2 flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Paste Extracted Figma JSON</label>
                <textarea
                  value={pastedJson}
                  onChange={(event) => handlePastedJsonChange(event.target.value)}
                  placeholder="Paste raw Figma /v1/files response JSON here..."
                  className={`h-[450px] w-full resize-none rounded-lg border p-4 font-mono text-[10px] bg-[#110f12] text-gray-300 outline-none transition focus:ring-1 ${
                    jsonError
                      ? "border-red-500/30 focus:border-red-500 focus:ring-red-500/10"
                      : "border-white/10 focus:border-[#0ACF83] focus:ring-[#0ACF83]/10"
                  }`}
                />
              </div>

              {figmaJson && (
                <>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Component Name</label>
                      <input
                        type="text"
                        value={fileName}
                        onChange={(event) => setFileName(event.target.value)}
                        placeholder="FigmaExport"
                        className="h-9 rounded-lg border border-white/10 bg-[#221e24] px-3 text-xs text-white outline-none focus:border-[#0ACF83]"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Format</label>
                      <select
                        value={format}
                        onChange={(event) => setFormat(event.target.value as CodeFormat)}
                        className="h-9 rounded-lg border border-white/10 bg-[#221e24] px-2 text-xs text-white outline-none cursor-pointer focus:border-[#0ACF83]"
                      >
                        <option value="html">HTML + CSS</option>
                        <option value="react">React Component</option>
                        <option value="flutter">Flutter Widget</option>
                      </select>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Gemini Key</label>
                      <input
                        type="password"
                        value={geminiApiKey}
                        onChange={(event) => setGeminiApiKey(event.target.value)}
                        placeholder="AI API Key..."
                        className="h-9 rounded-lg border border-white/10 bg-[#221e24] px-3 text-xs text-white outline-none focus:border-[#0ACF83]"
                      />
                    </div>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Detected Pages JSON</label>
                      <span className="rounded bg-[#0ACF83]/10 px-2 py-0.5 text-[9px] font-semibold text-[#0ACF83]">
                        CANVAS direct FRAME only
                      </span>
                    </div>
                    <textarea
                      readOnly
                      value={detectedPagesDebugJson}
                      className="h-36 w-full resize-none rounded-lg border border-white/10 bg-[#110f12] p-3 font-mono text-[10px] text-gray-300 outline-none"
                    />
                    {imageAssetMessage && (
                      <p className="text-[10px] text-gray-400">
                        {imageAssetMessage}
                      </p>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Workspace Dashboard: Pages Sidebar, Preview Panel, Code Output */}
            <div className="lg:col-span-3 grid gap-4 md:grid-cols-[140px_1fr_1fr]">
              
              {/* Sidebar (Pages) */}
              <aside className="rounded-lg border border-white/5 bg-[#110f12] p-3 flex flex-col gap-2">
                <span className="text-[9px] font-bold uppercase tracking-wider text-gray-400">Detected Pages</span>
                <div className="flex flex-col gap-1 overflow-y-auto max-h-[440px] pr-1">
                  {pages.map((page) => (
                    <button
                      key={page.id}
                      type="button"
                      onClick={() => setActivePageId(page.id)}
                      className={`truncate w-full rounded-md px-2 py-1.5 text-left text-[11px] transition-all ${
                        page.id === activePage?.id
                          ? "bg-[#0ACF83] text-white font-semibold"
                          : "text-gray-400 hover:bg-white/5 hover:text-white"
                      }`}
                    >
                      {page.name}
                    </button>
                  ))}
                  {pages.length === 0 && (
                    <div className="text-[10px] text-gray-500 italic text-center py-6">
                      No JSON loaded.
                    </div>
                  )}
                </div>
              </aside>

              {/* Preview Canvas */}
              <section className="rounded-lg border border-white/5 bg-[#110f12] p-3 flex flex-col gap-2 min-h-[380px]">
                <span className="text-[9px] font-bold uppercase tracking-wider text-gray-400">Visual Canvas</span>
                <div className="flex-1 flex items-center justify-center relative bg-[#171418] rounded overflow-hidden" style={{
                  backgroundImage: 'radial-gradient(rgba(255,255,255,0.02) 1px, transparent 1px)',
                  backgroundSize: '12px 12px'
                }}>
                  {figmaJson ? (
                    <FigmaPreview activePage={activePage} />
                  ) : (
                    <div className="text-center p-4">
                      <p className="text-[10px] text-gray-500">Waiting for Figma JSON data...</p>
                    </div>
                  )}
                </div>
              </section>

              {/* Code output with Dual Tabs */}
              <section className="rounded-lg border border-white/5 bg-[#110f12] p-3 flex flex-col gap-2 min-h-[380px]">
                <div className="flex items-center justify-between border-b border-white/5 pb-1">
                  {/* Tab Selector */}
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => setActiveTab("compiler")}
                      className={`px-2 py-1 rounded text-[9px] font-bold uppercase tracking-wider transition-all ${
                        activeTab === "compiler"
                          ? "bg-[#0ACF83] text-white"
                          : "bg-white/5 text-gray-400 hover:text-white"
                      }`}
                    >
                      Compiler Code
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveTab("ai")}
                      className={`px-2 py-1 rounded text-[9px] font-bold uppercase tracking-wider transition-all ${
                        activeTab === "ai"
                          ? "bg-[#A259FF] text-white"
                          : "bg-white/5 text-gray-400 hover:text-white"
                      }`}
                    >
                      Gemini AI Code
                    </button>
                  </div>

                  {currentDisplayCode && !isAiLoading && (
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        onClick={() => copyToClipboard(currentDisplayCode, "Code copied to clipboard")}
                        className="rounded bg-white/5 p-1 hover:bg-white/10"
                        title="Copy Code"
                      >
                        <svg className="h-3 w-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        onClick={handleDownloadCode}
                        className={`rounded p-1 ${activeTab === "compiler" ? "bg-[#0ACF83] hover:bg-[#09b573]" : "bg-[#A259FF] hover:bg-[#8e46eb]"}`}
                        title="Download Code"
                      >
                        <svg className="h-3 w-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                      </button>
                    </div>
                  )}
                </div>

                <div className="flex-1 relative overflow-hidden bg-[#171418] rounded border border-white/5 font-mono text-[9px] text-[#0ACF83]">
                  {activeTab === "ai" && isAiLoading ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#171418] p-4 text-center">
                      <svg className="mb-2 h-6 w-6 animate-spin text-[#A259FF]" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      <p className="text-[10px] text-[#A259FF]">Gemini is writing responsive code...</p>
                    </div>
                  ) : activeTab === "ai" && aiError ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#171418] p-4 text-center">
                      <p className="mb-3 text-[10px] text-red-400">{aiError}</p>
                      <button
                        type="button"
                        onClick={() => generateCodeWithGemini(activePage)}
                        className="rounded bg-[#A259FF] px-2.5 py-1 text-[9px] font-bold text-white hover:bg-[#8e46eb]"
                      >
                        Retry Generation
                      </button>
                    </div>
                  ) : activeTab === "ai" && figmaJson && !aiCodeCache[activePageId] ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#171418] p-4 text-center">
                      <p className="mb-3 text-[10px] text-gray-500">Gemini AI code not generated yet.</p>
                      <button
                        type="button"
                        onClick={() => generateCodeWithGemini(activePage)}
                        className="rounded bg-[#A259FF] px-3 py-1.5 text-[9px] font-bold text-white hover:bg-[#8e46eb]"
                      >
                        Generate Code with Gemini AI
                      </button>
                    </div>
                  ) : (
                    <textarea
                      readOnly
                      value={currentDisplayCode || (figmaJson ? "Select a page and click Generate to see code." : "Generated code will display here once valid JSON is pasted.")}
                      className={`h-full w-full resize-none bg-transparent p-3 outline-none leading-normal ${
                        activeTab === "compiler" ? "text-[#0ACF83]" : "text-[#A259FF]"
                      }`}
                    />
                  )}
                </div>
              </section>
     
            </div>
          </div>
        </section>

      </div>
    </main>
  );
}
