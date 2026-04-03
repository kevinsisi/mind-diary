import fs from "node:fs/promises";
import path from "node:path";

/**
 * Extract text content from a file based on its mimetype.
 * - PDF: uses pdf-parse
 * - Text/Markdown: reads file directly
 * - Images: returns empty string (Gemini vision handles separately)
 */
export async function extractText(
  filepath: string,
  mimetype: string
): Promise<string> {
  try {
    if (mimetype === "application/pdf") {
      // Dynamic import to avoid issues if pdf-parse is not installed
      const pdfParse = (await import("pdf-parse")).default;
      const buffer = await fs.readFile(filepath);
      const data = await pdfParse(buffer);
      return data.text || "";
    }

    if (
      mimetype.startsWith("text/") ||
      mimetype === "application/markdown" ||
      filepath.endsWith(".md") ||
      filepath.endsWith(".txt")
    ) {
      return await fs.readFile(filepath, "utf-8");
    }

    // Images and other binary types — return empty, Gemini vision will handle
    return "";
  } catch (err) {
    console.error(`[fileService] extractText failed for ${filepath}:`, err);
    return "";
  }
}

/**
 * Delete a physical file from disk.
 */
export async function deleteFile(filepath: string): Promise<void> {
  try {
    await fs.unlink(filepath);
  } catch (err: any) {
    // Ignore if file already gone
    if (err.code !== "ENOENT") {
      throw err;
    }
  }
}
