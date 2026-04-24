/**
 * Google Slides API Service
 * Wraps Google Slides REST API calls
 */

import { google } from "googleapis";
import type { slides_v1 } from "googleapis";

import { logger } from "./logger.js";
import type { GoogleAuth } from "./types.js";

// Types for slide media content
export interface SlideImage {
  contentUrl: string;
  sourceUrl?: string;
  description?: string;
  width?: number;
  height?: number;
  base64Data?: string;
  mimeType?: string;
}

export interface SlideVideo {
  videoUrl: string;
  source: "YOUTUBE" | "DRIVE" | "UNKNOWN";
  videoId?: string;
}

export interface SlideChart {
  chartId: string;
  spreadsheetId?: string;
  description: string;
}

export interface SlideContent {
  slideNumber: number;
  objectId: string;
  text: string;
  speakerNotes: string;
  images: SlideImage[];
  videos: SlideVideo[];
  charts: SlideChart[];
  shapes: string[];
}

export interface PresentationContent {
  id: string;
  title: string;
  slideCount: number;
  slides: SlideContent[];
}

export class GoogleSlidesService {
  private slides: slides_v1.Slides;
  private drive: ReturnType<typeof google.drive>;

  constructor(auth: GoogleAuth) {
    this.slides = google.slides({
      version: "v1",
      auth: auth as Parameters<typeof google.slides>[0]["auth"],
    });
    this.drive = google.drive({
      version: "v3",
      auth: auth as Parameters<typeof google.drive>[0]["auth"],
    });
  }

  /**
   * List recent presentations from Google Drive
   */
  async listPresentations(maxResults: number = 10): Promise<Array<{ id: string; name: string; modifiedTime: string }>> {
    try {
      logger.debug(`Listing presentations (max: ${maxResults})`);

      const response = await this.drive.files.list({
        q: "mimeType='application/vnd.google-apps.presentation'",
        pageSize: maxResults,
        fields: "files(id, name, modifiedTime)",
        orderBy: "modifiedTime desc",
      });

      const files = response.data.files || [];
      return files.map((file) => ({
        id: file.id || "",
        name: file.name || "Untitled",
        modifiedTime: file.modifiedTime || "",
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to list presentations: ${message}`);
    }
  }

  /**
   * Search presentations by name
   */
  async searchPresentations(
    query: string,
    maxResults: number = 10
  ): Promise<Array<{ id: string; name: string; modifiedTime: string }>> {
    try {
      logger.debug(`Searching presentations: ${query}`);

      const response = await this.drive.files.list({
        q: `mimeType='application/vnd.google-apps.presentation' and name contains '${query.replace(/'/g, "\\'")}'`,
        pageSize: maxResults,
        fields: "files(id, name, modifiedTime)",
        orderBy: "modifiedTime desc",
      });

      const files = response.data.files || [];
      return files.map((file) => ({
        id: file.id || "",
        name: file.name || "Untitled",
        modifiedTime: file.modifiedTime || "",
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to search presentations: ${message}`);
    }
  }

  /**
   * Get a presentation by ID with full content including media
   * @param presentationId - The presentation ID
   * @param options.includeImageData - If true, downloads and includes base64-encoded image data
   */
  async getPresentation(
    presentationId: string,
    options: { includeImageData?: boolean } = {}
  ): Promise<PresentationContent> {
    try {
      logger.debug(`Getting presentation: ${presentationId}`);

      const response = await this.slides.presentations.get({
        presentationId,
      });

      const presentation = response.data;
      const slides = presentation.slides || [];

      const extractedSlides: SlideContent[] = [];

      for (let index = 0; index < slides.length; index++) {
        const slide = slides[index];
        const content = this.extractAllContent(slide);

        // Download image data if requested
        if (options.includeImageData && content.images.length > 0) {
          for (const image of content.images) {
            if (image.contentUrl) {
              const imageData = await this.downloadImage(image.contentUrl);
              if (imageData) {
                image.base64Data = imageData.base64;
                image.mimeType = imageData.mimeType;
              }
            }
          }
        }

        extractedSlides.push({
          slideNumber: index + 1,
          objectId: slide.objectId || "",
          text: content.text,
          speakerNotes: this.extractSpeakerNotes(slide),
          images: content.images,
          videos: content.videos,
          charts: content.charts,
          shapes: content.shapes,
        });
      }

      logger.info(`Retrieved presentation: ${presentationId} (${slides.length} slides)`);

      return {
        id: presentation.presentationId || presentationId,
        title: presentation.title || "Untitled",
        slideCount: slides.length,
        slides: extractedSlides,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to get presentation: ${message}`);
    }
  }

  /**
   * Download an image from a Google URL and return base64 data
   */
  private async downloadImage(
    contentUrl: string
  ): Promise<{ base64: string; mimeType: string } | null> {
    try {
      // Get access token from the auth client
      const authClient = this.slides as unknown as { auth: { getAccessToken: () => Promise<{ token?: string | null }> } };
      const tokenResponse = await authClient.auth.getAccessToken();
      const accessToken = tokenResponse.token;

      if (!accessToken) {
        logger.debug("No access token available for image download");
        return null;
      }

      // Fetch the image with authentication
      const response = await fetch(contentUrl, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!response.ok) {
        logger.debug(`Failed to download image: ${response.status}`);
        return null;
      }

      const contentType = response.headers.get("content-type") || "image/png";
      const arrayBuffer = await response.arrayBuffer();
      const base64 = Buffer.from(arrayBuffer).toString("base64");

      return {
        base64,
        mimeType: contentType,
      };
    } catch (error) {
      logger.debug(`Error downloading image: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  /**
   * Helper: Extract all content from a slide (text, images, videos, charts, shapes)
   */
  private extractAllContent(slide: slides_v1.Schema$Page): {
    text: string;
    images: SlideImage[];
    videos: SlideVideo[];
    charts: SlideChart[];
    shapes: string[];
  } {
    const textParts: string[] = [];
    const images: SlideImage[] = [];
    const videos: SlideVideo[] = [];
    const charts: SlideChart[] = [];
    const shapes: string[] = [];

    if (!slide.pageElements) {
      return { text: "", images: [], videos: [], charts: [], shapes: [] };
    }

    for (const element of slide.pageElements) {
      // Extract text from shapes
      if (element.shape?.text?.textElements) {
        const shapeText = this.extractTextFromTextElements(element.shape.text.textElements);
        if (shapeText.trim()) {
          textParts.push(shapeText);
        }
      }

      // Extract non-text shapes (drawings, lines, etc.)
      if (element.shape?.shapeType && !element.shape?.text?.textElements?.length) {
        const shapeType = element.shape.shapeType;
        if (shapeType !== "TEXT_BOX" && shapeType !== "RECTANGLE") {
          shapes.push(shapeType);
        }
      }

      // Extract tables
      if (element.table?.tableRows) {
        const tableText = this.extractTableAsMarkdown(element.table);
        if (tableText.trim()) {
          textParts.push(tableText);
        }
      }

      // Extract images
      if (element.image) {
        const image = this.extractImage(element);
        if (image) {
          images.push(image);
        }
      }

      // Extract videos
      if (element.video) {
        const video = this.extractVideo(element);
        if (video) {
          videos.push(video);
        }
      }

      // Extract charts (embedded from Sheets)
      if (element.sheetsChart) {
        const chart = this.extractChart(element);
        if (chart) {
          charts.push(chart);
        }
      }

      // Extract content from groups (recursive)
      if (element.elementGroup?.children) {
        for (const child of element.elementGroup.children) {
          const childContent = this.extractAllContent({ pageElements: [child] } as slides_v1.Schema$Page);
          textParts.push(childContent.text);
          images.push(...childContent.images);
          videos.push(...childContent.videos);
          charts.push(...childContent.charts);
          shapes.push(...childContent.shapes);
        }
      }
    }

    return {
      text: textParts.filter(t => t.trim()).join("\n\n"),
      images,
      videos,
      charts,
      shapes: [...new Set(shapes)], // Deduplicate shapes
    };
  }

  /**
   * Helper: Extract image data from a page element
   */
  private extractImage(element: slides_v1.Schema$PageElement): SlideImage | null {
    if (!element.image) return null;

    const image = element.image;
    const size = element.size;

    return {
      contentUrl: image.contentUrl || "",
      sourceUrl: image.sourceUrl || undefined,
      description: element.description || undefined,
      width: size?.width?.magnitude ?? undefined,
      height: size?.height?.magnitude ?? undefined,
    };
  }

  /**
   * Helper: Extract video data from a page element
   */
  private extractVideo(element: slides_v1.Schema$PageElement): SlideVideo | null {
    if (!element.video) return null;

    const video = element.video;
    let source: "YOUTUBE" | "DRIVE" | "UNKNOWN" = "UNKNOWN";
    let videoUrl = "";

    if (video.source === "YOUTUBE") {
      source = "YOUTUBE";
      videoUrl = video.id ? `https://www.youtube.com/watch?v=${video.id}` : "";
    } else if (video.source === "DRIVE") {
      source = "DRIVE";
      videoUrl = video.id ? `https://drive.google.com/file/d/${video.id}/view` : "";
    }

    return {
      videoUrl,
      source,
      videoId: video.id || undefined,
    };
  }

  /**
   * Helper: Extract chart data from a page element
   */
  private extractChart(element: slides_v1.Schema$PageElement): SlideChart | null {
    if (!element.sheetsChart) return null;

    const chart = element.sheetsChart;

    return {
      chartId: chart.chartId?.toString() || "",
      spreadsheetId: chart.spreadsheetId || undefined,
      description: element.description || "Embedded chart from Google Sheets",
    };
  }

  /**
   * Helper: Extract speaker notes from a slide
   */
  private extractSpeakerNotes(slide: slides_v1.Schema$Page): string {
    if (!slide.slideProperties?.notesPage?.pageElements) return "";

    for (const element of slide.slideProperties.notesPage.pageElements) {
      if (element.shape?.shapeType === "TEXT_BOX" && element.shape.text?.textElements) {
        const notesText = this.extractTextFromTextElements(element.shape.text.textElements);
        if (notesText.trim()) {
          return notesText.trim();
        }
      }
    }

    return "";
  }

  /**
   * Helper: Extract text from text elements array
   */
  private extractTextFromTextElements(textElements: slides_v1.Schema$TextElement[]): string {
    let text = "";

    for (const element of textElements) {
      if (element.textRun?.content) {
        text += element.textRun.content;
      }
    }

    return text;
  }

  /**
   * Helper: Extract table content as markdown table
   */
  private extractTableAsMarkdown(table: slides_v1.Schema$Table): string {
    if (!table.tableRows || table.tableRows.length === 0) return "";

    const rows: string[][] = [];

    for (const tableRow of table.tableRows) {
      const rowCells: string[] = [];
      if (tableRow.tableCells) {
        for (const cell of tableRow.tableCells) {
          let cellText = "";
          if (cell.text?.textElements) {
            cellText = this.extractTextFromTextElements(cell.text.textElements);
          }
          // Clean up cell text: trim and replace newlines with spaces
          rowCells.push(cellText.trim().replace(/\n/g, " "));
        }
      }
      rows.push(rowCells);
    }

    if (rows.length === 0) return "";

    // Build markdown table
    let markdown = "\n";

    // First row as header
    const headerRow = rows[0];
    markdown += "| " + headerRow.join(" | ") + " |\n";

    // Header separator
    markdown += "| " + headerRow.map(() => "---").join(" | ") + " |\n";

    // Data rows (skip first row since it's the header)
    for (let i = 1; i < rows.length; i++) {
      markdown += "| " + rows[i].join(" | ") + " |\n";
    }

    markdown += "\n";
    return markdown;
  }
}

/**
 * Get presentation URL from ID
 */
export function getPresentationUrl(presentationId: string): string {
  return `https://docs.google.com/presentation/d/${presentationId}/edit`;
}
